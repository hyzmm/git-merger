//! Working-tree operations backing the Changes panel (v0.13.35 — CLI
//! edition). Every function here shells out to the user's `git` binary
//! instead of using libgit2, so staging / un-staging / discarding / committing
//! behave exactly like the terminal: hooks run, `clean` filters and
//! `commit.gpgsign` are honoured natively, and error messages are git's own.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::cli::{self, GitError};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkingFlag {
    /// File only differs in the working tree (unstaged change).
    Unstaged,
    /// File only differs in the index (staged change).
    Staged,
    /// File is changed in BOTH working tree and index.
    Both,
    /// New file not tracked yet.
    Untracked,
    /// File is unmerged (still in conflict).
    Conflict,
    /// File is ignored (we only show these on demand; usually filtered out).
    Ignored,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkingStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Typechange,
    Untracked,
    Conflict,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkingFile {
    pub path: String,
    pub flag: WorkingFlag,
    /// What kind of change (independent of staged/unstaged).
    pub status: WorkingStatus,
}

/// `git status --porcelain=v1 -z`. The two-letter XY code per entry gives us
/// the index (X) and worktree (Y) state in one place, and `-z` makes the
/// output path-safe. Renames appear as two NUL-separated tokens: the XY
/// entry carries the *new* path, the following token the old one.
pub fn working_changes(path: &str) -> Result<Vec<WorkingFile>, GitError> {
    let out = cli::run(
        path,
        &[
            cli::s("-c"),
            cli::s("core.quotePath=false"),
            cli::s("status"),
            cli::s("--porcelain=v1"),
            cli::s("-z"),
            cli::s("--untracked-files=all"),
        ],
    )?;
    parse_porcelain_v1(&out.stdout)
}

fn parse_porcelain_v1(stdout: &[u8]) -> Result<Vec<WorkingFile>, GitError> {
    let tokens: Vec<&[u8]> = stdout
        .split(|&b| b == 0)
        .filter(|t| !t.is_empty())
        .collect();
    let mut out: Vec<WorkingFile> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let t = tokens[i];
        // "XY <path>"
        if t.len() < 4 || t[2] != b' ' {
            i += 1;
            continue;
        }
        let x = (t[0] as char).to_ascii_uppercase();
        let y = (t[1] as char).to_ascii_uppercase();
        let path = String::from_utf8_lossy(&t[3..]).into_owned();
        // Rename / copy entries: the XY token is the NEW path, the next
        // NUL-separated token is the OLD path (field order is reversed in
        // -z mode vs. the human-readable "old -> new").
        if (x == 'R' || x == 'C') && i + 1 < tokens.len() {
            i += 1; // consume the old-path token; we only report `path`.
        }

        let (flag, status) = classify_xy(x, y);
        out.push(WorkingFile { path, flag, status });
        i += 1;
    }
    Ok(out)
}

/// Map a porcelain v1 `XY` pair to our flag/status enums, mirroring the
/// priority order the old libgit2 implementation used (conflict > untracked
/// > added > deleted > renamed > typechange > modified).
fn classify_xy(x: char, y: char) -> (WorkingFlag, WorkingStatus) {
    if x == 'U' || y == 'U' {
        return (WorkingFlag::Conflict, WorkingStatus::Conflict);
    }
    if x == '?' {
        return (WorkingFlag::Untracked, WorkingStatus::Untracked);
    }
    let in_index = x != ' ';
    let in_wt = y != ' ';
    let flag = if in_index && in_wt {
        WorkingFlag::Both
    } else if in_index {
        WorkingFlag::Staged
    } else {
        WorkingFlag::Unstaged
    };
    let status = if x == 'A' || y == 'A' {
        WorkingStatus::Added
    } else if x == 'D' || y == 'D' {
        WorkingStatus::Deleted
    } else if x == 'R' || y == 'R' {
        WorkingStatus::Renamed
    } else if x == 'T' || y == 'T' {
        WorkingStatus::Typechange
    } else {
        WorkingStatus::Modified
    };
    (flag, status)
}

