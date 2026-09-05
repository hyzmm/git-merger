use super::cli::{self, GitError};
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
///
/// Performance note (post-v0.13.19 cleanup): we used to walk the diff once
/// to collect deltas and then re-materialise each file as a `git2::Patch`
/// just to read its `line_stats()`. On a big vendoring / cross-package
/// refactor commit (think 5 000 files), that means 5 000 full myers diffs
/// re-done after we already had the answers in memory. The new code does
/// a single `diff.foreach` pass with both file + line callbacks active and
/// tallies `+` / `-` counts as the lines stream by — O(total lines), one
/// allocation per file, no re-diff work.
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

    // Single pass: file callback pushes the FileChange entry in delta order;
    // line callback bumps the counters on the *last* entry. Order matters —
    // libgit2 emits all lines for a delta before moving to the next one,
    // and the line callback is only fired between two file callbacks for
    // the same file, so `last_mut()` always targets the right row.
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
        Some(&mut |_delta, _hunk, line| {
            let mut e = entries.borrow_mut();
            if let Some(fc) = e.last_mut() {
                match line.origin() {
                    '+' => fc.insertions += 1,
                    '-' => fc.deletions += 1,
                    _ => {}
                }
            }
            true
        }),
    )?;

    Ok(entries.into_inner())
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

/// Index → worktree diff for one file (v0.13.35 — CLI edition). Runs
/// `git diff` and parses the unified output back into the structured
/// `FileDiff` the renderer already consumes, so the wire format stays
/// identical to the old libgit2 walk.
pub fn working_diff(
    path: &str,
    file: &str,
    ignore_whitespace: bool,
) -> Result<FileDiff, GitError> {
    let mut args = vec![
        cli::s("-c"),
        cli::s("core.quotePath=false"),
        cli::s("diff"),
        cli::s("--no-ext-diff"),
        cli::s("--no-textconv"),
    ];
    if ignore_whitespace {
        args.push(cli::s("-w"));
    }
    args.push(cli::s("--"));
    args.push(cli::literal(file));
    // `git diff` exits 1 when differences exist — that's a normal result.
    let out = cli::run_diff(path, &args)?;
    parse_unified_diff(&out.stdout)
}

