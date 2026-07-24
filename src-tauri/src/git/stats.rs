//! Repository-wide statistics aggregation — split into three independent
//! entry points so the frontend can load them in parallel with per-section
//! skeleton states.
//!
//! 1. `stats_overview` — FAST: commit metadata only (no tree diffs).
//!    Returns timeline, heatmap, author commit counts, hour/weekday dist.
//!
//! 2. `stats_branches` — MEDIUM: per-branch commit counts + lifecycle info.
//!    No per-commit diffs; only revwalk counting + merge-base queries.
//!
//! 3. `stats_churn` — SLOW (optimised): tree diffs for code churn, file
//!    hotspots, and per-author insertions/deletions.
//!    Optimisations: skip merge commits, use `diff.stats()` (no line
//!    callback), multi-threaded diff via `std::thread::scope`.

use git2::{BranchType, DiffOptions, Repository, Sort};
use serde::Serialize;
use std::collections::HashMap;

// ─── Public data structures ─────────────────────────────────────────────────

/// Fast metadata-only stats (no diffs).
#[derive(Debug, Serialize)]
pub struct StatsOverview {
    pub total_commits: usize,
    pub total_authors: usize,
    pub active_branches: usize,
    pub timeline: Vec<TimelinePoint>,
    pub heatmap: Vec<HeatmapDay>,
    pub authors: Vec<AuthorOverview>,
    pub hour_distribution: Vec<u32>,
    pub weekday_distribution: Vec<u32>,
}

#[derive(Debug, Serialize)]
pub struct TimelinePoint {
    /// ISO date "2024-01-15"
    pub period: String,
    pub commits: usize,
}

