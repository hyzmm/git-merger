//! Git worktree helpers — list / add / remove / prune (v0.13.36 — CLI
//! edition).
//!
//! A "worktree" is an additional checkout of the same repository at a
//! different filesystem path, allowing simultaneous work on multiple
//! branches without re-stashing. The main checkout is also reported in
//! `list()` (with `is_main: true`) so the UI can show a complete picture.
//!
//! All operations shell out to the user's `git` binary via `cli.rs`
//! instead of using libgit2, mirroring the approach already used by the
//! Changes panel backend.

use super::cli::{self, GitError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct WorktreeInfo {
    /// Worktree name. For the main checkout this is the repo directory's
    /// final component; for additional worktrees it is the name registered
    /// under `.git/worktrees/<name>`.
    pub name: String,
    /// Absolute path of the worktree's working directory.
    pub path: String,
    /// Short branch name currently checked out (e.g. `feat/login`). `None`
    /// when the worktree is in detached-HEAD state or unreadable.
    pub branch: Option<String>,
    /// HEAD commit oid of this worktree, when readable.
    pub head_oid: Option<String>,
    /// True for the main checkout (the parent repo itself).
    pub is_main: bool,
    /// True when the worktree's gitdir entry is locked (`git worktree lock`).
    pub is_locked: bool,
    /// True when the worktree is prunable — typically when the working
    /// directory has been deleted on disk but the metadata in
    /// `.git/worktrees/<name>` still exists.
    pub is_prunable: bool,
}

/// Parse one block of `git worktree list --porcelain` output into
/// (path, head_oid, branch, locked, prunable).
fn parse_porcelain_block(block: &str) -> Option<(String, Option<String>, Option<String>, bool, bool)> {
    let mut wt_path = None;
    let mut head = None;
    let mut branch = None;
    let mut locked = false;
    let mut prunable = false;

    for line in block.lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            wt_path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            head = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            branch = Some(rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string());
        } else if line == "locked" {
            locked = true;
        } else if line == "prunable" {
            prunable = true;
        }
    }

    wt_path.map(|p| (p, head, branch, locked, prunable))
}

pub fn list(path: &str) -> Result<Vec<WorktreeInfo>, GitError> {
    let out = cli::run(path, &[cli::s("worktree"), cli::s("list"), cli::s("--porcelain")])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    let mut entries: Vec<(String, Option<String>, Option<String>, bool, bool)> = Vec::new();

    // Porcelain blocks are separated by blank lines.
    for block in stdout.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        if let Some(entry) = parse_porcelain_block(block) {
            entries.push(entry);
        }
    }

    let mut result: Vec<WorktreeInfo> = Vec::new();

    if let Some((wt_path, head, branch, _, _)) = entries.first() {
        let p = Path::new(wt_path);
        let name = p
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("(main)")
            .to_string();
        result.push(WorktreeInfo {
            name,
            path: wt_path.clone(),
            branch: branch.clone(),
            head_oid: head.clone(),
            is_main: true,
            is_locked: false,
            is_prunable: false,
        });
    }

    // Linked worktrees — read `.git/worktrees/` to discover names, then
    // build a reverse map from each metadata dir's `gitdir` file back to
    // the worktree path so we can match porcelain entries.
    //
    // This also works for *prunable* worktrees whose working directory
    // has been deleted on disk: the metadata under `.git/worktrees/<name>`
    // (including the `gitdir` backlink) still exists until `git worktree
    // prune` removes it.
    let git_dir = cli::stdout_utf8(path, &[cli::s("rev-parse"), cli::s("--git-common-dir")])?;
    let git_dir = PathBuf::from(git_dir.trim());
    // Resolve relative git-dir against the repo path, then canonicalize
    // so that symlink components (e.g. macOS /var → /private/var) are
    // normalised — the porcelain output always uses canonical paths.
    let abs_git_dir = if git_dir.is_absolute() {
        git_dir
    } else {
        Path::new(path).join(git_dir)
    };
    let abs_git_dir = abs_git_dir
        .canonicalize()
        .unwrap_or(abs_git_dir);
    let worktrees_dir = abs_git_dir.join("worktrees");

    // Reverse map: canonical worktree path → (name, metadata gitdir path).
    let mut path_to_name: std::collections::HashMap<String, (String, PathBuf)> =
        std::collections::HashMap::new();

    if let Ok(dir_entries) = std::fs::read_dir(&worktrees_dir) {
        for dir_entry in dir_entries.flatten() {
            let name = dir_entry.file_name().to_string_lossy().into_owned();
            let wt_gitdir = worktrees_dir.join(&name);

            // Read the `gitdir` file inside the metadata dir — it contains
            // the absolute path to the worktree's `.git` file.  The parent
            // of that path is the worktree's working directory.
            let gitdir_file = wt_gitdir.join("gitdir");
            if let Ok(content) = std::fs::read_to_string(&gitdir_file) {
                let content = content.trim();
                if !content.is_empty() {
                    let wt_dot_git = PathBuf::from(content);
                    let wt_path = wt_dot_git
                        .parent()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    // Store under both the raw and canonical forms so
                    // matching works regardless of symlinks.
                    let canonical = wt_dot_git
                        .canonicalize()
                        .ok()
                        .and_then(|p| {
                            p.parent()
                                .map(|pp| pp.to_string_lossy().into_owned())
                        });
                    path_to_name.insert(wt_path, (name.clone(), wt_gitdir.clone()));
                    if let Some(c) = canonical {
                        path_to_name.insert(c, (name, wt_gitdir));
                    }
                }
            }
        }
    }

    // Walk the remaining porcelain entries (skip index 0 = main).
    // Match by trying the raw path first, then canonical forms to
    // handle symlinks (e.g. macOS /var → /private/var).
    for (wt_path, head, branch, locked_porcelain, prunable) in entries.iter().skip(1) {
        let matched = path_to_name.get(wt_path).cloned().or_else(|| {
            let canon_porcelain = Path::new(wt_path)
                .canonicalize()
                .ok()?
                .to_string_lossy()
                .into_owned();
            path_to_name.get(&canon_porcelain).cloned()
        });

        let (name, wt_gitdir) = match matched {
            Some(pair) => pair,
            None => continue,
        };
        let is_locked =
            *locked_porcelain || wt_gitdir.join("locked").exists();

        result.push(WorktreeInfo {
            name,
            path: wt_path.clone(),
            branch: branch.clone(),
            head_oid: head.clone(),
            is_main: false,
            is_locked,
            is_prunable: *prunable,
        });
    }

    Ok(result)
}