/// Stage a list of paths (adds, modifications, and tracked deletions) via
/// `git add -A`. Paths that no longer exist anywhere (stale entries) are
/// dropped up front — a single non-matching pathspec would abort the whole
/// `git add`, whereas the old libgit2 add_all silently skipped them.
pub fn stage_files(path: &str, paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let tracked = ls_files(path, paths, false)?;
    let untracked = ls_files(path, paths, true)?;

    let mut args = vec![cli::s("add"), cli::s("-A"), cli::s("--")];
    let mut any = false;
    for p in paths {
        if tracked.contains(p) || untracked.contains(p) {
            args.push(cli::literal(p));
            any = true;
        }
    }
    if !any {
        return Ok(());
    }
    cli::run(path, &args)?;
    Ok(())
}

/// Unstage paths — restore their index entries to HEAD's state
/// (`git restore --staged`). Restricted to paths that actually carry staged
/// changes, so a stale path can't abort the command and the no-op case stays
/// silent like the old `reset_default`.
pub fn unstage_files(path: &str, paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let staged: HashSet<String> = {
        let out = cli::run_diff(
            path,
            &[
                cli::s("diff"),
                cli::s("--cached"),
                cli::s("--name-only"),
                cli::s("-z"),
            ],
        )?;
        cli::nul_set(&out.stdout)
    };

    let mut args = vec![cli::s("restore"), cli::s("--staged"), cli::s("--")];
    let mut any = false;
    for p in paths {
        if staged.contains(p) {
            args.push(cli::literal(p));
            any = true;
        }
    }
    if !any {
        return Ok(());
    }
    cli::run(path, &args)?;
    Ok(())
}

/// Discard working-tree changes. Tracked files are restored from the index
/// (`git restore`); untracked files are deleted from the filesystem.
pub fn discard_files(path: &str, paths: &[String]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let tracked = ls_files(path, paths, false)?;
    let untracked = ls_files(path, paths, true)?;

    let mut args = vec![cli::s("restore"), cli::s("--")];
    let mut any = false;
    for p in paths {
        // A stale path (tracked nowhere) has nothing to discard — skip.
        if tracked.contains(p) && !untracked.contains(p) {
            args.push(cli::literal(p));
            any = true;
        }
    }
    if any {
        cli::run(path, &args)?;
    }

    let workdir = cli::workdir(path)?;
    for p in paths {
        if untracked.contains(p) {
            let _ = std::fs::remove_file(workdir.join(p));
        }
    }
    Ok(())
}

/// Index entries matching any of `paths` (`git ls-files`), or — with
/// `others` — untracked files currently present on disk
/// (`git ls-files --others --exclude-standard`).
fn ls_files(path: &str, paths: &[String], others: bool) -> Result<HashSet<String>, GitError> {
    let mut args = vec![cli::s("ls-files"), cli::s("-z")];
    if others {
        args.push(cli::s("--others"));
        args.push(cli::s("--exclude-standard"));
    }
    args.push(cli::s("--"));
    for p in paths {
        args.push(cli::literal(p));
    }
    let out = cli::run(path, &args)?;
    Ok(cli::nul_set(&out.stdout))
}

