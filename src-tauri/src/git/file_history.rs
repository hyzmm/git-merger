//! Per-file commit history with rename-following.
//!
//! Walks HEAD backwards collecting commits that touch a given path. When a
//! commit looks like a rename (added one path + deleted another with similar
//! content), we follow the chain by switching the tracked path to the old
//! one. This is the equivalent of `git log --follow -- <path>`.
//!
//! The walk stops early once we collect `limit` commits.

use git2::{Diff, DiffFindOptions, DiffOptions, Repository, Sort};
use serde::{Deserialize, Serialize};

use super::{ChangeStatus, CommitSummary};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileHistoryEntry {
    pub commit: CommitSummary,
    /// Path of the tracked file *at this commit*. May differ from the input
    /// when a rename occurred.
    pub path_at_commit: String,
    /// Status of this file in this commit relative to its parent (the first
    /// parent for merges).
    pub status: ChangeStatus,
    /// When the change is a rename, the previous path. None otherwise.
    pub old_path: Option<String>,
    pub insertions: usize,
    pub deletions: usize,
}

/// Compute the rename-following history of `start_path` starting from HEAD.
pub fn file_history(
    path: &str,
    start_path: &str,
    limit: usize,
) -> Result<Vec<FileHistoryEntry>, git2::Error> {
    let repo = Repository::discover(path)?;

    // Empty repo / unborn HEAD → empty history.
    let Ok(head) = repo.head() else {
        return Ok(Vec::new());
    };
    let head_commit = head.peel_to_commit()?;

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    walk.push(head_commit.id())?;

    let mut tracked = start_path.to_string();
    let mut out: Vec<FileHistoryEntry> = Vec::with_capacity(limit.min(256));

    for oid in walk.flatten() {
        if out.len() >= limit {
            break;
        }
        let commit = repo.find_commit(oid)?;

        // Compare against the first parent (matches git's --follow semantics
        // for merge commits — surface them only when they touch this file).
        let parent_tree = if commit.parent_count() > 0 {
            Some(commit.parent(0)?.tree()?)
        } else {
            None
        };
        let new_tree = commit.tree()?;

        let mut opts = DiffOptions::new();
        opts.pathspec(&tracked);
        let mut diff: Diff =
            repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&new_tree), Some(&mut opts))?;

        let mut find = DiffFindOptions::new();
        find.renames(true).copies(true);
        diff.find_similar(Some(&mut find))?;

        let mut matched: Option<(ChangeStatus, Option<String>, String, usize, usize)> = None;

        for delta in diff.deltas() {
            let new_path_str = delta
                .new_file()
                .path()
                .and_then(|p| p.to_str())
                .unwrap_or("");
            let old_path_str = delta
                .old_file()
                .path()
                .and_then(|p| p.to_str())
                .unwrap_or("");

            let touches = new_path_str == tracked || old_path_str == tracked;
            if !touches {
                continue;
            }

            // Compute line stats for this delta only.
            let (ins, del) = patch_line_stats(&repo, &commit, parent_tree.as_ref(), new_path_str);

            let (status, old) = match delta.status() {
                git2::Delta::Renamed => (ChangeStatus::Renamed, Some(old_path_str.to_string())),
                git2::Delta::Copied => (ChangeStatus::Copied, Some(old_path_str.to_string())),
                git2::Delta::Added => (ChangeStatus::Added, None),
                git2::Delta::Deleted => (ChangeStatus::Deleted, None),
                git2::Delta::Modified => (ChangeStatus::Modified, None),
                git2::Delta::Typechange => (ChangeStatus::Typechange, None),
                _ => (ChangeStatus::Modified, None),
            };

            matched = Some((status, old, new_path_str.to_string(), ins, del));
            break;
        }

        let Some((status, old_path, new_path_at_commit, insertions, deletions)) = matched else {
            // This commit doesn't touch the tracked path — skip it. Tracking
            // doesn't change.
            continue;
        };

        // For the "added" case (parent didn't have the file), there's nothing
        // earlier to follow. We still record this commit.
        let path_at_commit = if matches!(status, ChangeStatus::Renamed | ChangeStatus::Copied) {
            // The commit *introduced* this rename. After we record it, future
            // walk steps should track the OLD path to keep following.
            new_path_at_commit
        } else {
            tracked.clone()
        };

        let entry_path = path_at_commit.clone();

        let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();
        let author = commit.author();
        out.push(FileHistoryEntry {
            commit: CommitSummary {
                oid: oid.to_string(),
                short_oid: oid.to_string().chars().take(7).collect(),
                summary: commit.summary().unwrap_or("").to_string(),
                author_name: author.name().unwrap_or("").to_string(),
                author_email: author.email().unwrap_or("").to_string(),
                time: commit.time().seconds(),
                parents,
                refs: Vec::new(),
            },
            path_at_commit: entry_path,
            status,
            old_path: old_path.clone(),
            insertions,
            deletions,
        });

        // Switch tracked path on rename / copy so further walk follows the
        // old name.
        if let Some(old) = old_path {
            tracked = old;
        }
    }

    Ok(out)
}

/// Sum +/- line counts for a single new-side path within a commit.
fn patch_line_stats(
    repo: &Repository,
    commit: &git2::Commit<'_>,
    parent_tree: Option<&git2::Tree<'_>>,
    new_path: &str,
) -> (usize, usize) {
    let new_tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return (0, 0),
    };
    let mut opts = DiffOptions::new();
    opts.pathspec(new_path);
    let diff = match repo.diff_tree_to_tree(parent_tree, Some(&new_tree), Some(&mut opts)) {
        Ok(d) => d,
        Err(_) => return (0, 0),
    };
    let stats = match diff.stats() {
        Ok(s) => s,
        Err(_) => return (0, 0),
    };
    (stats.insertions(), stats.deletions())
}
