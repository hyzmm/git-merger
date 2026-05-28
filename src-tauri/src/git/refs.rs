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

    /// (v0.13.34) Upstream tracking branch name without the
    /// `refs/remotes/` prefix, e.g. `origin/main`. Only populated for
    /// local branches that have a configured upstream; `None` everywhere
    /// else (remote branches, tags, untracked locals).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,

    /// (v0.13.34) Number of commits the local branch is ahead of its
    /// upstream (commits we have, upstream doesn't). 0 when in sync,
    /// `None` when there is no upstream or computation failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<u32>,

    /// (v0.13.34) Number of commits the local branch is behind its
    /// upstream (commits upstream has, we don't). 0 when in sync,
    /// `None` when there is no upstream or computation failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<u32>,
}

/// Detailed view of a single tag, used by the dedicated TagsPage.
///
/// Compared to `RefEntry`, this also exposes the annotated-tag fields
/// (message + tagger) and a one-line summary of the **commit** the tag
/// ultimately points at, so the UI doesn't have to issue a second query
/// per row.
#[derive(Debug, Serialize, Deserialize)]
pub struct TagInfo {
    /// Short name without the `refs/tags/` prefix.
    pub name: String,
    /// True if the tag object stores its own message + tagger
    /// (= `git tag -a` / `-s`). False = lightweight tag = ref alone.
    pub is_annotated: bool,
    /// Annotated tag's own object oid; for lightweight tags this equals
    /// `target_oid`.
    pub tag_oid: Option<String>,
    /// The commit the tag ultimately resolves to.
    pub target_oid: String,
    pub target_short_oid: String,
    pub commit_summary: String,
    /// Annotated tag message (None for lightweight).
    pub message: Option<String>,
    pub tagger_name: Option<String>,
    pub tagger_email: Option<String>,
    /// Annotated tag time, or fallback to commit time. Unix seconds.
    pub time: i64,
}

pub fn list_refs(path: &str) -> Result<Vec<RefEntry>, git2::Error> {
    let repo = Repository::discover(path)?;
    let head_oid = repo.head().ok().and_then(|h| h.target());

    let mut out = Vec::new();

    // Local branches
    for b in repo.branches(Some(BranchType::Local))?.flatten() {
        let (branch, _) = b;
        if let Ok(Some(name)) = branch.name() {
            let local_oid = branch.get().target();
            let target = local_oid.map(|o| o.to_string());
            let is_head = branch.is_head();

            // (v0.13.34) Resolve upstream tracking ref + ahead/behind.
            //
            // `branch.upstream()` returns Err when no upstream is configured,
            // which is a totally normal state (a fresh local branch). We
            // treat any error here as "no upstream" rather than propagating —
            // a branch missing its upstream shouldn't break the whole
            // ref listing.
            let (upstream, ahead, behind) = match (local_oid, branch.upstream()) {
                (Some(local), Ok(up)) => {
                    let up_name = up.name().ok().flatten().map(str::to_string);
                    let up_oid = up.get().target();
                    let counts = up_oid.and_then(|u| repo.graph_ahead_behind(local, u).ok());
                    match counts {
                        Some((a, b)) => (up_name, Some(a as u32), Some(b as u32)),
                        None => (up_name, None, None),
                    }
                }
                _ => (None, None, None),
            };

            out.push(RefEntry {
                kind: RefKind::LocalBranch,
                name: name.to_string(),
                target,
                is_head,
                upstream,
                ahead,
                behind,
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
                upstream: None,
                ahead: None,
                behind: None,
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
            upstream: None,
            ahead: None,
            behind: None,
        });
        true
    })?;

    Ok(out)
}

/// List every tag in the repository with annotated metadata expanded.
///
/// Sorted newest-first by tag/commit time so the most recent releases
/// appear at the top of the panel.
pub fn list_tags(path: &str) -> Result<Vec<TagInfo>, git2::Error> {
    let repo = Repository::discover(path)?;

    // Collect (short_name, oid) pairs first to release the &repo borrow
    // taken by tag_foreach before we issue further lookups inside the loop.
    let mut pairs: Vec<(String, git2::Oid)> = Vec::new();
    repo.tag_foreach(|oid, name_bytes| {
        let name = String::from_utf8_lossy(name_bytes);
        let short = name.strip_prefix("refs/tags/").unwrap_or(&name).to_string();
        pairs.push((short, oid));
        true
    })?;

    let mut out: Vec<TagInfo> = Vec::with_capacity(pairs.len());
    for (short, oid) in pairs {
        let object = repo.find_object(oid, None)?;

        // Try to interpret the object as an annotated tag first; fall back
        // to treating `oid` as the directly-pointed commit.
        let (is_annotated, tag_oid, message, tagger_name, tagger_email, tag_time) =
            if let Ok(tag) = object.peel_to_tag() {
                let tagger = tag.tagger();
                (
                    true,
                    Some(tag.id().to_string()),
                    Some(tag.message().unwrap_or("").to_string()),
                    tagger.as_ref().and_then(|t| t.name()).map(str::to_string),
                    tagger.as_ref().and_then(|t| t.email()).map(str::to_string),
                    tagger.as_ref().map(|t| t.when().seconds()),
                )
            } else {
                (false, None, None, None, None, None)
            };

        // Resolve the underlying commit (annotated or lightweight).
        let commit = repo
            .find_object(oid, None)
            .and_then(|o| o.peel_to_commit())?;
        let commit_oid = commit.id().to_string();
        let short_oid = commit_oid.chars().take(7).collect::<String>();
        let summary = commit.summary().unwrap_or("").to_string();
        // Prefer tagger time when available (annotated), otherwise the
        // commit's time so lightweight tags still sort sensibly.
        let time = tag_time.unwrap_or_else(|| commit.time().seconds());

        out.push(TagInfo {
            name: short,
            is_annotated,
            tag_oid,
            target_oid: commit_oid,
            target_short_oid: short_oid,
            commit_summary: summary,
            message,
            tagger_name,
            tagger_email,
            time,
        });
    }

    // Newest first.
    out.sort_by_key(|t| std::cmp::Reverse(t.time));
    Ok(out)
}
