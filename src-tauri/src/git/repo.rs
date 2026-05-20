use super::RepoInfo;
use git2::{Repository, TreeWalkMode, TreeWalkResult};

pub fn open(path: &str) -> Result<RepoInfo, git2::Error> {
    let repo = Repository::discover(path)?;
    let head = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));
    let is_bare = repo.is_bare();
    let path = repo
        .workdir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    Ok(RepoInfo {
        path,
        head,
        is_bare,
    })
}

/// List every tracked file (blob) in HEAD's tree. Used by the Command
/// Palette to fuzzy-search for files. Order is the natural tree-walk order;
/// the frontend sorts/ranks the result.
pub fn tracked_files(path: &str) -> Result<Vec<String>, git2::Error> {
    let repo = Repository::discover(path)?;
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(Vec::new()), // unborn HEAD on a fresh repo
    };
    let tree = head.peel_to_tree()?;

    let mut files = Vec::new();
    tree.walk(TreeWalkMode::PreOrder, |dir, entry| {
        if matches!(entry.kind(), Some(git2::ObjectType::Blob)) {
            if let Some(name) = entry.name() {
                files.push(format!("{dir}{name}"));
            }
        }
        TreeWalkResult::Ok
    })?;
    Ok(files)
}
