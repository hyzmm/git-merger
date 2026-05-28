use git2::{IndexAddOption, ObjectType, Repository, Status, StatusOptions};
use serde::{Deserialize, Serialize};

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

pub fn working_changes(path: &str) -> Result<Vec<WorkingFile>, git2::Error> {
    let repo = Repository::discover(path)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut out: Vec<WorkingFile> = Vec::with_capacity(statuses.len());
    for entry in statuses.iter() {
        let p = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };
        let s = entry.status();

        if s.is_ignored() {
            continue;
        }

        let in_index = s.is_index_new()
            || s.is_index_modified()
            || s.is_index_deleted()
            || s.is_index_renamed()
            || s.is_index_typechange();
        let in_wt = s.is_wt_new()
            || s.is_wt_modified()
            || s.is_wt_deleted()
            || s.is_wt_renamed()
            || s.is_wt_typechange();

        let flag = if s.is_conflicted() {
            WorkingFlag::Conflict
        } else if s.is_wt_new() && !in_index {
            WorkingFlag::Untracked
        } else if in_index && in_wt {
            WorkingFlag::Both
        } else if in_index {
            WorkingFlag::Staged
        } else if in_wt {
            WorkingFlag::Unstaged
        } else {
            continue;
        };

        // Pick a primary "what kind" status. Index takes precedence over WT.
        let status = if s.is_conflicted() {
            WorkingStatus::Conflict
        } else if s.is_index_new() || s.is_wt_new() {
            // distinguish brand-new untracked vs added-to-index
            if matches!(flag, WorkingFlag::Untracked) {
                WorkingStatus::Untracked
            } else {
                WorkingStatus::Added
            }
        } else if s.is_index_deleted() || s.is_wt_deleted() {
            WorkingStatus::Deleted
        } else if s.is_index_renamed() || s.is_wt_renamed() {
            WorkingStatus::Renamed
        } else if s.is_index_typechange() || s.is_wt_typechange() {
            WorkingStatus::Typechange
        } else if s.is_index_modified() || s.is_wt_modified() {
            WorkingStatus::Modified
        } else if s.contains(Status::CURRENT) {
            continue;
        } else {
            WorkingStatus::Modified
        };

        out.push(WorkingFile {
            path: p,
            flag,
            status,
        });
    }
    Ok(out)
}

/// Stage a list of paths (works for adds, modifications, and untracked files).
pub fn stage_files(path: &str, paths: &[String]) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let mut index = repo.index()?;
    let pathspecs: Vec<&str> = paths.iter().map(String::as_str).collect();
    index.add_all(&pathspecs, IndexAddOption::DEFAULT, None)?;
    index.write()?;
    Ok(())
}

/// Unstage paths — reset their index entry to match HEAD's tree.
pub fn unstage_files(path: &str, paths: &[String]) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let head = repo.head()?.peel(ObjectType::Commit)?;
    let pathspecs: Vec<&str> = paths.iter().map(String::as_str).collect();
    repo.reset_default(Some(&head), pathspecs.iter())?;
    Ok(())
}

/// Discard working-tree changes — checkout the index version of the listed
/// files, overwriting any modifications. For untracked files we just delete
/// them from the working tree.
pub fn discard_files(path: &str, paths: &[String]) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| git2::Error::from_str("repository has no workdir (bare repo)"))?;

    // Separate untracked files (need filesystem deletion) from tracked ones.
    let mut tracked: Vec<&str> = Vec::new();
    let mut untracked: Vec<&str> = Vec::new();
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let untracked_set: std::collections::HashSet<String> = statuses
        .iter()
        .filter_map(|e| {
            if e.status().is_wt_new() && !e.status().is_index_new() {
                e.path().map(String::from)
            } else {
                None
            }
        })
        .collect();

    for p in paths.iter() {
        if untracked_set.contains(p) {
            untracked.push(p.as_str());
        } else {
            tracked.push(p.as_str());
        }
    }

    // Tracked: checkout from index, force-overwrite working tree.
    if !tracked.is_empty() {
        let mut co = git2::build::CheckoutBuilder::new();
        co.force();
        for p in &tracked {
            co.path(*p);
        }
        repo.checkout_index(None, Some(&mut co))?;
    }

    // Untracked: delete from filesystem.
    for p in untracked {
        let abs = workdir.join(p);
        let _ = std::fs::remove_file(&abs);
    }
    Ok(())
}

/// Options governing a commit operation. Captured as one struct so the
/// Tauri command surface stays small and easy to extend (we can add e.g.
/// `--allow-empty` later without re-shaping callers).
///
/// Defaults match `git commit` with no flags.
#[derive(Debug, Clone, Default, Deserialize)]
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
}