/// Parse `git diff` unified output for a single file into `FileDiff`.
///
/// Parity notes vs. the old libgit2 walker:
/// - `DiffLine.content` keeps the trailing `\n` (libgit2 emits it too).
/// - The `\ No newline at end of file` marker becomes a context line whose
///   content and line numbers mirror what libgit2's `CONTEXT_EOFNL` line
///   carried (leading `\n` included), so the rendered diff is unchanged.
/// - Hunks carry the raw `@@ … @@` header text, line numbers are 1-based,
///   and pure-add / pure-delete hunks keep 0 on the empty side.
fn parse_unified_diff(stdout: &[u8]) -> Result<FileDiff, GitError> {
    let mut fd = FileDiff {
        old_path: None,
        new_path: None,
        is_binary: false,
        hunks: Vec::new(),
    };

    let text = String::from_utf8_lossy(stdout);
    let mut lines: Vec<&str> = text.split('\n').collect();
    // Output is line-terminated; drop the trailing empty element.
    if lines.last() == Some(&"") {
        lines.pop();
    }

    let mut old_ln: u32 = 0;
    let mut new_ln: u32 = 0;
    // Numbers of the last body line — the no-newline marker re-uses them.
    let mut last_old: Option<u32> = None;
    let mut last_new: Option<u32> = None;

    for raw in lines {
        // Defensive: strip a stray CR (CRLF line endings in output).
        let raw = raw.strip_suffix('\r').unwrap_or(raw);

        if let Some(rest) = raw.strip_prefix("diff --git ") {
            // Best-effort fallback for blocks without ---/+++ lines
            // (submodule diffs): "a/OLD b/NEW".
            if fd.old_path.is_none() && fd.new_path.is_none() {
                if let Some(sep) = rest.find(" b/") {
                    fd.old_path = parse_git_path(&rest[..sep]);
                    fd.new_path = parse_git_path(&rest[sep + 3..]);
                }
            }
            continue;
        }
        if let Some(rest) = raw.strip_prefix("Binary files ") {
            fd.is_binary = true;
            // "a/OLD and b/NEW differ"
            if let Some(rest) = rest.strip_suffix(" differ") {
                if let Some(sep) = rest.find(" and b/") {
                    fd.old_path = parse_git_path(&rest[..sep]);
                    fd.new_path = parse_git_path(&rest[sep + 5..]);
                }
            }
            continue;
        }
        if let Some(rest) = raw.strip_prefix("--- ") {
            fd.old_path = parse_git_path(rest);
            continue;
        }
        if let Some(rest) = raw.strip_prefix("+++ ") {
            fd.new_path = parse_git_path(rest);
            continue;
        }
        if let Some(rest) = raw.strip_prefix("rename from ") {
            fd.old_path = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = raw.strip_prefix("rename to ") {
            fd.new_path = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = raw.strip_prefix("copy from ") {
            fd.old_path = Some(rest.to_string());
            continue;
        }
        if let Some(rest) = raw.strip_prefix("copy to ") {
            fd.new_path = Some(rest.to_string());
            continue;
        }
        if raw.starts_with("@@") {
            if let Some(h) = parse_hunk_header(raw) {
                old_ln = h.old_start;
                new_ln = h.new_start;
                last_old = None;
                last_new = None;
                fd.hunks.push(h);
            }
            continue;
        }
        if raw.starts_with('\\') {
            // "\ No newline at end of file" — context row, same numbers as
            // the line it follows (libgit2 parity).
            if let Some(h) = fd.hunks.last_mut() {
                h.lines.push(DiffLine {
                    origin: " ".to_string(),
                    old_lineno: last_old,
                    new_lineno: last_new,
                    content: format!("\n{raw}\n"),
                });
            }
            continue;
        }
        if raw.is_empty() {
            continue;
        }
        let first = raw.as_bytes()[0] as char;
        let rest = &raw[1..];
        let (old_lineno, new_lineno) = match first {
            '+' => {
                let n = new_ln;
                new_ln += 1;
                (None, Some(n))
            }
            '-' => {
                let o = old_ln;
                old_ln += 1;
                (Some(o), None)
            }
            ' ' => {
                let (o, n) = (old_ln, new_ln);
                old_ln += 1;
                new_ln += 1;
                (Some(o), Some(n))
            }
            // Metadata outside hunks (index, mode, similarity, …) — skip.
            _ => continue,
        };
        last_old = old_lineno;
        last_new = new_lineno;
        if let Some(h) = fd.hunks.last_mut() {
            h.lines.push(DiffLine {
                origin: first.to_string(),
                old_lineno,
                new_lineno,
                content: format!("{rest}\n"),
            });
        }
    }

    Ok(fd)
}

/// "a/foo" | "b/foo" → Some("foo"); "/dev/null" → None.
fn parse_git_path(s: &str) -> Option<String> {
    let p = s.strip_prefix("a/").or_else(|| s.strip_prefix("b/")).unwrap_or(s);
    if p == "/dev/null" {
        None
    } else {
        Some(p.to_string())
    }
}

/// "@@ -A,B +C,D @@ tail" → hunk. Counts default to 1 when omitted.
fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    let rest = line.strip_prefix("@@")?.trim_start();
    let (old_part, rest) = rest.split_once(' ')?;
    let rest = rest.trim_start();
    let (new_part, _tail) = rest.split_once(' ')?;
    let old_part = old_part.strip_prefix('-')?;
    let new_part = new_part.strip_prefix('+')?;
    let (old_start, old_lines) = parse_range(old_part)?;
    let (new_start, new_lines) = parse_range(new_part)?;
    Some(DiffHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        header: line.to_string(),
        lines: Vec::new(),
    })
}

/// "A" → (A, 1); "A,B" → (A, B).
fn parse_range(s: &str) -> Option<(u32, u32)> {
    let (start, count) = match s.split_once(',') {
        Some((a, b)) => (a, b),
        None => (s, "1"),
    };
    Some((start.parse().ok()?, count.parse().ok()?))
}