#[derive(Debug, Serialize)]
pub struct HeatmapDay {
    /// ISO date "2024-01-15"
    pub date: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct AuthorOverview {
    pub name: String,
    pub email: String,
    pub commits: usize,
    pub first_commit: i64,
    pub last_commit: i64,
}

/// Branch stats + lifecycle (no per-commit diffs).
#[derive(Debug, Serialize)]
pub struct StatsBranches {
    pub branches: Vec<BranchStats>,
    pub branch_lifecycle: Vec<BranchLifecycle>,
}

#[derive(Debug, Serialize)]
pub struct BranchStats {
    pub name: String,
    pub commits: usize,
}

#[derive(Debug, Serialize)]
pub struct BranchLifecycle {
    pub name: String,
    pub created_at: Option<i64>,
    pub last_commit: i64,
    pub commit_count: usize,
    pub merged: bool,
    pub ahead_of_main: usize,
}

/// Churn / diff-based stats (the expensive part).
#[derive(Debug, Serialize)]
pub struct StatsChurn {
    pub total_insertions: u64,
    pub total_deletions: u64,
    pub churn: Vec<ChurnPoint>,
    pub file_hotspots: Vec<FileHotspot>,
    pub author_churn: Vec<AuthorChurn>,
}

#[derive(Debug, Serialize)]
pub struct ChurnPoint {
    pub period: String,
    pub insertions: u64,
    pub deletions: u64,
}

#[derive(Debug, Serialize)]
pub struct FileHotspot {
    pub path: String,
    pub change_count: usize,
    pub total_churn: u64,
}

#[derive(Debug, Serialize)]
pub struct AuthorChurn {
    pub name: String,
    pub email: String,
    pub insertions: u64,
    pub deletions: u64,
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCAN_LIMIT: usize = 50_000;
/// Maximum commits to diff in the churn pass. Beyond this the UI would
/// take too long regardless of threading.
const CHURN_DIFF_LIMIT: usize = 10_000;

// ─── 1. Overview (FAST — metadata only) ─────────────────────────────────────

pub fn stats_overview(
    path: &str,
    since: Option<i64>,
    until: Option<i64>,
    branch: Option<&str>,
    author: Option<&str>,
    merge_by_name: bool,
) -> Result<StatsOverview, git2::Error> {
    let repo = Repository::discover(path)?;
    let head_commit = resolve_head(&repo, branch)?;

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    walk.push(head_commit.id())?;

    let since_ts = since.unwrap_or(0);
    let until_ts = until.unwrap_or(i64::MAX);
    let author_lower = author.map(|a| a.to_lowercase());
    let mut total_commits: usize = 0;
    let mut day_counts: HashMap<String, usize> = HashMap::new();
    let mut authors_map: HashMap<String, AuthorOverviewAcc> = HashMap::new();
    let mut hour_dist: Vec<u32> = vec![0; 24];
    let mut weekday_dist: Vec<u32> = vec![0; 7];

    for oid in walk.flatten().take(SCAN_LIMIT) {
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let ts = commit.time().seconds();
        if ts < since_ts {
            break;
        }
        if ts > until_ts {
            continue;
        }

        let commit_author = commit.author();
        let email = commit_author.email().unwrap_or("").to_string();
        let name = commit_author.name().unwrap_or("").to_string();

        // Always accumulate the full authors list (for the dropdown).
        // When merge_by_name is true, key by lowercase name instead of email.
        let key = if merge_by_name {
            name.to_lowercase()
        } else {
            email.clone()
        };

        let acc = authors_map.entry(key).or_insert_with(|| AuthorOverviewAcc {
            name: name.clone(),
            email: email.clone(),
            commits: 0,
            first_commit: ts,
            last_commit: ts,
        });
        acc.commits += 1;
        if ts < acc.first_commit {
            acc.first_commit = ts;
        }
        if ts > acc.last_commit {
            acc.last_commit = ts;
            acc.name = name.clone();
            // When merging by name, also update email to the most recent one.
            acc.email = email.clone();
        }

        // If an author filter is active, skip non-matching commits for
        // all other aggregations (timeline, heatmap, distributions).
        if let Some(ref filter) = author_lower {
            let match_target = if merge_by_name {
                name.to_lowercase()
            } else {
                email.to_lowercase()
            };
            if !match_target.contains(filter.as_str()) {
                continue;
            }
        }

        total_commits += 1;

        let day_str = ts_to_date(ts);
        *day_counts.entry(day_str.clone()).or_insert(0) += 1;

        let (hour, weekday) = ts_to_hour_weekday(ts);
        if hour < 24 {
            hour_dist[hour as usize] += 1;
        }
        if weekday < 7 {
            weekday_dist[weekday as usize] += 1;
        }
    }

    // Build timeline
    let mut timeline: Vec<TimelinePoint> = day_counts
        .iter()
        .map(|(d, &c)| TimelinePoint { period: d.clone(), commits: c })
        .collect();
    timeline.sort_by(|a, b| a.period.cmp(&b.period));

    let heatmap: Vec<HeatmapDay> = day_counts
        .iter()
        .map(|(d, &c)| HeatmapDay { date: d.clone(), count: c })
        .collect();

    let mut authors: Vec<AuthorOverview> = authors_map
        .into_values()
        .map(|a| AuthorOverview {
            name: a.name,
            email: a.email,
            commits: a.commits,
            first_commit: a.first_commit,
            last_commit: a.last_commit,
        })
        .collect();
    authors.sort_by(|a, b| b.commits.cmp(&a.commits));

    // Quick branch count (just count local branches with commits in range)
    let active_branches = count_active_branches(&repo, since_ts, until_ts)?;

    Ok(StatsOverview {
        total_commits,
        total_authors: authors.len(),
        active_branches,
        timeline,
        heatmap,
        authors,
        hour_distribution: hour_dist,
        weekday_distribution: weekday_dist,
    })
}

struct AuthorOverviewAcc {
    name: String,
    email: String,
    commits: usize,
    first_commit: i64,
    last_commit: i64,
}

/// When merge_by_name is true, the authors_map uses lowercase name as key.
/// The `AuthorOverviewAcc` always stores the most recent email, so the
/// returned `AuthorOverview` entries show the latest-known email for each name.

// ─── 2. Branches (MEDIUM — revwalk counts + lifecycle, no diffs) ────────────

pub fn stats_branches(
    path: &str,
    since: Option<i64>,
    until: Option<i64>,
) -> Result<StatsBranches, git2::Error> {
    let repo = Repository::discover(path)?;
    let since_ts = since.unwrap_or(0);
    let until_ts = until.unwrap_or(i64::MAX);
    let head_oid = repo.head().ok().and_then(|h| h.target());

    let mut branch_stats: Vec<BranchStats> = Vec::new();
    let mut lifecycle: Vec<BranchLifecycle> = Vec::new();

    for entry in repo.branches(Some(BranchType::Local))?.flatten() {
        let (br, _) = entry;
        let name = match br.name() {
            Ok(Some(n)) => n.to_string(),
            _ => continue,
        };
        let tip_oid = match br.get().target() {
            Some(o) => o,
            None => continue,
        };

        // Count commits in range (no diffs!)
        let mut bw = repo.revwalk()?;
        bw.set_sorting(Sort::TIME)?;
        bw.push(tip_oid)?;

        let mut commits: usize = 0;
        let mut last_commit_ts: i64 = 0;

        for oid in bw.flatten().take(SCAN_LIMIT) {
            let c = match repo.find_commit(oid) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let ts = c.time().seconds();
            if ts < since_ts {
                break;
            }
            if ts > until_ts {
                continue;
            }
            if commits == 0 {
                last_commit_ts = ts;
            }
            commits += 1;
        }

        branch_stats.push(BranchStats { name: name.clone(), commits });

        // Lifecycle: merge-base with HEAD, ahead count, merged status.
        let (created_at, ahead, merged) = if let Some(h_oid) = head_oid {
            if tip_oid == h_oid {
                (None, 0, false)
            } else {
                let mb = repo.merge_base(tip_oid, h_oid).ok();
                let created = mb.and_then(|mb_oid| {
                    repo.find_commit(mb_oid).ok().map(|c| c.time().seconds())
                });
                let (ahead_count, _) =
                    repo.graph_ahead_behind(tip_oid, h_oid).unwrap_or((0, 0));
                let is_merged = repo.graph_descendant_of(h_oid, tip_oid).unwrap_or(false);
                (created, ahead_count, is_merged)
            }
        } else {
            (None, 0, false)
        };

        lifecycle.push(BranchLifecycle {
            name,
            created_at,
            last_commit: last_commit_ts,
            commit_count: commits,
            merged,
            ahead_of_main: ahead,
        });
    }

    branch_stats.sort_by(|a, b| b.commits.cmp(&a.commits));
    lifecycle.sort_by(|a, b| b.commit_count.cmp(&a.commit_count));

    Ok(StatsBranches { branches: branch_stats, branch_lifecycle: lifecycle })
}

// ─── 3. Churn (SLOW — tree diffs, optimised + threaded) ─────────────────────

pub fn stats_churn(
    path: &str,
    since: Option<i64>,
    until: Option<i64>,
    branch: Option<&str>,
    author: Option<&str>,
    merge_by_name: bool,
) -> Result<StatsChurn, git2::Error> {
    let repo = Repository::discover(path)?;
    let head_commit = resolve_head(&repo, branch)?;

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    walk.push(head_commit.id())?;

    let since_ts = since.unwrap_or(0);
    let until_ts = until.unwrap_or(i64::MAX);
    let author_lower = author.map(|a| a.to_lowercase());

    // Phase 1: collect commit OIDs (non-merge only) — fast metadata scan.
    let mut oids: Vec<git2::Oid> = Vec::new();
    for oid in walk.flatten().take(SCAN_LIMIT) {
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let ts = commit.time().seconds();
        if ts < since_ts {
            break;
        }
        if ts > until_ts {
            continue;
        }
        // Skip merge commits — their diffs are expensive and less meaningful
        // for churn analysis (the individual commits already count the work).
        if commit.parent_count() > 1 {
            continue;
        }
        // Author filter.
        if let Some(ref filter) = author_lower {
            let email = commit.author().email().unwrap_or("").to_lowercase();
            if !email.contains(filter.as_str()) {
                continue;
            }
        }
        oids.push(oid);
        if oids.len() >= CHURN_DIFF_LIMIT {
            break;
        }
    }

    // Phase 2: compute diffs in parallel using thread::scope.
    // Each thread opens its own Repository handle (libgit2 repos are not Send).
    let repo_path = repo.path().to_path_buf();
    let work_dir = repo.workdir().map(|w| w.to_path_buf());
    let discover_path = work_dir.as_deref().unwrap_or(&repo_path);
    let discover_str = discover_path.to_string_lossy().to_string();

    // Split oids into chunks for parallel processing.
    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);
    let chunk_size = (oids.len() / num_threads).max(1);