/// Add a new worktree at `target_path`.
///
/// - `name`: identifier under `.git/worktrees/<name>`. If empty, the path's
///   basename is used.
/// - `branch`: optional existing branch name to check out. When `None`,
///   git creates a new branch named after the worktree.
/// - `target_path`: the filesystem path for the new working directory.
///   May be relative to the parent repo's workdir, or absolute.
pub fn add(
    repo_path: &str,
    name: &str,
    target_path: &str,
    branch: Option<&str>,
) -> Result<WorktreeInfo, GitError> {
    // Resolve target path: absolute as-is, otherwise relative to parent workdir.
    let abs_target: PathBuf = {
        let p = Path::new(target_path);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            cli::workdir(repo_path)?.join(p)
        }
    };

    // Default name to the path's basename when empty.
    let final_name = if name.is_empty() {
        abs_target
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("worktree")
            .to_string()
    } else {
        name.to_string()
    };

    let abs_str = abs_target.to_string_lossy();
    let mut args = vec![cli::s("worktree"), cli::s("add")];
    args.push(cli::s(&abs_str));
    if let Some(b) = branch {
        args.push(cli::s(b));
    }

    cli::run(repo_path, &args)?;

    // Re-list to return the freshly created entry.
    let all = list(repo_path)?;
    Ok(all
        .into_iter()
        .find(|w| w.name == final_name && !w.is_main)
        .unwrap_or(WorktreeInfo {
            name: final_name,
            path: abs_target.to_string_lossy().to_string(),
            branch: branch.map(String::from),
            head_oid: None,
            is_main: false,
            is_locked: false,
            is_prunable: false,
        }))
}

/// Remove a linked worktree by name, deleting both the metadata under
/// `.git/worktrees/<name>` and the working directory on disk.
///
/// Refuses to operate on the main checkout. When `force` is false the
/// worktree must be in a clean, prunable state; pass `force = true` to
/// allow removal while the working tree still exists.
pub fn remove(repo_path: &str, name: &str, force: bool) -> Result<(), GitError> {
    let mut args = vec![cli::s("worktree"), cli::s("remove")];
    if force {
        args.push(cli::s("--force"));
    }
    args.push(cli::s(name));
    cli::run(repo_path, &args)?;
    Ok(())
}

/// Prune worktree metadata for any registered worktrees whose working
/// directories have disappeared from disk. Returns the list of names that
/// were actually pruned.
pub fn prune(repo_path: &str) -> Result<Vec<String>, GitError> {
    let before = list(repo_path)?;
    let before_names: std::collections::HashSet<String> =
        before.into_iter().filter(|w| !w.is_main).map(|w| w.name).collect();

    cli::run(
        repo_path,
        &[cli::s("worktree"), cli::s("prune")],
    )?;

    let after = list(repo_path)?;
    let after_names: std::collections::HashSet<String> =
        after.into_iter().filter(|w| !w.is_main).map(|w| w.name).collect();

    let pruned: Vec<String> = before_names
        .difference(&after_names)
        .cloned()
        .collect();

    Ok(pruned)
}