/// Options governing a commit operation. Captured as one struct so the
/// Tauri command surface stays small and easy to extend (we can add e.g.
/// `--allow-empty` later without re-shaping callers).
///
/// Defaults match `git commit` with no flags.
#[derive(Debug, Clone, Deserialize)]
pub struct CommitOptions {
    /// Replace HEAD with a new commit (`git commit --amend`). Parents are
    /// taken from the *current HEAD's parents*, not from HEAD itself, so
    /// this rewrites the existing tip rather than chaining onto it.
    #[serde(default)]
    pub amend: bool,
    /// Append a `Signed-off-by:` trailer using `user.name` / `user.email`.
    /// Idempotent when the trailer already terminates the message.
    #[serde(default)]
    pub signoff: bool,
    /// When `amend` is true, replace the original author's name+email+time
    /// with the current `user.{name,email}` + now (matches `git commit
    /// --amend --reset-author`). Ignored for non-amend commits.
    #[serde(default)]
    pub reset_author: bool,
    /// Run `pre-commit`, `commit-msg`, and `post-commit` hooks. Default on
    /// — disabling matches `git commit --no-verify` semantics. Failures in
    /// pre-commit / commit-msg abort the commit; post-commit failures are
    /// logged but non-fatal.
    #[serde(default = "default_run_hooks")]
    pub run_hooks: bool,
    /// Override commit author in "Name <email>" format.
    #[serde(default)]
    pub author: Option<String>,
}

fn default_run_hooks() -> bool {
    true
}

// Manual Default so `run_hooks` defaults to ON — matching the serde default
// and the doc comment above. (A derived Default would flip it to `false`
// and silently skip hooks for Rust-side callers using `Default::default()`.)
impl Default for CommitOptions {
    fn default() -> Self {
        Self {
            amend: false,
            signoff: false,
            reset_author: false,
            run_hooks: true,
            author: None,
        }
    }
}

/// Result of a successful commit. Carries the new oid plus a small bag of
/// observability output (hook stdout/stderr) so the UI can show "look,
/// pre-commit ran your formatter and these files were re-staged" toasts.
#[derive(Debug, Serialize, Deserialize)]
pub struct CommitOutcome {
    pub oid: String,
    /// True when this overwrote HEAD (amend) rather than chaining a new tip.
    pub amended: bool,
    /// True when post-commit ran (purely observational).
    pub post_commit_ran: bool,
}

/// Create a commit using the current index via `git commit`. Hooks,
/// sign-off, amend semantics and `commit.gpgsign` are all handled natively
/// by git itself — the flag mapping below mirrors the options the old
/// hand-rolled libgit2 commit path supported.
pub fn commit_changes(
    path: &str,
    message: &str,
    opts: &CommitOptions,
) -> Result<CommitOutcome, GitError> {
    let mut args = vec![cli::s("commit")];
    if opts.amend {
        args.push(cli::s("--amend"));
    }
    if opts.signoff {
        args.push(cli::s("--signoff"));
    }
    if !opts.run_hooks {
        args.push(cli::s("--no-verify"));
    }
    let author = opts.author.as_deref().map(str::trim).unwrap_or("");
    if !author.is_empty() {
        args.push(cli::s("--author"));
        args.push(cli::s(author));
    } else if opts.amend && opts.reset_author {
        // The old code honoured an explicit author override over
        // reset_author; `--author` above already covers that precedence.
        args.push(cli::s("--reset-author"));
    }
    args.push(cli::s("-m"));
    args.push(cli::s(message));

    cli::run(path, &args)?;

    let post_commit_ran = opts.run_hooks && post_commit_hook_exists(path)?;
    let oid = cli::stdout_utf8(path, &[cli::s("rev-parse"), cli::s("HEAD")])?;
    Ok(CommitOutcome {
        oid: oid.trim().to_string(),
        amended: opts.amend,
        post_commit_ran,
    })
}

/// Best-effort probe for the "post-commit hook ran" toast. Resolves the
/// hooks directory the way git would (`rev-parse --git-path hooks` honours
/// `core.hooksPath`) and reports whether a runnable `post-commit` exists.
/// git itself ran the hook during `git commit`; we only observe.
fn post_commit_hook_exists(path: &str) -> Result<bool, GitError> {
    let raw = cli::stdout_utf8(
        path,
        &[cli::s("rev-parse"), cli::s("--git-path"), cli::s("hooks")],
    )?;
    let mut dir = PathBuf::from(raw.trim());
    if dir.is_relative() {
        dir = cli::workdir(path)?.join(dir);
    }
    let hook = dir.join("post-commit");
    if !hook.is_file() {
        return Ok(false);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        Ok(std::fs::metadata(&hook)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false))
    }
    #[cfg(not(unix))]
    {
        // Windows has no execute bit; existence is the cheap signal git's
        // own hooks machinery effectively uses.
        Ok(true)
    }
}