#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> FileDiff {
        parse_unified_diff(text.as_bytes()).expect("parse")
    }

    #[test]
    fn parses_modified_file_hunks_and_line_numbers() {
        let fd = parse(
            r#"diff --git a/a.txt b/a.txt
index 4cb29ea..ddc897f 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -10,2 +10,3 @@ tail fn
 ten
+eleven
 twelve
"#,
        );
        assert_eq!(fd.old_path.as_deref(), Some("a.txt"));
        assert_eq!(fd.new_path.as_deref(), Some("a.txt"));
        assert!(!fd.is_binary);
        assert_eq!(fd.hunks.len(), 2);
        let h0 = &fd.hunks[0];
        assert_eq!(
            (h0.old_start, h0.old_lines, h0.new_start, h0.new_lines),
            (1, 3, 1, 3)
        );
        assert_eq!(h0.header, "@@ -1,3 +1,3 @@");
        assert_eq!(h0.lines.len(), 4);
        assert_eq!(h0.lines[1].origin, "-");
        assert_eq!(h0.lines[1].old_lineno, Some(2));
        assert_eq!(h0.lines[1].new_lineno, None);
        assert_eq!(h0.lines[1].content, "two\n");
        assert_eq!(h0.lines[2].origin, "+");
        assert_eq!(h0.lines[2].new_lineno, Some(2));
        assert_eq!(h0.lines[3].old_lineno, Some(3));
        assert_eq!(h0.lines[3].new_lineno, Some(3));
        // Second hunk keeps the function-context tail in the header.
        assert_eq!(fd.hunks[1].header, "@@ -10,2 +10,3 @@ tail fn");
        assert_eq!(fd.hunks[1].lines[0].content, "ten\n");
    }

    #[test]
    fn parses_new_file_with_dev_null() {
        let fd = parse(
            r#"diff --git a/u.txt b/u.txt
new file mode 100644
index 0000000..1e1ead1
--- /dev/null
+++ b/u.txt
@@ -0,0 +1 @@
+unt
"#,
        );
        assert_eq!(fd.old_path, None);
        assert_eq!(fd.new_path.as_deref(), Some("u.txt"));
        let h = &fd.hunks[0];
        assert_eq!(
            (h.old_start, h.old_lines, h.new_start, h.new_lines),
            (0, 0, 1, 1)
        );
        assert_eq!(h.lines[0].origin, "+");
        assert_eq!(h.lines[0].old_lineno, None);
        assert_eq!(h.lines[0].new_lineno, Some(1));
    }

    #[test]
    fn parses_deleted_file() {
        let fd = parse(
            r#"diff --git a/a.txt b/a.txt
deleted file mode 100644
--- a/a.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
"#,
        );
        assert_eq!(fd.old_path.as_deref(), Some("a.txt"));
        assert_eq!(fd.new_path, None);
        assert_eq!(fd.hunks[0].new_start, 0);
    }

    #[test]
    fn parses_pure_rename_without_file_headers() {
        let fd = parse(
            r#"diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
"#,
        );
        assert_eq!(fd.old_path.as_deref(), Some("old.txt"));
        assert_eq!(fd.new_path.as_deref(), Some("new.txt"));
        assert!(fd.hunks.is_empty());
    }

    #[test]
    fn parses_binary_marker() {
        let fd = parse(
            r#"diff --git a/b.bin b/b.bin
index 8352675..6a50b48 100644
Binary files a/b.bin and b/b.bin differ
"#,
        );
        assert!(fd.is_binary);
        assert_eq!(fd.old_path.as_deref(), Some("b.bin"));
        assert_eq!(fd.new_path.as_deref(), Some("b.bin"));
        assert!(fd.hunks.is_empty());
    }

    #[test]
    fn no_newline_marker_becomes_context_line() {
        let fd = parse(
            r#"diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 one
-three
\ No newline at end of file
+threeX
\ No newline at end of file
"#,
        );
        let h = &fd.hunks[0];
        assert_eq!(h.lines.len(), 5);
        // The marker mirrors the numbers of the line it follows.
        assert_eq!(h.lines[2].origin, " ");
        assert_eq!(h.lines[2].old_lineno, Some(2));
        assert_eq!(h.lines[2].new_lineno, None);
        assert_eq!(h.lines[2].content, "\n\\ No newline at end of file\n");
        assert_eq!(h.lines[4].new_lineno, Some(2));
    }

    #[test]
    fn empty_output_yields_empty_diff() {
        let fd = parse("");
        assert_eq!(fd.old_path, None);
        assert_eq!(fd.new_path, None);
        assert!(!fd.is_binary);
        assert!(fd.hunks.is_empty());
    }
}
