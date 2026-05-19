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

/// Create a normal commit using the current index. Author/committer come from
/// the user's git config.
pub fn commit_changes(path: &str, message: &str) -> Result<String, git2::Error> {
    let repo = Repository::discover(path)?;
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = repo.signature()?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit<'_>> = parent.as_ref().map(|c| vec![c]).unwrap_or_default();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message.trim(), &tree, &parents)?;
    Ok(oid.to_string())
}