/// Full commit message of HEAD (`git log -1 --format=%B`), or `None` on an
/// unborn HEAD. Backs the Changes panel's amend toggle, which prefills the
/// message editor from HEAD's message without going through libgit2's log
/// machinery.
pub fn head_commit_message(path: &str) -> Result<Option<String>, GitError> {
    let out = cli::run_status(path, &[cli::s("log"), cli::s("-1"), cli::s("--format=%B")])?;
    if !out.status.success() {
        // Unborn HEAD — nothing to prefill.
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).into_owned()))
}

// ---------- Working-tree file editor (v0.13.3) ----------
//
// These three commands back the bidirectional Diff editor. The editor only
// engages on tracked text files inside the working tree; binary files and
// path-traversal attempts are refused up front.

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024; // 8 MB — refuse anything larger.

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkingFileText {
    /// Full file contents as UTF-8 (with original line endings).
    pub content: String,
    /// True when the file does not currently exist (e.g. about to be created).
    pub missing: bool,
}

/// Resolve a repo-relative path to an absolute path, refusing anything that
/// escapes the working directory after canonicalisation.
///
/// Implementation note: `std::fs::canonicalize` requires the path to exist,
/// but `write_working_file` may legitimately create new files (and even new
/// parent directories) — so we walk up to the nearest *existing* ancestor,
/// canonicalise that, and verify it sits inside the workdir. The portion of
/// the path that doesn't exist yet is structurally appended after the safety
/// check, so it can't introduce new traversal opportunities.
fn safe_workdir_path(workdir: &Path, file: &str) -> Result<PathBuf, GitError> {
    let candidate = workdir.join(file);

    // Walk up until we find an existing ancestor (the workdir itself always
    // exists, so this terminates).
    let mut existing = candidate.as_path();
    loop {
        if existing.exists() {
            break;
        }
        match existing.parent() {
            Some(p) => existing = p,
            None => return Err(GitError::new("invalid path: no existing ancestor")),
        }
    }

    let canonical_existing = std::fs::canonicalize(existing)
        .map_err(|e| GitError::new(format!("canonicalize ancestor: {e}")))?;
    let canonical_workdir = std::fs::canonicalize(workdir)
        .map_err(|e| GitError::new(format!("canonicalize workdir: {e}")))?;

    if !canonical_existing.starts_with(&canonical_workdir) {
        return Err(GitError::new(
            "path escapes the working directory — refusing",
        ));
    }

    // Reject explicit `..` traversal in the *unresolved* tail too, just in
    // case some component was a symlink that pointed back inside the workdir
    // before resolving but encoded `..` segments in the relative form.
    if file.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(GitError::new(
            "path escapes the working directory — refusing",
        ));
    }

    Ok(candidate)
}

/// Heuristic: the file's first 8 KiB has a NUL byte → treat as binary.
/// Mirrors libgit2's own `is_binary` heuristic for diff content.
fn looks_binary(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8192)];
    head.contains(&0)
}

