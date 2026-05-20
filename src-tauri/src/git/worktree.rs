//! Git worktree helpers — list / add / remove / prune.
//!
//! A "worktree" is an additional checkout of the same repository at a
//! different filesystem path, allowing simultaneous work on multiple
//! branches without re-stashing. The main checkout is also reported in
//! `list()` (with `is_main: true`) so the UI can show a complete picture.

use git2::{Repository, WorktreeAddOptions, WorktreePruneOptions};
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
    /// True when libgit2 considers the worktree pruneable — typically when
    /// the working directory has been deleted on disk but the metadata in
    /// `.git/worktrees/<name>` still exists.
    pub is_prunable: bool,
}

/// Read HEAD of a repository (parent or auxiliary worktree) and return
/// (short branch name, head oid string).
fn head_summary(repo: &Repository) -> (Option<String>, Option<String>) {
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return (None, None),
    };
    let oid = head.target().map(|o| o.to_string());
    let branch = if head.is_branch() {
        head.shorthand().map(String::from)
    } else {
        None
    };
    (branch, oid)
}

pub fn list(path: &str) -> Result<Vec<WorktreeInfo>, git2::Error> {
    let parent = Repository::discover(path)?;

    let mut out: Vec<WorktreeInfo> = Vec::new();

    // 1) Main checkout. `Repository::workdir()` returns None for bare repos;
    //    we surface a placeholder name from the workdir basename.
    if let Some(wd) = parent.workdir() {
        let (branch, oid) = head_summary(&parent);
        let name = wd
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("(main)")
            .to_string();
        out.push(WorktreeInfo {
            name,
            path: wd.to_string_lossy().to_string(),
            branch,
            head_oid: oid,
            is_main: true,
            is_locked: false,
            is_prunable: false,
        });
    }

    // 2) Linked worktrees registered under .git/worktrees/<name>.
    let names = parent.worktrees()?;
    for name_opt in names.iter() {
        let name = match name_opt {
            Some(n) => n,
            None => continue,
        };
        let wt = match parent.find_worktree(name) {
            Ok(w) => w,
            Err(_) => continue,
        };

        let wt_path = wt.path().to_path_buf();
        let is_locked = wt
            .is_locked()
            .map(|s| !matches!(s, git2::WorktreeLockStatus::Unlocked))
            .unwrap_or(false);
        let is_prunable = wt.is_prunable(None).unwrap_or(false);

        // Open the worktree as a Repository to read its HEAD.
        let (branch, oid) = match Repository::open_from_worktree(&wt) {
            Ok(wr) => head_summary(&wr),
            Err(_) => (None, None),
        };

        out.push(WorktreeInfo {
            name: name.to_string(),
            path: wt_path.to_string_lossy().to_string(),
            branch,
            head_oid: oid,
            is_main: false,
            is_locked,
            is_prunable,
        });
    }

    Ok(out)
}

/// Add a new worktree at `target_path`.
///
/// - `name`: identifier under `.git/worktrees/<name>`. If empty, the path's
///   basename is used.
/// - `branch`: optional existing branch name to check out. When `None`,
///   libgit2 creates a new branch named after the worktree.
/// - `target_path`: the filesystem path for the new working directory.
///   May be relative to the parent repo's workdir, or absolute.
pub fn add(
    repo_path: &str,
    name: &str,
    target_path: &str,
    branch: Option<&str>,
) -> Result<WorktreeInfo, git2::Error> {
    let parent = Repository::discover(repo_path)?;

    // Resolve target path: absolute as-is, otherwise relative to parent workdir.
    let abs_target: PathBuf = {
        let p = Path::new(target_path);
        if p.is_absolute() {
            p.to_path_buf()
        } else if let Some(wd) = parent.workdir() {
            wd.join(p)
        } else {
            p.to_path_buf()
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

    let mut opts = WorktreeAddOptions::new();
    let reference = if let Some(b) = branch {
        Some(
            parent
                .find_branch(b, git2::BranchType::Local)?
                .into_reference(),
        )
    } else {
        None
    };
    if let Some(ref r) = reference {
        opts.reference(Some(r));
    }

    parent.worktree(&final_name, &abs_target, Some(&opts))?;

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
/// allow pruning while the working tree still exists.
pub fn remove(repo_path: &str, name: &str, force: bool) -> Result<(), git2::Error> {
    let parent = Repository::discover(repo_path)?;
    let wt = parent.find_worktree(name)?;

    let mut opts = WorktreePruneOptions::new();
    // `valid` allows pruning even when the worktree is considered valid by
    // libgit2 (i.e. the working directory still exists). `working_tree`
    // additionally removes the working directory contents.
    if force {
        opts.valid(true).working_tree(true);
    }

    wt.prune(Some(&mut opts))?;
    Ok(())
}

/// Prune worktree metadata for any registered worktrees whose working
/// directories have disappeared from disk. Returns the list of names that
/// were actually pruned.
pub fn prune(repo_path: &str) -> Result<Vec<String>, git2::Error> {
    let parent = Repository::discover(repo_path)?;
    let mut pruned = Vec::new();

    let names = parent.worktrees()?;
    for name_opt in names.iter() {
        let name = match name_opt {
            Some(n) => n,
            None => continue,
        };
        let wt = match parent.find_worktree(name) {
            Ok(w) => w,
            Err(_) => continue,
        };
        if wt.is_prunable(None).unwrap_or(false) {
            let mut opts = WorktreePruneOptions::new();
            if wt.prune(Some(&mut opts)).is_ok() {
                pruned.push(name.to_string());
            }
        }
    }

    Ok(pruned)
}
