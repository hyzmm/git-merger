//! Stash workflow — list / save / apply / pop / drop.

use git2::{Repository, StashApplyOptions};
use serde::{Deserialize, Serialize};

use super::cli::{self, GitError};

#[derive(Debug, Serialize, Deserialize)]
pub struct StashEntry {
    /// Stack index (0 = most recent, matches `git stash list` ordering).
    pub index: usize,
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    /// Unix seconds. We use the stash commit's committer time.
    pub time: i64,
}

/// List all stashes in the repository, newest first (matches `git stash list`).
pub fn list(path: &str) -> Result<Vec<StashEntry>, git2::Error> {
    let mut repo = Repository::discover(path)?;
    // git2's stash_foreach returns entries newest-first which matches what
    // CLI users expect.
    let mut out: Vec<StashEntry> = Vec::new();
    repo.stash_foreach(|index, message, oid| {
        let oid_s = oid.to_string();
        out.push(StashEntry {
            index,
            short_oid: oid_s.chars().take(7).collect(),
            oid: oid_s,
            message: message.to_string(),
            time: 0, // filled in below
        });
        true
    })?;
    // Backfill the timestamp now that the borrow is released.
    for e in out.iter_mut() {
        if let Ok(commit) = repo
            .find_object(git2::Oid::from_str(&e.oid)?, None)
            .and_then(|o| o.peel_to_commit())
        {
            e.time = commit.time().seconds();
        }
    }
    Ok(out)
}

/// Create a new stash via `git stash push`. If `keep_index` is true, staged
/// changes are kept in the index after stashing (mirrors `git stash
/// --keep-index`). `include_untracked` mirrors `git stash -u`.
///
/// v0.13.35 — CLI edition, so it behaves like the terminal: when there is
/// nothing to stash no empty stash entry is created (the old libgit2 path
/// would leave an empty entry behind).
pub fn save(
    path: &str,
    message: Option<&str>,
    include_untracked: bool,
    keep_index: bool,
) -> Result<String, GitError> {
    let mut args = vec![cli::s("stash"), cli::s("push")];
    if include_untracked {
        args.push(cli::s("-u"));
    }
    if keep_index {
        args.push(cli::s("--keep-index"));
    }
    if let Some(m) = message {
        let m = m.trim();
        if !m.is_empty() {
            args.push(cli::s("-m"));
            args.push(cli::s(m));
        }
    }
    cli::run(path, &args)?;

    // Best-effort oid of the just-created entry; empty when git decided
    // there was nothing to save. The frontend ignores the value anyway.
    let oid = cli::run_status(
        path,
        &[
            cli::s("rev-parse"),
            cli::s("-q"),
            cli::s("--verify"),
            cli::s("stash@{0}"),
        ],
    )
    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    .unwrap_or_default();
    Ok(oid)
}

/// Apply stash @{index} without removing it from the stack.
pub fn apply(path: &str, index: usize) -> Result<(), git2::Error> {
    let mut repo = Repository::discover(path)?;
    let mut opts = StashApplyOptions::new();
    repo.stash_apply(index, Some(&mut opts))?;
    Ok(())
}

/// Apply stash @{index} and drop it on success (= `git stash pop`).
pub fn pop(path: &str, index: usize) -> Result<(), git2::Error> {
    let mut repo = Repository::discover(path)?;
    let mut opts = StashApplyOptions::new();
    repo.stash_pop(index, Some(&mut opts))?;
    Ok(())
}

/// Drop stash @{index} without applying it.
pub fn drop(path: &str, index: usize) -> Result<(), git2::Error> {
    let mut repo = Repository::discover(path)?;
    repo.stash_drop(index)?;
    Ok(())
}
