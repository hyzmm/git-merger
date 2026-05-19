use super::RepoInfo;
use git2::Repository;

pub fn open(path: &str) -> Result<RepoInfo, git2::Error> {
    let repo = Repository::discover(path)?;
    let head = repo.head().ok().and_then(|h| h.shorthand().map(String::from));
    let is_bare = repo.is_bare();
    let path = repo
        .workdir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    Ok(RepoInfo { path, head, is_bare })
}
