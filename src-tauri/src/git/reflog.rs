//! Reflog access — list HEAD reflog so the UI can offer one-click "undo".

use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ReflogEntry {
    /// Position in the reflog. 0 = most recent (matches `git reflog`'s
    /// `HEAD@{0}` notation).
    pub index: usize,
    /// Commit OID this reflog entry now points TO (post-action HEAD).
    pub new_oid: String,
    pub short_new_oid: String,
    /// Commit OID HEAD pointed to BEFORE this action. Useful when the user
    /// wants to reset to "the state before X".
    pub old_oid: String,
    pub short_old_oid: String,
    /// Action message ("commit: …", "reset: moving to …", "checkout: …", …).
    pub message: String,
    /// Committer (or, in older versions, action author).
    pub committer_name: String,
    pub committer_email: String,
    /// Unix seconds.
    pub time: i64,
}

/// Read the reflog for a single ref. Defaults to "HEAD" — pass any other
/// ref name (e.g. "refs/heads/main") to inspect a branch's reflog.
pub fn list(path: &str, refname: Option<&str>) -> Result<Vec<ReflogEntry>, git2::Error> {
    let repo = Repository::discover(path)?;
    let r = refname.unwrap_or("HEAD");
    let reflog = repo.reflog(r)?;

    let mut out: Vec<ReflogEntry> = Vec::with_capacity(reflog.len());
    for (i, entry) in reflog.iter().enumerate() {
        let committer = entry.committer();
        let new_oid = entry.id_new().to_string();
        let old_oid = entry.id_old().to_string();
        out.push(ReflogEntry {
            index: i,
            short_new_oid: new_oid.chars().take(7).collect(),
            new_oid,
            short_old_oid: old_oid.chars().take(7).collect(),
            old_oid,
            message: entry.message().unwrap_or("").to_string(),
            committer_name: committer.name().unwrap_or("").to_string(),
            committer_email: committer.email().unwrap_or("").to_string(),
            time: committer.when().seconds(),
        });
    }
    Ok(out)
}
