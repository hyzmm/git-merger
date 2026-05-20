use git2::{BranchType, Repository};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefEntry {
    pub kind: RefKind,
    pub name: String,
    pub target: Option<String>,
    pub is_head: bool,
}

pub fn list_refs(path: &str) -> Result<Vec<RefEntry>, git2::Error> {
    let repo = Repository::discover(path)?;
    let head_oid = repo.head().ok().and_then(|h| h.target());

    let mut out = Vec::new();

    // Local branches
    for b in repo.branches(Some(BranchType::Local))?.flatten() {
        let (branch, _) = b;
        if let Ok(Some(name)) = branch.name() {
            let target = branch.get().target().map(|o| o.to_string());
            let is_head = branch.is_head();
            out.push(RefEntry {
                kind: RefKind::LocalBranch,
                name: name.to_string(),
                target,
                is_head,
            });
        }
    }

    // Remote branches
    for b in repo.branches(Some(BranchType::Remote))?.flatten() {
        let (branch, _) = b;
        if let Ok(Some(name)) = branch.name() {
            // Skip "origin/HEAD"-style symbolic remotes
            if name.ends_with("/HEAD") {
                continue;
            }
            let target = branch.get().target().map(|o| o.to_string());
            out.push(RefEntry {
                kind: RefKind::RemoteBranch,
                name: name.to_string(),
                target,
                is_head: false,
            });
        }
    }

    // Tags
    repo.tag_foreach(|oid, name_bytes| {
        let name = String::from_utf8_lossy(name_bytes);
        let short = name.strip_prefix("refs/tags/").unwrap_or(&name).to_string();
        let _ = head_oid;
        out.push(RefEntry {
            kind: RefKind::Tag,
            name: short,
            target: Some(oid.to_string()),
            is_head: false,
        });
        true
    })?;

    Ok(out)
}