/// Read a tracked or untracked file from the working directory. Used by the
/// bidirectional Diff editor to seed the editable buffer.
pub fn read_working_file(path: &str, file: &str) -> Result<WorkingFileText, GitError> {
    let workdir = cli::workdir(path)?;
    let abs = safe_workdir_path(&workdir, file)?;

    if !abs.exists() {
        return Ok(WorkingFileText {
            content: String::new(),
            missing: true,
        });
    }

    let metadata =
        std::fs::metadata(&abs).map_err(|e| GitError::new(format!("stat: {e}")))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(GitError::new(format!(
            "file is too large to edit ({} bytes; limit {} bytes)",
            metadata.len(),
            MAX_FILE_BYTES
        )));
    }

    let bytes = std::fs::read(&abs).map_err(|e| GitError::new(format!("read: {e}")))?;
    if looks_binary(&bytes) {
        return Err(GitError::new(
            "binary file — bidirectional editor refuses to load",
        ));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| GitError::new("file is not valid UTF-8 — refusing to edit"))?;
    Ok(WorkingFileText {
        content: text,
        missing: false,
    })
}

/// Read a file's contents at HEAD — used as the read-only "original" pane
/// next to the editable working-tree buffer. Returns `missing: true` when
/// the file isn't tracked at HEAD (e.g. brand-new working-tree file) or the
/// repository has no commits yet.
pub fn read_head_file(path: &str, file: &str) -> Result<WorkingFileText, GitError> {
    let workdir = cli::workdir(path)?;
    // Validate the path (rejects path-traversal); we don't need the absolute
    // path itself — just the safety check.
    let _ = safe_workdir_path(&workdir, file)?;

    // `cat-file -t` answers both "does HEAD exist?" (unborn → exit 1) and
    // "is this a blob?" (gitlinks / directories resolve to other types).
    let rev = format!("HEAD:{file}");
    let probe = cli::run_status(path, &[cli::s("cat-file"), cli::s("-t"), cli::s(&rev)])?;
    let is_blob = probe.status.success()
        && String::from_utf8_lossy(&probe.stdout).trim() == "blob";
    if !is_blob {
        return Ok(WorkingFileText {
            content: String::new(),
            missing: true,
        });
    }

    let bytes = cli::run(path, &[cli::s("show"), cli::s(&rev)])?.stdout;
    if looks_binary(&bytes) {
        return Err(GitError::new(
            "binary file — bidirectional editor refuses to load",
        ));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| GitError::new("HEAD blob is not valid UTF-8"))?;
    Ok(WorkingFileText {
        content: text,
        missing: false,
    })
}

/// Write a file back to the working directory atomically (write to a sibling
/// `.gittools-tmp-<rand>` file then rename), preserving the parent directory.
pub fn write_working_file(path: &str, file: &str, content: &str) -> Result<(), GitError> {
    let workdir = cli::workdir(path)?;
    let abs = safe_workdir_path(&workdir, file)?;

    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| GitError::new(format!("create parent dirs: {e}")))?;
    }

    let bytes = content.as_bytes();
    if (bytes.len() as u64) > MAX_FILE_BYTES {
        return Err(GitError::new(format!(
            "content is too large ({} bytes; limit {} bytes)",
            bytes.len(),
            MAX_FILE_BYTES
        )));
    }

    // Tmp filename combines the target name with a per-call random suffix so
    // concurrent saves to the same file (e.g. by two tabs of the app) don't
    // step on each other. The `XXXXXX` is replaced atomically by the runtime.
    let parent = abs
        .parent()
        .ok_or_else(|| GitError::new("invalid path: no parent"))?;
    let stem = abs.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    // Use process id + a monotonically increasing counter for uniqueness;
    // we deliberately avoid pulling in `rand` for this single call site.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let tag = COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(".{stem}.gittools-tmp-{}-{tag}", std::process::id()));

    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp)
            .map_err(|e| GitError::new(format!("create tmp: {e}")))?;
        f.write_all(bytes)
            .map_err(|e| GitError::new(format!("write tmp: {e}")))?;
        f.sync_all()
            .map_err(|e| GitError::new(format!("fsync tmp: {e}")))?;
    }
    std::fs::rename(&tmp, &abs).map_err(|e| GitError::new(format!("rename: {e}")))?;
    Ok(())
}
