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
use serde::{Deserialize, Serialize};

/// Where a patch should land. Mirrors `git2::ApplyLocation`, exposed as a
/// serde-tagged enum so the frontend can pick at the IPC boundary.
///
/// - `WorkDir` (default): apply to the working tree only — the index is
///   left alone; user can stage afterwards with the file-level
///   `stage_files`. This is what v0.13.9 `apply_patch` did.
/// - `Index`: apply directly to the index (= `git apply --cached`). Used
///   by line-level **stage** in v0.13.25: we synthesise a sub-patch from
///   the selected lines and route it here.
/// - `Both`: apply to working tree AND index (= `git apply --index`).
///   Useful for "stage these lines, leave the rest alone in the workdir"
///   when the patch changes context.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PatchLocation {
    WorkDir,
    Index,
    Both,
}

impl Default for PatchLocation {
    fn default() -> Self {
        Self::WorkDir
    }
}

impl From<PatchLocation> for ApplyLocation {
    fn from(loc: PatchLocation) -> Self {
        match loc {
            PatchLocation::WorkDir => ApplyLocation::WorkDir,
            PatchLocation::Index => ApplyLocation::Index,
            PatchLocation::Both => ApplyLocation::Both,
        }
    }
}

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
/// against the chosen location, otherwise an error whose message
/// surfaces the libgit2 reason (so the toast can show "context line N
/// does not match" / etc.).
pub fn apply_patch_check(
    path: &str,
    patch_text: &str,
    location: PatchLocation,
) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let diff = Diff::from_buffer(patch_text.as_bytes())?;
    let mut opts = ApplyOptions::new();
    opts.check(true);
    repo.apply(&diff, location.into(), Some(&mut opts))?;
    Ok(())
}

/// Apply `patch_text` to the requested location. v0.13.25 added the
/// `location` arg so callers can choose:
/// - `WorkDir` — only the working tree (legacy v0.13.9 behaviour).
/// - `Index`  — only the index (= `git apply --cached`); used by
///              line-level staging.
/// - `Both`   — apply to both, mirroring `git apply --index`.
///
/// Reverse application (= `git apply -R`) is **not** done here. Callers
/// that want to undo a patch should construct the reversed text
/// themselves (swap +/-, swap a/b headers, invert each hunk header's
/// old/new ranges) and feed it back through this same function. Doing
/// reverse on the frontend keeps a single linear apply path on the
/// backend and dodges libgit2's lack of a `--reverse` option on
/// `Repository::apply`.
pub fn apply_patch(
    path: &str,
    patch_text: &str,
    location: PatchLocation,
) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let diff = Diff::from_buffer(patch_text.as_bytes())?;
    repo.apply(&diff, location.into(), None)?;
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
        apply_patch_check(dir.to_str().unwrap(), &patch, PatchLocation::WorkDir).expect("check ok");
        apply_patch(dir.to_str().unwrap(), &patch, PatchLocation::WorkDir).expect("apply ok");
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
        let res = apply_patch_check(
            dir.to_str().unwrap(),
            "not a patch at all",
            PatchLocation::WorkDir,
        );
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

    /// v0.13.25 — apply a patch directly to the index (= `git apply --cached`).
    /// This is the path line-level staging takes: workdir already has the
    /// edits, we synthesise a sub-patch and push it into the index without
    /// touching the working tree.
    #[test]
    fn apply_patch_to_index_stages_changes_without_touching_workdir() {
        let dir = tmp_repo("stage-lines");
        fs::write(dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        commit_all(&dir, "init");
        // Edit the working tree with two new lines + one removed-ish change.
        fs::write(dir.join("a.txt"), "one\nTWO\nthree\nfour\n").unwrap();
        // The full working patch — what we'd send if the user picked every line.
        let patch = format_working_file_patch(dir.to_str().unwrap(), "a.txt").expect("format ok");
        assert!(patch.contains("+TWO"));
        assert!(patch.contains("+four"));

        // Dry-run + real apply, both targeting the index.
        apply_patch_check(dir.to_str().unwrap(), &patch, PatchLocation::Index).expect("check ok");
        apply_patch(dir.to_str().unwrap(), &patch, PatchLocation::Index).expect("apply ok");

        // The working tree should be unchanged (still has both edits) —
        // we asked for Index-only, so the tree shouldn't get clobbered.
        let after_wd = fs::read_to_string(dir.join("a.txt")).unwrap();
        assert_eq!(
            after_wd.replace("\r\n", "\n"),
            "one\nTWO\nthree\nfour\n",
            "workdir should be untouched after Index-only apply",
        );

        // And `git diff --cached` should now show no diff (everything in
        // the workdir is also in the index).
        let staged = Command::new("git")
            .args(["diff", "--cached", "--name-only"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let staged_files = String::from_utf8(staged.stdout).unwrap();
        assert!(
            staged_files.contains("a.txt"),
            "expected a.txt to be staged, git diff --cached --name-only said:\n{staged_files}"
        );
    }

    /// v0.13.25 — feeding a manually-reversed patch back through Index
    /// apply un-stages those changes (= `git apply -R --cached`). This is
    /// the line-level "unstage selected lines" path.
    #[test]
    fn reversed_patch_to_index_unstages() {
        let dir = tmp_repo("unstage-lines");
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        commit_all(&dir, "init");
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        // Stage everything via the file-level helper so we have something
        // to unstage.
        Command::new("git")
            .args(["add", "a.txt"])
            .current_dir(&dir)
            .output()
            .unwrap();

        // Build a reversed patch by hand. The forward patch reads
        // "+two"; reversed swaps to "-two" with old/new ranges flipped.
        let reversed = "diff --git a/a.txt b/a.txt\n\
            --- a/a.txt\n\
            +++ b/a.txt\n\
            @@ -1,2 +1,1 @@\n \
            one\n\
            -two\n";

        apply_patch_check(dir.to_str().unwrap(), reversed, PatchLocation::Index).expect("check ok");
        apply_patch(dir.to_str().unwrap(), reversed, PatchLocation::Index).expect("apply ok");

        // After the reverse-apply, `git diff --cached` should be empty
        // (the new line is no longer staged, even though it's still in
        // the working tree).
        let staged = Command::new("git")
            .args(["diff", "--cached"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let s = String::from_utf8(staged.stdout).unwrap();
        assert!(s.trim().is_empty(), "expected empty staged diff, got:\n{s}");
    }
}
