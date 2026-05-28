use super::CommitSummary;
use git2::{DiffOptions, Repository, Sort};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

/// Result of a paginated history walk. `next_cursor` is the **OID we stopped
/// at** (i.e. the parent that would start the next page); the next call should
/// pass it as `after`. `null` means we've reached the end of the walk.
#[derive(Debug, Serialize)]
pub struct LogPage {
    pub commits: Vec<CommitSummary>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

pub fn log(
    path: &str,
    limit: usize,
    skip: usize,
    pathspec: Option<&str>,
) -> Result<Vec<CommitSummary>, git2::Error> {
    let repo = Repository::discover(path)?;

    // Build map oid -> Vec<refname>
    let mut refmap: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    for r in repo.references()?.flatten() {
        if let Some(target) = r.target() {
            let name = r.shorthand().unwrap_or("").to_string();
            if !name.is_empty() {
                refmap.entry(target).or_default().push(name);
            }
        }
    }

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    if walk.push_head().is_err() {
        return Ok(Vec::new()); // empty repo
    }

    // When a pathspec is provided, only keep commits that touch that path
    // (mirrors `git log -- <path>`). For the root commit (no parents), we
    // include it if its tree contains the path.
    let path_filter = pathspec.filter(|p| !p.is_empty());

    let mut seen: usize = 0;
    let mut out = Vec::with_capacity(limit);
    for oid in walk.flatten() {
        let c = repo.find_commit(oid)?;
        if let Some(spec) = path_filter {
            let touched = commit_touches_path(&repo, &c, spec).unwrap_or(false);
            if !touched {
                continue;
            }
        }
        if seen < skip {
            seen += 1;
            continue;
        }
        if out.len() >= limit {
            break;
        }

        let parents: Vec<String> = c.parent_ids().map(|p| p.to_string()).collect();
        let author = c.author();
        out.push(CommitSummary {
            oid: oid.to_string(),
            short_oid: oid.to_string().chars().take(7).collect(),
            summary: c.summary().unwrap_or("").to_string(),
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            time: c.time().seconds(),
            parents,
            refs: refmap.get(&oid).cloned().unwrap_or_default(),
        });
    }

    Ok(out)
}

fn commit_touches_path(
    repo: &Repository,
    commit: &git2::Commit<'_>,
    spec: &str,
) -> Result<bool, git2::Error> {
    let new_tree = commit.tree()?;
    if commit.parent_count() == 0 {
        // Root commit — match if the file/dir exists in this tree.
        return Ok(new_tree.get_path(std::path::Path::new(spec)).is_ok());
    }
    let mut opts = DiffOptions::new();
    opts.pathspec(spec);
    for i in 0..commit.parent_count() {
        let parent = commit.parent(i)?;
        let parent_tree = parent.tree()?;
        let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&new_tree), Some(&mut opts))?;
        if diff.deltas().count() > 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Cursor-based pagination over the commit DAG.
///
/// - When `after` is `None`, the walk starts from `HEAD`.
/// - When `after` is `Some(oid)`, the walk starts from that commit's parents
///   (so the page after a given cursor contains the commits *strictly older*
///   than the one identified by the cursor — exactly what an "infinite scroll"
///   loader expects).
///
/// The returned `next_cursor` is the OID of the **last commit** in this page,
/// suitable for being passed back as `after` on the next call. When
/// `has_more == false`, `next_cursor` is the same OID for callers that want
/// to keep state, but the next call will simply yield an empty page.
pub fn log_page(
    path: &str,
    after: Option<&str>,
    limit: usize,
    pathspec: Option<&str>,
) -> Result<LogPage, git2::Error> {
    let repo = Repository::discover(path)?;

    let mut refmap: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    for r in repo.references()?.flatten() {
        if let Some(target) = r.target() {
            let name = r.shorthand().unwrap_or("").to_string();
            if !name.is_empty() {
                refmap.entry(target).or_default().push(name);
            }
        }
    }

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;

    match after {
        None => {
            if walk.push_head().is_err() {
                return Ok(LogPage {
                    commits: Vec::new(),
                    has_more: false,
                    next_cursor: None,
                });
            }
        }
        Some(oid_str) => {
            // Start from the parents of the cursor commit. This guarantees the
            // cursor itself is NOT yielded again on the next page.
            let oid = git2::Oid::from_str(oid_str)?;
            let cursor_commit = repo.find_commit(oid)?;
            if cursor_commit.parent_count() == 0 {
                return Ok(LogPage {
                    commits: Vec::new(),
                    has_more: false,
                    next_cursor: None,
                });
            }
            for i in 0..cursor_commit.parent_count() {
                walk.push(cursor_commit.parent(i)?.id())?;
            }
        }
    }

    let path_filter = pathspec.filter(|p| !p.is_empty());
    let mut out: Vec<CommitSummary> = Vec::with_capacity(limit);
    let mut last_oid: Option<git2::Oid> = None;
    let mut walked_more = false;

    for oid in walk.flatten() {
        if out.len() >= limit {
            // We managed to pull at least one more entry past `limit`, so
            // there's definitely more work to do. Don't include it.
            walked_more = true;
            break;
        }
        let c = repo.find_commit(oid)?;
        if let Some(spec) = path_filter {
            let touched = commit_touches_path(&repo, &c, spec).unwrap_or(false);
            if !touched {
                continue;
            }
        }
        let parents: Vec<String> = c.parent_ids().map(|p| p.to_string()).collect();
        let author = c.author();
        out.push(CommitSummary {
            oid: oid.to_string(),
            short_oid: oid.to_string().chars().take(7).collect(),
            summary: c.summary().unwrap_or("").to_string(),
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            time: c.time().seconds(),
            parents,
            refs: refmap.get(&oid).cloned().unwrap_or_default(),
        });
        last_oid = Some(oid);
    }

    Ok(LogPage {
        commits: out,
        has_more: walked_more,
        next_cursor: last_oid.map(|o| o.to_string()),
    })
}

/// Rich, on-demand metadata for a single commit. Loaded lazily by the
/// CommitDetails pane when the user selects a row, in addition to the
/// summary + parent list already provided by the log page.
///
/// `containing_branches` / `containing_tags` answer the classic
/// "what released this fix?" question by walking every local branch and
/// every tag, asking libgit2's `graph_descendant_of` whether the tip
/// is the commit itself or a descendant of it. Remote branches are
/// included too so users can tell whether the change has already been
/// shipped upstream.
#[derive(Debug, Serialize)]
pub struct CommitMeta {
    pub oid: String,
    /// Full multi-line commit message (subject + body), as `git2::Commit::message`
    /// returns it. Trailing newline is preserved.
    pub message: String,
    /// First line — handy for headers when the body is collapsed.
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix seconds.
    pub author_time: i64,
    pub committer_name: String,
    pub committer_email: String,
    /// Unix seconds. Distinct from author_time for cherry-picked / rebased commits.
    pub committer_time: i64,
    pub parents: Vec<String>,
    /// Local + remote branches whose tip is this commit or a descendant of it.
    /// Local branches first (sorted alpha), then remote branches.
    pub containing_branches: Vec<String>,
    /// Tags (short name, no `refs/tags/` prefix) whose target is this commit
    /// or a descendant of it. Annotated tags are peeled before comparison.
    pub containing_tags: Vec<String>,
    /// Embedded GPG / SSH signature status (v0.13.19). Folded in here so the
    /// CommitDetails panel only needs one IPC round-trip per selection.
    pub signature: super::signing::CommitSignatureInfo,
}

pub fn commit_meta(path: &str, oid: &str) -> Result<CommitMeta, git2::Error> {
    let repo = Repository::discover(path)?;
    let target_oid = git2::Oid::from_str(oid)?;
    let commit = repo.find_commit(target_oid)?;

    let author = commit.author();
    let committer = commit.committer();

    let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();

    // ---- containing branches / tags --------------------------------------
    //
    // Old implementation called `graph_descendant_of(tip, target)` once per
    // ref. Each call internally walks back from `tip` until it hits target
    // or runs out of parents — O(refs × commits) total. On a monorepo with
    // 200 branches + 1 000 tags that's a multi-second hit every time the
    // user clicks a commit row.
    //
    // New implementation builds the **descendant set** of `target_oid`
    // *once* (single revwalk over every ref + child-map BFS), then does an
    // O(1) `HashSet::contains` per ref. Same answer, ~1-2 orders of
    // magnitude faster on big repos. Mirrors the trick already used by
    // `commit_relations::descendants` for the History highlight feature.
    let descendants = build_descendant_set(&repo, target_oid)?;

    let mut local_branches: Vec<String> = Vec::new();
    let mut remote_branches: Vec<String> = Vec::new();
    for kind in [git2::BranchType::Local, git2::BranchType::Remote] {
        for entry in repo.branches(Some(kind))?.flatten() {
            let (branch, _) = entry;
            let Some(name) = branch.name().ok().flatten() else {
                continue;
            };
            if name.ends_with("/HEAD") {
                continue;
            }
            let Some(tip_oid) = branch.get().target() else {
                continue;
            };
            if descendants.contains(&tip_oid) {
                match kind {
                    git2::BranchType::Local => local_branches.push(name.to_string()),
                    git2::BranchType::Remote => remote_branches.push(name.to_string()),
                }
            }
        }
    }
    local_branches.sort();
    remote_branches.sort();
    let mut containing_branches = local_branches;
    containing_branches.extend(remote_branches);

    // Tags. `tag_foreach` yields the *tag object oid* for annotated tags
    // (so we must peel) and the commit oid directly for lightweight tags.
    let mut containing_tags: Vec<String> = Vec::new();
    repo.tag_foreach(|raw_oid, name_bytes| {
        let name = String::from_utf8_lossy(name_bytes);
        let short = name.strip_prefix("refs/tags/").unwrap_or(&name).to_string();
        // Peel to get the underlying commit regardless of annotated-vs-lightweight.
        let commit_id = match repo
            .find_object(raw_oid, None)
            .and_then(|o| o.peel_to_commit())
        {
            Ok(c) => c.id(),
            Err(_) => return true, // skip broken refs, keep iterating
        };
        if descendants.contains(&commit_id) {
            containing_tags.push(short);
        }
        true
    })?;
    containing_tags.sort();

    // Embedded signature (v0.13.19) — folded into `commit_meta` so the
    // CommitDetails pane gets it for free with the same IPC call. Reuses
    // the already-discovered `repo`; failure is non-fatal and surfaces as
    // "Not signed" so the panel never blocks on a probe error.
    let signature = super::signing::commit_signature_info(&repo, oid).unwrap_or_else(|_| {
        super::signing::CommitSignatureInfo {
            signed: false,
            format: None,
            summary: "Not signed".to_string(),
        }
    });

    Ok(CommitMeta {
        oid: target_oid.to_string(),
        message: commit.message().unwrap_or("").to_string(),
        summary: commit.summary().unwrap_or("").to_string(),
        author_name: author.name().unwrap_or("").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        author_time: author.when().seconds(),
        committer_name: committer.name().unwrap_or("").to_string(),
        committer_email: committer.email().unwrap_or("").to_string(),
        committer_time: committer.when().seconds(),
        parents,
        containing_branches,
        containing_tags,
        signature,
    })
}

/// Build the set of every commit oid that is `target_oid` or a descendant
/// thereof, by:
///   1. Push every ref tip + the target itself into a single revwalk.
///   2. While walking, accumulate a `child_oid -> parent_oid[]` map.
///   3. BFS forward from `target_oid` through children.
///
/// We cap the scan at 200 000 commits so even pathological monorepos don't
/// hang the UI; the cap mirrors `commit_relations::descendants` for
/// behavioural symmetry. In practice every reachable commit fits in well
/// under that ceiling on real repos.
fn build_descendant_set(
    repo: &Repository,
    target_oid: git2::Oid,
) -> Result<HashSet<git2::Oid>, git2::Error> {
    const SCAN_LIMIT: usize = 200_000;

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    let _ = walk.push_glob("refs/heads/*");
    let _ = walk.push_glob("refs/remotes/*");
    let _ = walk.push_glob("refs/tags/*");
    // Make sure target itself is part of the scan even if it's not on any
    // ref (e.g. unreferenced commit shown via the user pasting a SHA).
    let _ = walk.push(target_oid);

    let mut children: HashMap<git2::Oid, Vec<git2::Oid>> = HashMap::new();
    for oid in walk.flatten().take(SCAN_LIMIT) {
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for p in commit.parent_ids() {
            children.entry(p).or_default().push(oid);
        }
    }

    let mut visited: HashSet<git2::Oid> = HashSet::new();
    let mut stack: Vec<git2::Oid> = vec![target_oid];
    visited.insert(target_oid);
    while let Some(oid) = stack.pop() {
        if let Some(kids) = children.get(&oid) {
            for &k in kids {
                if visited.insert(k) {
                    stack.push(k);
                }
            }
        }
    }
    Ok(visited)
}

/// Incremental "top-up" walk from HEAD towards a previously-known oid.
///
/// Used by the History view's *refresh* action when the in-memory commit
/// list is already populated. Instead of throwing the list away and
/// re-walking the entire DAG, we walk from HEAD newest-first, **stopping
/// the moment we hit `known_oid`**, and return only the commits strictly
/// newer than it. The frontend then prepends those to its existing list.
///
/// `known_oid == HEAD` (no new commits) returns an empty vec; `known_oid`
/// not reachable from HEAD (e.g. branch was reset / rewritten) returns
/// `None` so the caller can fall back to a full reload.
///
/// `cap` is a safety net for catastrophic divergence — if we walk that
/// many commits without hitting `known_oid`, we give up and the caller
/// falls back to a full reload. Default 5 000 should be plenty for any
/// realistic background-tab refresh.
///
/// v0.13.21.
pub fn log_since(
    path: &str,
    known_oid: &str,
    cap: usize,
) -> Result<Option<Vec<CommitSummary>>, git2::Error> {
    let repo = Repository::discover(path)?;
    let known = git2::Oid::from_str(known_oid)?;

    // refmap is needed to populate `refs` on the returned summaries, same
    // shape as `log` / `log_page`.
    let mut refmap: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    for r in repo.references()?.flatten() {
        if let Some(target) = r.target() {
            let name = r.shorthand().unwrap_or("").to_string();
            if !name.is_empty() {
                refmap.entry(target).or_default().push(name);
            }
        }
    }

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    if walk.push_head().is_err() {
        // Empty repo: nothing to top up.
        return Ok(Some(Vec::new()));
    }

    let mut out: Vec<CommitSummary> = Vec::new();
    let mut hit_known = false;
    for (i, oid) in walk.flatten().enumerate() {
        if oid == known {
            hit_known = true;
            break;
        }
        if i >= cap {
            // Bailed before finding the known cursor — likely a force-push
            // / reset rewrote history out from under us. Tell the caller to
            // fall back to a full reload.
            return Ok(None);
        }
        let c = repo.find_commit(oid)?;
        let parents: Vec<String> = c.parent_ids().map(|p| p.to_string()).collect();
        let author = c.author();
        out.push(CommitSummary {
            oid: oid.to_string(),
            short_oid: oid.to_string().chars().take(7).collect(),
            summary: c.summary().unwrap_or("").to_string(),
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            time: c.time().seconds(),
            parents,
            refs: refmap.get(&oid).cloned().unwrap_or_default(),
        });
    }

    if !hit_known {
        // Walked the entire reachable DAG without finding `known_oid` — it
        // was definitely orphaned. Same fallback signal as the cap branch.
        return Ok(None);
    }

    Ok(Some(out))
}
