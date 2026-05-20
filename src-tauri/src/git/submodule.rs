//! Git submodule helpers — list / init / update / sync.

use git2::{Repository, SubmoduleIgnore, SubmoduleStatus};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SubmoduleInfo {
    pub name: String,
    pub path: String,
    pub url: Option<String>,
    /// HEAD commit recorded by the parent repo for this submodule. May be
    /// None when the submodule has never been fetched.
    pub head_oid: Option<String>,
    /// Currently checked-out commit inside the submodule's worktree.
    /// None when the submodule isn't initialised on disk.
    pub workdir_oid: Option<String>,
    /// True if `.git/modules/<name>` exists (submodule has been initialised).
    pub initialized: bool,
    /// True if the submodule has actually been cloned/checked-out.
    pub workdir_present: bool,
    /// True if the parent recorded a different commit than what the submodule
    /// currently has checked out.
    pub commit_changed: bool,
    /// True if there are uncommitted modifications inside the submodule.
    pub wd_dirty: bool,
}

pub fn list(path: &str) -> Result<Vec<SubmoduleInfo>, git2::Error> {
    let repo = Repository::discover(path)?;
    let names: Vec<String> = repo
        .submodules()?
        .iter()
        .filter_map(|sm| sm.name().map(String::from))
        .collect();

    let mut out = Vec::with_capacity(names.len());
    for name in names {
        let sm = match repo.find_submodule(&name) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let status = repo
            .submodule_status(&name, SubmoduleIgnore::None)
            .unwrap_or(SubmoduleStatus::empty());
        let initialized = !status.contains(SubmoduleStatus::WD_UNINITIALIZED);
        let workdir_present = sm.open().is_ok();
        let commit_changed = status.contains(SubmoduleStatus::WD_MODIFIED);
        let wd_dirty = status.contains(SubmoduleStatus::WD_INDEX_MODIFIED)
            || status.contains(SubmoduleStatus::WD_WD_MODIFIED)
            || status.contains(SubmoduleStatus::WD_UNTRACKED);

        let workdir_oid = sm.workdir_id().map(|o| o.to_string());

        out.push(SubmoduleInfo {
            name: sm.name().unwrap_or("").to_string(),
            path: sm.path().to_string_lossy().to_string(),
            url: sm.url().map(String::from),
            head_oid: sm.head_id().map(|o| o.to_string()),
            workdir_oid,
            initialized,
            workdir_present,
            commit_changed,
            wd_dirty,
        });
    }
    Ok(out)
}

/// Initialize a submodule (writes config from .gitmodules to .git/config).
pub fn init(path: &str, name: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let mut sm = repo.find_submodule(name)?;
    sm.init(false)?;
    Ok(())
}

/// Clone (if needed) + checkout a submodule to the parent-recorded commit.
pub fn update(path: &str, name: &str, init_first: bool) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let mut sm = repo.find_submodule(name)?;
    let mut opts = git2::SubmoduleUpdateOptions::new();
    sm.update(init_first, Some(&mut opts))?;
    Ok(())
}

/// Sync the submodule's remote URL from .gitmodules into its config.
pub fn sync(path: &str, name: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let mut sm = repo.find_submodule(name)?;
    sm.sync()
}
