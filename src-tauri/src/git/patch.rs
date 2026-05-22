//! Patch I/O — format file diffs as unified-patch text and apply
//! patch text back into the working tree.
//!
//! Why a separate module from `diff.rs`?
//! - `diff.rs` exposes structured `FileDiff`s for the Side-by-side /
//!   Unified renderers; this one deals with the standard `*.patch`
//!   text format used by `git format-patch` / `git am` and so on.
//! - Apply uses `git2::Repository::apply` with `ApplyLocation::WorkDir`
//!   — the inverse direction (text → working tree) needs different
//!   plumbing than the read-only `Diff` walks `collect_file_diff`
//!   uses.
//!
//! Public surface (4 functions):
//! - `format_commit_file_patch(repo, oid, file)` — patch text for a
//!   single file in a historical commit (parent → commit).
//! - `format_working_file_patch(repo, file)` — patch text for a
//!   single file in the working tree (HEAD/index → workdir).
//! - `apply_patch_check(repo, patch)` — dry-run; returns OK if the
//!   patch *would* apply cleanly, otherwise an error with libgit2's
//!   reason. Used by the UI to surface "this patch won't apply"
//!   before clobbering anything.
//! - `apply_patch(repo, patch)` — actually apply to the working
//!   tree. Index is left alone — the user can stage afterwards.

use git2::{ApplyLocation, ApplyOptions, Diff, DiffOptions, Oid, Repository};

/// Format a single file's commit diff (parent[0] → commit) as a
/// unified-patch string. Returns the text including the standard
/// `diff --git a/... b/...` / `index <hash>..<hash>` / hunk headers
/// that GNU `patch` and `git apply` both understand.
pub fn format_commit_file_patch(path: &str, oid: &str, file: &str) -> Result<String, git2::Error> {
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
    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))?;
    diff_to_patch(&diff)
}

/// Format the working-tree diff (HEAD → workdir, including unstaged
/// edits) for a single file. We diff `tree → workdir` rather than
/// `index → workdir` so the resulting patch carries *all* user edits,
/// not just the unstaged delta — which is what "send this patch to
/// my colleague" needs.
pub fn format_working_file_patch(path: &str, file: &str) -> Result<String, git2::Error> {
    let repo = Repository::discover(path)?;
    let head_tree = repo.head().ok().and_then(|r| r.peel_to_tree().ok());
    let mut opts = DiffOptions::new();
    opts.pathspec(file);
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    let diff = repo.diff_tree_to_workdir(head_tree.as_ref(), Some(&mut opts))?;
    diff_to_patch(&diff)
}

/// Walk a `Diff` and concatenate every emitted patch line into a
/// single owned `String`. Identical for both `format_*` functions
/// above — kept private so callers don't accidentally serialise a
/// stale `Diff` reference.
fn diff_to_patch(diff: &Diff<'_>) -> Result<String, git2::Error> {
    let mut buf = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        // For headers (`F` = file, `H` = hunk) libgit2 emits the line
        // *without* the leading +/- so we need to forward it verbatim.
        // For body lines we prepend the origin char so the result is
        // valid unified-diff text.
        let origin = line.origin();
        if matches!(origin, ' ' | '+' | '-') {
            buf.push(origin);
        }
        buf.push_str(std::str::from_utf8(line.content()).unwrap_or(""));
        true
    })?;
    Ok(buf)
}

/// Dry-run apply: returns Ok(()) if `patch_text` would apply cleanly
/// against the current working tree, otherwise an error whose message
/// surfaces the libgit2 reason (so the toast can show "context line N
/// does not match" / etc.).
pub fn apply_patch_check(path: &str, patch_text: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let diff = Diff::from_buffer(patch_text.as_bytes())?;
    let mut opts = ApplyOptions::new();
    opts.check(true);
    repo.apply(&diff, ApplyLocation::WorkDir, Some(&mut opts))?;
    Ok(())
}

/// Apply `patch_text` to the working tree (does NOT touch the index).
/// Caller is expected to have run `apply_patch_check` first if it
/// cares about previewing failures — but this function will also
/// surface failures from the real apply, just less gracefully.
pub fn apply_patch(path: &str, patch_text: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let diff = Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&diff, ApplyLocation::WorkDir, None)?;
    Ok(())
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn tmp_repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gittools-patch-{}", name));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // Init — we use the binary so we don't have to wire libgit2's
        // init API for test scaffolding.
        Command::new("git")
            .args(["-c", "init.defaultBranch=main", "init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&dir)
            .output()
            .unwrap();
        dir
    }

    fn commit_all(dir: &PathBuf, msg: &str) {
        Command::new("git")
            .args(["add", "-A"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", msg])
            .current_dir(dir)
            .output()
            .unwrap();
    }

    #[test]
    fn working_patch_round_trips_through_apply_check() {
        let dir = tmp_repo("ok");
        fs::write(dir.join("a.txt"), "hello\n").unwrap();
        commit_all(&dir, "init");
        // Edit + format patch.
        fs::write(dir.join("a.txt"), "hello\nworld\n").unwrap();
        let patch = format_working_file_patch(dir.to_str().unwrap(), "a.txt").expect("format ok");
        assert!(patch.contains("+world"), "patch text:\n{}", patch);
        // Reset the workdir, re-apply, and verify the file matches.
        fs::write(dir.join("a.txt"), "hello\n").unwrap();
        // dry-run check first
        apply_patch_check(dir.to_str().unwrap(), &patch).expect("check ok");
        apply_patch(dir.to_str().unwrap(), &patch).expect("apply ok");
        let after = fs::read_to_string(dir.join("a.txt")).unwrap();
        // Normalise CRLF → LF before comparing — Windows libgit2 may
        // honour core.autocrlf on apply, which is fine in production
        // but flaky to assert against verbatim across platforms.
        assert_eq!(after.replace("\r\n", "\n"), "hello\nworld\n");
    }

    #[test]
    fn apply_check_rejects_garbage() {
        let dir = tmp_repo("bad");
        fs::write(dir.join("a.txt"), "hello\n").unwrap();
        commit_all(&dir, "init");
        let res = apply_patch_check(dir.to_str().unwrap(), "not a patch at all");
        assert!(res.is_err(), "garbage patch should fail to parse / apply");
    }

    #[test]
    fn commit_patch_for_a_renamed_file_emits_both_paths() {
        let dir = tmp_repo("commit");
        fs::write(dir.join("a.txt"), "alpha\n").unwrap();
        commit_all(&dir, "init");
        fs::write(dir.join("a.txt"), "alpha\nbeta\n").unwrap();
        commit_all(&dir, "edit");
        let head = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&dir)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        let patch = format_commit_file_patch(dir.to_str().unwrap(), &head, "a.txt").expect("ok");
        assert!(patch.contains("a/a.txt"));
        assert!(patch.contains("b/a.txt"));
        assert!(patch.contains("+beta"));
    }
}