    let results: Vec<Vec<CommitDiffResult>> = std::thread::scope(|s| {
        let mut handles = Vec::new();
        for chunk in oids.chunks(chunk_size) {
            let chunk = chunk.to_vec();
            let path_ref = &discover_str;
            handles.push(s.spawn(move || {
                let r = match Repository::discover(path_ref) {
                    Ok(r) => r,
                    Err(_) => return Vec::new(),
                };
                let mut out = Vec::with_capacity(chunk.len());
                for oid in &chunk {
                    let commit = match r.find_commit(*oid) {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    let ts = commit.time().seconds();
                    let day_str = ts_to_date(ts);
                    let author_info = commit.author();
                    let email = author_info.email().unwrap_or("").to_string();
                    let name = author_info.name().unwrap_or("").to_string();
                    let (ins, dels, files) = fast_diff_stats(&r, &commit);
                    out.push(CommitDiffResult { day_str, name, email, ins, dels, files });
                }
                out
            }));
        }
        handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
    });

    // Phase 3: aggregate results.
    let mut total_insertions: u64 = 0;
    let mut total_deletions: u64 = 0;
    let mut day_churn: HashMap<String, (u64, u64)> = HashMap::new();
    let mut file_map: HashMap<String, FileAcc> = HashMap::new();
    let mut author_churn: HashMap<String, (u64, u64, String, String)> = HashMap::new();

    for chunk in results {
        for r in chunk {
            total_insertions += r.ins;
            total_deletions += r.dels;

            let entry = day_churn.entry(r.day_str).or_insert((0, 0));
            entry.0 += r.ins;
            entry.1 += r.dels;

            // When merging by name, group by lowercase name; otherwise by email.
            let churn_key = if merge_by_name {
                r.name.to_lowercase()
            } else {
                r.email.clone()
            };
            let ae = author_churn.entry(churn_key).or_insert((0, 0, r.name.clone(), r.email.clone()));
            ae.0 += r.ins;
            ae.1 += r.dels;
            // Keep the most recent name/email for display.
            ae.2 = r.name;
            ae.3 = r.email;

            for (fpath, fi, fd) in &r.files {
                let fa = file_map.entry(fpath.clone()).or_insert(FileAcc { change_count: 0, total_churn: 0 });
                fa.change_count += 1;
                fa.total_churn += fi + fd;
            }
        }
    }

    let mut churn: Vec<ChurnPoint> = day_churn
        .iter()
        .map(|(d, &(i, del))| ChurnPoint { period: d.clone(), insertions: i, deletions: del })
        .collect();
    churn.sort_by(|a, b| a.period.cmp(&b.period));

    let mut file_hotspots: Vec<FileHotspot> = file_map
        .into_iter()
        .map(|(p, f)| FileHotspot { path: p, change_count: f.change_count, total_churn: f.total_churn })
        .collect();
    file_hotspots.sort_by(|a, b| b.total_churn.cmp(&a.total_churn));
    file_hotspots.truncate(15);

    let author_churn: Vec<AuthorChurn> = author_churn
        .into_iter()
        .map(|(_, (i, d, name, email))| AuthorChurn { name, email, insertions: i, deletions: d })
        .collect();

    Ok(StatsChurn {
        total_insertions,
        total_deletions,
        churn,
        file_hotspots,
        author_churn,
    })
}

struct CommitDiffResult {
    day_str: String,
    name: String,
    email: String,
    ins: u64,
    dels: u64,
    files: Vec<(String, u64, u64)>,
}

struct FileAcc {
    change_count: usize,
    total_churn: u64,
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Resolve the starting commit for a revwalk.
fn resolve_head<'r>(
    repo: &'r Repository,
    branch: Option<&str>,
) -> Result<git2::Commit<'r>, git2::Error> {
    match branch {
        Some(name) => {
            let b = repo.find_branch(name, BranchType::Local)?;
            let oid = b.get().target().unwrap_or_else(|| {
                repo.head()
                    .ok()
                    .and_then(|h| h.target())
                    .unwrap_or(git2::Oid::zero())
            });
            repo.find_commit(oid)
        }
        None => {
            let head = repo.head()?;
            head.peel_to_commit()
        }
    }
}

/// Fast diff stats: uses `diff.stats()` for totals + delta iteration for
/// per-file paths. NO line-by-line callback (the major perf improvement).
fn fast_diff_stats(
    repo: &Repository,
    commit: &git2::Commit<'_>,
) -> (u64, u64, Vec<(String, u64, u64)>) {
    let new_tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return (0, 0, Vec::new()),
    };
    let old_tree = if commit.parent_count() > 0 {
        commit.parent(0).ok().and_then(|p| p.tree().ok())
    } else {
        None
    };