fn default_run_hooks() -> bool {
    true
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

/// Create a commit using the current index. Honours `commit.gpgsign`
/// (v0.13.19), optional sign-off trailer (v0.13.20), optional amend mode
/// (v0.13.20), and the user's `pre-commit` / `commit-msg` / `post-commit`
/// hooks (v0.13.20).
///
/// Hook semantics mirror upstream git:
///   1. `pre-commit` runs against the staged tree; non-zero exit aborts.
///   2. The message is written to a temp file and `commit-msg <path>` is
///      invoked; the hook may rewrite the file in place. Non-zero aborts.
///   3. The (possibly rewritten) message is used to build the commit
///      object, signed if requested.
///   4. `post-commit` runs after success; failures are non-fatal.
pub fn commit_changes(
    path: &str,
    message: &str,
    opts: &CommitOptions,
) -> Result<CommitOutcome, git2::Error> {
    let repo = Repository::discover(path)?;

    // ---- 1. pre-commit hook ----
    if opts.run_hooks {
        if let super::hooks::HookOutcome::Failed { exit_code, stderr } =
            super::hooks::run_pre_commit(&repo)
        {
            return Err(git2::Error::from_str(&format!(
                "pre-commit hook failed (exit {exit_code}):\n{stderr}"
            )));
        }
    }

    // ---- 2. resolve signatures + parents ----
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let cfg_sig = repo.signature()?;

    // Author / committer / parent layout depends on amend.
    let (author, committer, parents_owned, amended): (
        git2::Signature<'_>,
        git2::Signature<'_>,
        Vec<git2::Commit<'_>>,
        bool,
    ) = if opts.amend {
        let head = head_commit.clone().ok_or_else(|| {
            git2::Error::from_str("cannot --amend on an unborn HEAD: there is no commit to amend")
        })?;
        // Parents come from the original HEAD's parents (we're replacing it,
        // not chaining onto it).
        let parents: Vec<git2::Commit<'_>> = (0..head.parent_count())
            .map(|i| head.parent(i))
            .collect::<Result<_, _>>()?;
        let author = if opts.reset_author {
            cfg_sig.clone()
        } else {
            head.author().to_owned()
        };
        // Committer is always "now, you", matching `git commit --amend`.
        (author, cfg_sig.clone(), parents, true)
    } else {
        let parents: Vec<git2::Commit<'_>> = head_commit.into_iter().collect();
        (cfg_sig.clone(), cfg_sig.clone(), parents, false)
    };

    // ---- 3. apply sign-off trailer (idempotent) ----
    let mut effective_message = message.trim().to_string();
    if opts.signoff {
        let name = cfg_sig.name().unwrap_or("");
        let email = cfg_sig.email().unwrap_or("");
        if !name.is_empty() && !email.is_empty() {
            effective_message = super::signing::append_signoff(&effective_message, name, email);
        }
    }

    // ---- 4. commit-msg hook (may rewrite the message) ----
    if opts.run_hooks
        && super::hooks::hook_path(&repo, super::hooks::CommitHook::CommitMsg).is_some()
    {
        // Write message to a temp file inside the .git dir so hook
        // tools (e.g. commitizen) that look for `.git/COMMIT_EDITMSG`-
        // style siblings still find them. We use a unique name to
        // avoid clobbering an in-progress real commit edit.
        let msg_path = repo.path().join("GITTOOLS_COMMIT_EDITMSG");
        std::fs::write(&msg_path, effective_message.as_bytes())
            .map_err(|e| git2::Error::from_str(&format!("write commit-msg buffer: {e}")))?;

        match super::hooks::run_commit_msg(&repo, &msg_path) {
            super::hooks::HookOutcome::Failed { exit_code, stderr } => {
                let _ = std::fs::remove_file(&msg_path);
                return Err(git2::Error::from_str(&format!(
                    "commit-msg hook failed (exit {exit_code}):\n{stderr}"
                )));
            }
            super::hooks::HookOutcome::Ok => {
                // Re-read whatever the hook left behind.
                if let Ok(rewritten) = std::fs::read_to_string(&msg_path) {
                    effective_message = rewritten;
                }
            }
            super::hooks::HookOutcome::Skipped => {}
        }
        let _ = std::fs::remove_file(&msg_path);
    }

    // ---- 5. write tree + commit object (signed if configured) ----
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let parent_refs: Vec<&git2::Commit<'_>> = parents_owned.iter().collect();
    let oid = super::signing::commit_to_head(
        &repo,
        &author,
        &committer,
        effective_message.trim(),
        &tree,
        &parent_refs,
    )?;

    // ---- 6. post-commit hook (non-fatal) ----
    let post_commit_ran = if opts.run_hooks {
        matches!(
            super::hooks::run_post_commit(&repo),
            super::hooks::HookOutcome::Ok
        )
    } else {
        false
    };

    Ok(CommitOutcome {
        oid: oid.to_string(),
        amended,
        post_commit_ran,
    })
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
fn safe_workdir_path(repo: &Repository, file: &str) -> Result<std::path::PathBuf, git2::Error> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| git2::Error::from_str("repository has no workdir (bare repo)"))?;
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
            None => {
                return Err(git2::Error::from_str("invalid path: no existing ancestor"));
            }
        }
    }

    let canonical_existing = std::fs::canonicalize(existing)
        .map_err(|e| git2::Error::from_str(&format!("canonicalize ancestor: {e}")))?;
    let canonical_workdir = std::fs::canonicalize(workdir)
        .map_err(|e| git2::Error::from_str(&format!("canonicalize workdir: {e}")))?;

    if !canonical_existing.starts_with(&canonical_workdir) {
        return Err(git2::Error::from_str(
            "path escapes the working directory — refusing",
        ));
    }

    // Reject explicit `..` traversal in the *unresolved* tail too, just in
    // case some component was a symlink that pointed back inside the workdir
    // before resolving but encoded `..` segments in the relative form.
    if file.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(git2::Error::from_str(
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
pub fn read_working_file(path: &str, file: &str) -> Result<WorkingFileText, git2::Error> {
    let repo = Repository::discover(path)?;
    let abs = safe_workdir_path(&repo, file)?;

    if !abs.exists() {
        return Ok(WorkingFileText {
            content: String::new(),
            missing: true,
        });
    }

    let metadata =
        std::fs::metadata(&abs).map_err(|e| git2::Error::from_str(&format!("stat: {e}")))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(git2::Error::from_str(&format!(
            "file is too large to edit ({} bytes; limit {} bytes)",
            metadata.len(),
            MAX_FILE_BYTES
        )));
    }

    let bytes = std::fs::read(&abs).map_err(|e| git2::Error::from_str(&format!("read: {e}")))?;
    if looks_binary(&bytes) {
        return Err(git2::Error::from_str(
            "binary file — bidirectional editor refuses to load",
        ));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| git2::Error::from_str("file is not valid UTF-8 — refusing to edit"))?;
    Ok(WorkingFileText {
        content: text,
        missing: false,
    })
}

/// Read a file's contents at HEAD — used as the read-only "original" pane
/// next to the editable working-tree buffer. Returns `missing: true` when
/// the file isn't tracked at HEAD (e.g. brand-new working-tree file).
pub fn read_head_file(path: &str, file: &str) -> Result<WorkingFileText, git2::Error> {
    let repo = Repository::discover(path)?;
    // Validate the path (rejects path-traversal); we don't need the absolute
    // path itself — just the safety check.
    let _ = safe_workdir_path(&repo, file)?;

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => {
            // Empty repo (no HEAD yet).
            return Ok(WorkingFileText {
                content: String::new(),
                missing: true,
            });
        }
    };
    let tree = head.peel_to_tree()?;
    let entry = match tree.get_path(std::path::Path::new(file)) {
        Ok(e) => e,
        Err(e) if e.code() == git2::ErrorCode::NotFound => {
            return Ok(WorkingFileText {
                content: String::new(),
                missing: true,
            });
        }
        Err(e) => return Err(e),
    };
    let blob = repo.find_blob(entry.id())?;
    let bytes = blob.content();
    if looks_binary(bytes) {
        return Err(git2::Error::from_str(
            "binary file — bidirectional editor refuses to load",
        ));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| git2::Error::from_str("HEAD blob is not valid UTF-8"))?
        .to_string();
    Ok(WorkingFileText {
        content: text,
        missing: false,
    })
}

/// Write a file back to the working directory atomically (write to a sibling
/// `.gittools-tmp-<rand>` file then rename), preserving the parent directory.
pub fn write_working_file(path: &str, file: &str, content: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let abs = safe_workdir_path(&repo, file)?;

    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| git2::Error::from_str(&format!("create parent dirs: {e}")))?;
    }

    let bytes = content.as_bytes();
    if (bytes.len() as u64) > MAX_FILE_BYTES {
        return Err(git2::Error::from_str(&format!(
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
        .ok_or_else(|| git2::Error::from_str("invalid path: no parent"))?;
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
            .map_err(|e| git2::Error::from_str(&format!("create tmp: {e}")))?;
        f.write_all(bytes)
            .map_err(|e| git2::Error::from_str(&format!("write tmp: {e}")))?;
        f.sync_all()
            .map_err(|e| git2::Error::from_str(&format!("fsync tmp: {e}")))?;
    }
    std::fs::rename(&tmp, &abs).map_err(|e| git2::Error::from_str(&format!("rename: {e}")))?;
    Ok(())
}
