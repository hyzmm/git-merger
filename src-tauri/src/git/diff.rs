use super::{ChangeStatus, DiffHunk, DiffLine, FileChange, FileDiff};
use git2::{Delta, DiffOptions, Oid, Repository};
use std::cell::RefCell;

fn delta_to_status(d: Delta) -> ChangeStatus {
    match d {
        Delta::Added => ChangeStatus::Added,
        Delta::Deleted => ChangeStatus::Deleted,
        Delta::Modified => ChangeStatus::Modified,
        Delta::Renamed => ChangeStatus::Renamed,
        Delta::Copied => ChangeStatus::Copied,
        Delta::Typechange => ChangeStatus::Typechange,
        _ => ChangeStatus::Modified,
    }
}

/// File-level changes for a commit (vs first parent, or empty tree if root).
/// Accepts any committish (commit OID, branch, tag — annotated tags are
/// peeled to their target commit automatically).
pub fn commit_files(path: &str, oid: &str) -> Result<Vec<FileChange>, git2::Error> {
    let repo = Repository::discover(path)?;
    let commit = repo
        .find_object(Oid::from_str(oid)?, None)?
        .peel_to_commit()?;
    let new_tree = commit.tree()?;
    let old_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };

    let mut opts = DiffOptions::new();
    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))?;

    // Collect file deltas first, then enrich with patch line stats.
    let entries = RefCell::new(Vec::<FileChange>::new());
    diff.foreach(
        &mut |delta, _| {
            let status = delta_to_status(delta.status());
            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let old_path = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());
            entries.borrow_mut().push(FileChange {
                path: new_path,
                old_path,
                status,
                insertions: 0,
                deletions: 0,
            });
            true
        },
        None,
        None,
        None,
    )?;

    // Per-delta line stats via Patch.
    let mut out = entries.into_inner();
    for (idx, fc) in out.iter_mut().enumerate() {
        if let Ok(Some(patch)) = git2::Patch::from_diff(&diff, idx) {
            if let Ok((_ctx, adds, dels)) = patch.line_stats() {
                fc.insertions = adds;
                fc.deletions = dels;
            }
        }
    }

    Ok(out)
}

fn collect_file_diff(diff: &git2::Diff<'_>, target: &str) -> Result<FileDiff, git2::Error> {
    let result = RefCell::new(FileDiff {
        old_path: None,
        new_path: None,
        is_binary: false,
        hunks: Vec::new(),
    });

    diff.foreach(
        &mut |delta, _| {
            let new_path_match = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy() == target)
                .unwrap_or(false);
            let old_path_match = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy() == target)
                .unwrap_or(false);
            if new_path_match || old_path_match {
                let mut r = result.borrow_mut();
                r.is_binary = delta.new_file().is_binary() || delta.old_file().is_binary();
                r.new_path = delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().to_string());
                r.old_path = delta
                    .old_file()
                    .path()
                    .map(|p| p.to_string_lossy().to_string());
            }
            true
        },
        None,
        Some(&mut |delta, hunk| {
            let p = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if p == target {
                result.borrow_mut().hunks.push(DiffHunk {
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    header: String::from_utf8_lossy(hunk.header()).to_string(),
                    lines: Vec::new(),
                });
            }
            true
        }),
        Some(&mut |delta, _hunk, line| {
            let p = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if p != target {
                return true;
            }
            let mut r = result.borrow_mut();
            if let Some(h) = r.hunks.last_mut() {
                let origin = match line.origin() {
                    '+' => "+",
                    '-' => "-",
                    _ => " ",
                };
                h.lines.push(DiffLine {
                    origin: origin.to_string(),
                    old_lineno: line.old_lineno(),
                    new_lineno: line.new_lineno(),
                    content: String::from_utf8_lossy(line.content()).to_string(),
                });
            }
            true
        }),
    )?;
    Ok(result.into_inner())
}

pub fn file_diff(
    path: &str,
    oid: &str,
    file: &str,
    ignore_whitespace: bool,
) -> Result<FileDiff, git2::Error> {
    let repo = Repository::discover(path)?;
    let commit = repo
        .find_object(Oid::from_str(oid)?, None)?
        .peel_to_commit()?;
    let new_tree = commit.tree()?;
    let old_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        None
    };
    let mut opts = DiffOptions::new();
    opts.pathspec(file);
    if ignore_whitespace {
        opts.ignore_whitespace(true);
    }
    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))?;
    collect_file_diff(&diff, file)
}

pub fn working_diff(
    path: &str,
    file: &str,
    ignore_whitespace: bool,
) -> Result<FileDiff, git2::Error> {
    let repo = Repository::discover(path)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(file);
    if ignore_whitespace {
        opts.ignore_whitespace(true);
    }
    let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
    collect_file_diff(&diff, file)
}
