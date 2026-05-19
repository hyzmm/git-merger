use super::ConflictFile;
use git2::Repository;

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
