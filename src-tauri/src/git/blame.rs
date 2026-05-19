use git2::{BlameOptions, Repository};
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
    let text = String::from_utf8_lossy(&bytes).to_string();
    let lines: Vec<&str> = text.split('\n').collect();

    let mut out: Vec<BlameLine> = Vec::with_capacity(lines.len());

    // Pre-fetch commit summaries for hunks.
    for (idx, line) in lines.iter().enumerate() {
        let lineno = idx + 1; // 1-based
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