    let mut opts = DiffOptions::new();
    let diff = match repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts)) {
        Ok(d) => d,
        Err(_) => return (0, 0, Vec::new()),
    };

    // diff.stats() computes ins/dels by scanning diff internals — much
    // faster than foreach with a line callback.
    let (total_ins, total_dels) = match diff.stats() {
        Ok(st) => (st.insertions() as u64, st.deletions() as u64),
        Err(_) => (0, 0),
    };

    // Collect per-file paths + approximate per-file churn from stats.
    // We use the delta list for paths and distribute total evenly as an
    // approximation for hotspots ranking (ranking by change_count is primary).
    let num_deltas = diff.deltas().len();
    let per_file_ins = if num_deltas > 0 { total_ins / num_deltas as u64 } else { 0 };
    let per_file_dels = if num_deltas > 0 { total_dels / num_deltas as u64 } else { 0 };

    let files: Vec<(String, u64, u64)> = diff
        .deltas()
        .map(|delta| {
            let path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            (path, per_file_ins, per_file_dels)
        })
        .collect();

    (total_ins, total_dels, files)
}

/// Count local branches that have at least one commit since `since_ts`.
fn count_active_branches(repo: &Repository, since_ts: i64, until_ts: i64) -> Result<usize, git2::Error> {
    let mut count = 0;
    for entry in repo.branches(Some(BranchType::Local))?.flatten() {
        let (br, _) = entry;
        let tip_oid = match br.get().target() {
            Some(o) => o,
            None => continue,
        };
        if let Ok(c) = repo.find_commit(tip_oid) {
            let ts = c.time().seconds();
            if ts >= since_ts && ts <= until_ts {
                count += 1;
            }
        }
    }
    Ok(count)
}

/// Convert unix timestamp to "YYYY-MM-DD" string (UTC).
fn ts_to_date(ts: i64) -> String {
    let days = ts.div_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Convert unix timestamp to (hour 0-23, weekday 0=Mon..6=Sun) in UTC.
fn ts_to_hour_weekday(ts: i64) -> (u32, u32) {
    let hour = ts.rem_euclid(86_400) / 3_600;
    let days = ts.div_euclid(86_400);
    let weekday = ((days + 3).rem_euclid(7)) as u32; // Mon=0
    (hour as u32, weekday)
}

/// Howard Hinnant's civil_from_days algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}
