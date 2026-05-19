use super::ConflictFile;
use git2::{Repository, RepositoryState};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeState {
    Clean,
    Merge,
    Revert,
    CherryPick,
    Bisect,
    Rebase,
    RebaseInteractive,
    RebaseMerge,
    ApplyMailbox,
    ApplyMailboxOrRebase,
}

fn map_state(s: RepositoryState) -> MergeState {
    match s {
        RepositoryState::Clean => MergeState::Clean,
        RepositoryState::Merge => MergeState::Merge,
        RepositoryState::Revert | RepositoryState::RevertSequence => MergeState::Revert,
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => MergeState::CherryPick,
        RepositoryState::Bisect => MergeState::Bisect,
        RepositoryState::Rebase => MergeState::Rebase,
        RepositoryState::RebaseInteractive => MergeState::RebaseInteractive,
        RepositoryState::RebaseMerge => MergeState::RebaseMerge,
        RepositoryState::ApplyMailbox => MergeState::ApplyMailbox,
        RepositoryState::ApplyMailboxOrRebase => MergeState::ApplyMailboxOrRebase,
    }
}

pub fn merge_state(path: &str) -> Result<MergeState, git2::Error> {
    let repo = Repository::discover(path)?;
    Ok(map_state(repo.state()))
}

pub fn conflicts(path: &str) -> Result<Vec<ConflictFile>, git2::Error> {
    let repo = Repository::discover(path)?;
    let index = repo.index()?;
    let mut out = Vec::new();
    if !index.has_conflicts() {
        return Ok(out);
    }
    for c in index.conflicts()?.flatten() {
        let path = c
            .our
            .as_ref()
            .or(c.their.as_ref())
            .or(c.ancestor.as_ref())
            .map(|e| String::from_utf8_lossy(&e.path).to_string())
            .unwrap_or_default();
        out.push(ConflictFile {
            path,
            ancestor: c.ancestor.as_ref().map(|e| e.id.to_string()),
            ours: c.our.as_ref().map(|e| e.id.to_string()),
            theirs: c.their.as_ref().map(|e| e.id.to_string()),
        });
    }
    Ok(out)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConflictContent {
    pub path: String,
    pub ancestor: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// Current working-tree content (with conflict markers, if not resolved).
    pub working: Option<String>,
}

fn read_blob_text(repo: &Repository, oid_str: &str) -> Result<String, git2::Error> {
    let oid = git2::Oid::from_str(oid_str)?;
    let blob = repo.find_blob(oid)?;
    Ok(String::from_utf8_lossy(blob.content()).to_string())
}

pub fn conflict_content(path: &str, file: &str) -> Result<ConflictContent, git2::Error> {
    let repo = Repository::discover(path)?;
    let mut out = ConflictContent {
        path: file.to_string(),
        ancestor: None,
        ours: None,
        theirs: None,
        working: None,
    };
    let mut index = repo.index()?;
    if index.has_conflicts() {
        for c in index.conflicts()?.flatten() {
            let p = c
                .our
                .as_ref()
                .or(c.their.as_ref())
                .or(c.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path).to_string())
                .unwrap_or_default();
            if p == file {
                if let Some(e) = &c.ancestor {
                    out.ancestor = read_blob_text(&repo, &e.id.to_string()).ok();
                }
                if let Some(e) = &c.our {
                    out.ours = read_blob_text(&repo, &e.id.to_string()).ok();
                }
                if let Some(e) = &c.their {
                    out.theirs = read_blob_text(&repo, &e.id.to_string()).ok();
                }
                break;
            }
        }
    }
    // Working-tree content (may not exist if file was deleted)
    if let Some(workdir) = repo.workdir() {
        let full = workdir.join(file);
        if let Ok(bytes) = std::fs::read(&full) {
            out.working = Some(String::from_utf8_lossy(&bytes).to_string());
        }
    }
    Ok(out)
}

/// Write `content` to the working-tree file at `file` and `git add` it,
/// removing the conflict from the index.
pub fn resolve_conflict(path: &str, file: &str, content: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| git2::Error::from_str("repository has no workdir (bare repo)"))?;
    let full = workdir.join(file);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| git2::Error::from_str(&format!("create_dir_all failed: {e}")))?;
    }
    std::fs::write(&full, content)
        .map_err(|e| git2::Error::from_str(&format!("write failed: {e}")))?;

    let mut index = repo.index()?;
    let rel = std::path::Path::new(file);
    index.remove_path(rel)?; // clear stage 1/2/3 entries
    index.add_path(rel)?; // add stage 0 from the new working tree
    index.write()?;
    Ok(())
}
