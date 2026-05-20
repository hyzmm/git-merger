use git2::{BlameOptions, DiffOptions, Oid, Repository};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct BlameLine {
    /// 1-based line number in the final file.
    pub line: u32,
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// unix seconds
    pub time: i64,
    pub content: String,
}

/// What `previous_filename` returns. Used by the UI to follow a rename
/// chain backwards (one step at a time, like IDEA's "Annotate Previous
/// Revision").
#[derive(Debug, Serialize, Deserialize)]
pub struct PrevFile {
    /// Old path (before the rename / when the file was last edited).
    pub path: String,
    /// Commit that produced this old version.
    pub oid: String,
    pub short_oid: String,
}

/// Compute `git blame` for `file` at HEAD. Returns one entry per line of the
/// working-tree file content.
pub fn blame_file(path: &str, file: &str) -> Result<Vec<BlameLine>, git2::Error> {
    let repo = Repository::discover(path)?;

    let mut opts = BlameOptions::new();
    opts.track_copies_same_commit_moves(true)
        .track_copies_same_commit_copies(true);

    let rel = std::path::Path::new(file);
    let blame = repo.blame_file(rel, Some(&mut opts))?;

    // Read the file content from the working tree to get per-line text.
    let workdir = repo
        .workdir()
        .ok_or_else(|| git2::Error::from_str("repository has no workdir (bare repo)"))?;
    let abs = workdir.join(file);
    let bytes = std::fs::read(&abs)
        .map_err(|e| git2::Error::from_str(&format!("read file failed: {e}")))?;
    build_blame_lines(&repo, &blame, &bytes)
}

/// Blame `file` at `revision` (any committish). Reads the file's blob from
/// that commit's tree — works for files that have since been renamed or
/// deleted, which is what makes "follow rename" useful.
pub fn blame_at_revision(
    path: &str,
    file: &str,
    revision: &str,
) -> Result<Vec<BlameLine>, git2::Error> {
    let repo = Repository::discover(path)?;

    let mut opts = BlameOptions::new();
    opts.track_copies_same_commit_moves(true)
        .track_copies_same_commit_copies(true);
    let rev_oid = repo.revparse_single(revision)?.peel_to_commit()?.id();
    opts.newest_commit(rev_oid);

    let rel = std::path::Path::new(file);
    let blame = repo.blame_file(rel, Some(&mut opts))?;

    // Read the file content from the commit's tree (not the working tree),
    // so historical / renamed paths still work.
    let commit = repo.find_commit(rev_oid)?;
    let tree = commit.tree()?;
    let entry = tree.get_path(rel)?;
    let blob = repo.find_blob(entry.id())?;
    let bytes = blob.content().to_vec();
    build_blame_lines(&repo, &blame, &bytes)
}

fn build_blame_lines(
    repo: &Repository,
    blame: &git2::Blame<'_>,
    bytes: &[u8],
) -> Result<Vec<BlameLine>, git2::Error> {
    let text = String::from_utf8_lossy(bytes).to_string();
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out: Vec<BlameLine> = Vec::with_capacity(lines.len());
    for (idx, line) in lines.iter().enumerate() {
        let lineno = idx + 1;
        let hunk = match blame.get_line(lineno) {
            Some(h) => h,
            None => continue,
        };
        let oid = hunk.final_commit_id();
        let commit = repo.find_commit(oid).ok();
        let (summary, author_name, author_email, time) = match commit.as_ref() {
            Some(c) => {
                let sig = c.author();
                (
                    c.summary().unwrap_or("").to_string(),
                    sig.name().unwrap_or("").to_string(),
                    sig.email().unwrap_or("").to_string(),
                    c.time().seconds(),
                )
            }
            None => (String::new(), String::new(), String::new(), 0),
        };
        let oid_str = oid.to_string();
        out.push(BlameLine {
            line: lineno as u32,
            short_oid: oid_str.chars().take(7).collect(),
            oid: oid_str,
            summary,
            author_name,
            author_email,
            time,
            content: line.to_string(),
        });
    }
    Ok(out)
}

/// Find the previous (path, commit) for `file` as it existed at `at_revision`.
///
/// "Previous" here means: walk back from `at_revision` along the first parent
/// chain until we find a commit that DIFFERS for this file vs its parent,
/// then return that parent's path. If the file was renamed in that commit,
/// rename detection picks up the old name. Returns Ok(None) when we hit
/// the first commit in which the file appears (no further history).
pub fn previous_filename(
    path: &str,
    file: &str,
    at_revision: &str,
) -> Result<Option<PrevFile>, git2::Error> {
    let repo = Repository::discover(path)?;
    let start = repo.revparse_single(at_revision)?.peel_to_commit()?;

    // Walk first-parent chain.
    let mut current = start;
    let tracked_path = file.to_string();

    loop {
        if current.parent_count() == 0 {
            // Root commit — file was introduced here, no "previous".
            return Ok(None);
        }
        let parent = current.parent(0)?;

        let new_tree = current.tree()?;
        let parent_tree = parent.tree()?;

        // Diff parent → current, with rename detection.
        let mut opts = DiffOptions::new();
        opts.pathspec(&tracked_path);
        let mut diff =
            repo.diff_tree_to_tree(Some(&parent_tree), Some(&new_tree), Some(&mut opts))?;

        let mut find = git2::DiffFindOptions::new();
        find.renames(true).copies(true);
        let _ = diff.find_similar(Some(&mut find));

        let mut hit: Option<(String, Oid)> = None;
        let mut was_added = false;
        for delta in diff.deltas() {
            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if new_path != tracked_path {
                continue;
            }
            if delta.status() == git2::Delta::Added {
                was_added = true;
                break;
            }
            let old_path = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| tracked_path.clone());
            hit = Some((old_path, parent.id()));
            break;
        }

        if was_added {
            return Ok(None);
        }
        if let Some((old_path, parent_oid)) = hit {
            let oid_str = parent_oid.to_string();
            return Ok(Some(PrevFile {
                path: old_path,
                short_oid: oid_str.chars().take(7).collect(),
                oid: oid_str,
            }));
        }
        // This commit didn't touch the file at all — keep walking back.
        current = parent;
    }
}
