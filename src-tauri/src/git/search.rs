//! Cross-history code & message search (a.k.a. "Find in History").
//!
//! Three search modes:
//!
//! 1. **Message** — scan each commit's message (subject + body) for matches.
//!    Equivalent to `git log --grep=<pattern>`.
//! 2. **Diff content (pickaxe)** — only commits whose patch text contains
//!    `+` or `-` lines matching the pattern qualify. Equivalent to
//!    `git log -G<pattern>`. The dominant "find which commit introduced/
//!    removed this snippet" workflow.
//! 3. **Both** — union of the two above.
//!
//! `pattern_kind` controls whether the pattern is a literal substring (case
//! insensitive) or a Rust `regex` expression. Path scoping reuses the same
//! `pathspec` semantics as `git_log` so you can constrain the walk to a
//! directory or filename suffix.

use git2::{DiffFormat, DiffOptions, Repository, Sort};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    Message,
    Diff,
    Both,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PatternKind {
    Literal,
    Regex,
}

#[derive(Debug, Serialize)]
pub struct DiffHit {
    /// File the hit lives in (post-image path on rename).
    pub file: String,
    /// Patch context line number where the matching `+`/`-` line appears
    /// (best-effort — we count from the most recent hunk header).
    pub line_no: u32,
    /// `+` for added lines, `-` for removed lines.
    pub side: char,
    /// The matching line content (without the leading `+`/`-`/` `).
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub author_name: String,
    pub time: i64,
    /// True if the pattern matched the commit message itself.
    pub message_match: bool,
    /// `+/-` lines from the patch that matched (capped per commit so the
    /// payload stays bounded for huge diffs).
    pub diff_hits: Vec<DiffHit>,
}

#[derive(Debug, Serialize)]
pub struct SearchSummary {
    pub hits: Vec<SearchHit>,
    /// Number of commits actually walked (≤ `max_commits`).
    pub scanned: usize,
    /// True when we stopped before exhausting the DAG (hit `max_commits`).
    pub truncated: bool,
}

const MAX_DIFF_HITS_PER_COMMIT: usize = 20;
const DEFAULT_MAX_COMMITS: usize = 5_000;
/// Skip diff inspection for this commit if the patch text crosses the cap.
/// Pickaxe over a million-line vendored bundle isn't useful and freezes UI.
const MAX_PATCH_BYTES_PER_COMMIT: usize = 2_000_000;

#[allow(clippy::too_many_arguments)]
pub fn search_commits(
    repo_path: &str,
    pattern: &str,
    mode: SearchMode,
    pattern_kind: PatternKind,
    case_sensitive: bool,
    pathspec: Option<&str>,
    max_commits: Option<usize>,
    max_hits: Option<usize>,
) -> Result<SearchSummary, git2::Error> {
    if pattern.is_empty() {
        return Ok(SearchSummary {
            hits: Vec::new(),
            scanned: 0,
            truncated: false,
        });
    }

    let max_commits = max_commits.unwrap_or(DEFAULT_MAX_COMMITS).max(1);
    let max_hits = max_hits.unwrap_or(500).max(1);

    let re = build_regex(pattern, pattern_kind, case_sensitive)
        .map_err(|e| git2::Error::from_str(&format!("invalid pattern: {e}")))?;

    let repo = Repository::discover(repo_path)?;
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    if walk.push_head().is_err() {
        return Ok(SearchSummary {
            hits: Vec::new(),
            scanned: 0,
            truncated: false,
        });
    }

    let path_filter = pathspec.filter(|p| !p.is_empty());
    let mut hits: Vec<SearchHit> = Vec::new();
    let mut scanned: usize = 0;
    let mut truncated = false;

    for oid in walk.flatten() {
        if scanned >= max_commits {
            truncated = true;
            break;
        }
        if hits.len() >= max_hits {
            // We've already collected enough — stop scanning. Caller knows
            // truncation by the cap field, but we keep this distinct so a
            // result of "exact max_hits" doesn't lie about coverage.
            truncated = true;
            break;
        }
        scanned += 1;

        let commit = repo.find_commit(oid)?;

        // 1) Message check.
        let msg = commit.message().unwrap_or("");
        let message_match =
            matches!(mode, SearchMode::Message | SearchMode::Both) && re.is_match(msg);

        // 2) Diff check — only fire when needed.
        let mut diff_hits: Vec<DiffHit> = Vec::new();
        if matches!(mode, SearchMode::Diff | SearchMode::Both) {
            // For root commits we still want to surface "this commit
            // introduced X" — diff against an empty tree.
            let new_tree = commit.tree()?;
            let parent_tree = if commit.parent_count() > 0 {
                Some(commit.parent(0)?.tree()?)
            } else {
                None
            };
            let mut opts = DiffOptions::new();
            if let Some(spec) = path_filter {
                opts.pathspec(spec);
            }
            opts.context_lines(0);
            opts.interhunk_lines(0);
            let diff =
                repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&new_tree), Some(&mut opts))?;

            // Bail early on enormous patches.
            let mut byte_count = 0usize;
            let mut current_file = String::new();
            let mut current_line_new: u32 = 0;
            let mut current_line_old: u32 = 0;
            let mut over_budget = false;

            let _ = diff.print(DiffFormat::Patch, |delta, hunk, line| {
                if over_budget || diff_hits.len() >= MAX_DIFF_HITS_PER_COMMIT {
                    return true;
                }
                byte_count = byte_count.saturating_add(line.content().len());
                if byte_count > MAX_PATCH_BYTES_PER_COMMIT {
                    over_budget = true;
                    return true;
                }
                if let Some(p) = delta.new_file().path() {
                    current_file = p.to_string_lossy().to_string();
                }
                if let Some(h) = hunk {
                    current_line_new = h.new_start();
                    current_line_old = h.old_start();
                }
                let origin = line.origin();
                if origin == '+' || origin == '-' {
                    let text = std::str::from_utf8(line.content())
                        .unwrap_or("")
                        .trim_end_matches('\n')
                        .to_string();
                    if re.is_match(&text) {
                        let line_no = if origin == '+' {
                            line.new_lineno().unwrap_or(current_line_new)
                        } else {
                            line.old_lineno().unwrap_or(current_line_old)
                        };
                        diff_hits.push(DiffHit {
                            file: current_file.clone(),
                            line_no,
                            side: origin,
                            text,
                        });
                    }
                    if origin == '+' {
                        current_line_new = current_line_new.saturating_add(1);
                    } else {
                        current_line_old = current_line_old.saturating_add(1);
                    }
                }
                true
            });
        }

        if message_match || !diff_hits.is_empty() {
            let author = commit.author();
            hits.push(SearchHit {
                oid: oid.to_string(),
                short_oid: oid.to_string().chars().take(7).collect(),
                summary: commit.summary().unwrap_or("").to_string(),
                author_name: author.name().unwrap_or("").to_string(),
                time: commit.time().seconds(),
                message_match,
                diff_hits,
            });
        }
    }

    Ok(SearchSummary {
        hits,
        scanned,
        truncated,
    })
}

fn build_regex(
    pattern: &str,
    kind: PatternKind,
    case_sensitive: bool,
) -> Result<Regex, regex::Error> {
    let pat = match kind {
        PatternKind::Literal => regex::escape(pattern),
        PatternKind::Regex => pattern.to_string(),
    };
    RegexBuilder::new(&pat)
        .case_insensitive(!case_sensitive)
        .multi_line(true)
        .build()
}
