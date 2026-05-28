//! Commit-targeting operations: cherry-pick (single + sequence), revert, reset.
//!
//! All of these mutate HEAD / the index / the working tree.
//!
//! v0.13.26 — `cherry_pick_sequence` is the new shape. The old
//! `cherry_pick(path, oid)` is kept as a thin wrapper over the sequence
//! API so the existing single-commit IPC keeps working unchanged, while
//! the v0.13.9 hidden bug — "cherry-pick leaves the changes in the
//! index without ever creating a commit" — gets quietly fixed for
//! everyone, single or batch.

use git2::{
    build::CheckoutBuilder, CherrypickOptions, MergeOptions, Repository, ResetType, RevertOptions,
};
use serde::{Deserialize, Serialize};

/// Outcome of a `cherry_pick_sequence` run, surfaced to the frontend so
/// it knows whether to switch the user to the Merge view (`Stopped`) or
/// just refresh history (`Done`).
///
/// We deliberately do not fail the whole call when one cherry-pick
/// conflicts: the user gets to resolve that one in the Merge view, then
/// the *remaining* oids stay queued on the frontend so the next click
/// can resume the sequence. That said, on this iteration we don't yet
/// persist the queue across app restarts — `Stopped` returns the index
/// of the failing oid and the caller (store) is responsible for keeping
/// the tail in memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CherrySequenceOutcome {
    /// Every oid was applied + committed successfully. `applied` is just
    /// the input length, included for symmetry with the `Stopped` case.
    Done { applied: usize },
    /// Stopped because cherry-pick of `failed_oid` produced index
    /// conflicts. `applied` commits before this point are already on
    /// HEAD; the working tree is sitting in `CHERRY_PICK_HEAD` state and
    /// the user should be routed to the Merge view to resolve. `pending`
    /// lists the oids that were not attempted (the failing one is the
    /// first of `pending` so the frontend can show "stuck on …" and
    /// resume after resolution).
    Stopped {
        applied: usize,
        failed_oid: String,
        pending: Vec<String>,
    },
}

/// Cherry-pick `oids` onto HEAD in order. Each successful step creates a
/// real commit (preserving the original author, fresh committer line),
/// and clears `CHERRY_PICK_HEAD`. The first conflict short-circuits the
/// loop and returns `Stopped`.
///
/// The caller is responsible for ordering — for a UI selection on the
/// `commits` array (newest-first), this means `oids` should be reversed
/// so the oldest commit applies first.
pub fn cherry_pick_sequence(
    path: &str,
    oids: &[String],
) -> Result<CherrySequenceOutcome, git2::Error> {
    let repo = Repository::discover(path)?;
    let mut applied = 0usize;

    for (i, oid) in oids.iter().enumerate() {
        let commit = repo
            .find_object(git2::Oid::from_str(oid)?, None)?
            .peel_to_commit()?;

        let mut opts = CherrypickOptions::new();
        opts.merge_opts(MergeOptions::new());
        repo.cherrypick(&commit, Some(&mut opts))?;

        // libgit2 leaves the changes in the index. If they conflict we
        // can't safely create a commit; bail out and let the user
        // resolve in the Merge view.
        if repo.index()?.has_conflicts() {
            return Ok(CherrySequenceOutcome::Stopped {
                applied,
                failed_oid: oid.clone(),
                pending: oids[i..].to_vec(),
            });
        }

        let parent = repo.head()?.peel_to_commit()?;
        let message = commit.message().unwrap_or("").to_string();
        // Re-use the rebase module's commit-creation helpers so cherry-pick
        // and rebase produce indistinguishable commits (same author
        // preservation, same gpgsign behaviour).
        super::rebase::create_commit(&repo, &commit, &parent, &message)?;
        repo.cleanup_state().ok();
        applied += 1;
    }

    Ok(CherrySequenceOutcome::Done { applied })
}

/// Cherry-pick a single commit onto HEAD. Backwards-compatible wrapper
/// around `cherry_pick_sequence`. Returns `Ok(())` on clean apply, the
/// same `git2::Error::MergeConflict` as before on conflict (so existing
/// frontend error handling continues to map it to the Merge view).
pub fn cherry_pick(path: &str, oid: &str) -> Result<(), git2::Error> {
    match cherry_pick_sequence(path, &[oid.to_string()])? {
        CherrySequenceOutcome::Done { .. } => Ok(()),
        CherrySequenceOutcome::Stopped { .. } => {
            // Synthesise the libgit2 error that callers expect when an
            // index conflict halts a cherry-pick. The actual repo state
            // (CHERRY_PICK_HEAD + conflicted index) is already in place
            // — what we're returning here is just the "tell the user"
            // wire signal.
            Err(git2::Error::new(
                git2::ErrorCode::MergeConflict,
                git2::ErrorClass::Merge,
                "cherry-pick produced conflicts; resolve in the merge view and continue",
            ))
        }
    }
}

/// Revert the given commit, creating an inverse change on top of HEAD.
/// Accepts any committish. May leave conflicts in the index.
pub fn revert(path: &str, oid: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let commit = repo
        .find_object(git2::Oid::from_str(oid)?, None)?
        .peel_to_commit()?;
    let mut opts = RevertOptions::new();
    opts.merge_opts(MergeOptions::new());
    repo.revert(&commit, Some(&mut opts))?;
    Ok(())
}

/// Reset HEAD (and optionally index/working tree) to the given commit.
pub fn reset(path: &str, oid: &str, mode: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let obj = repo.find_object(git2::Oid::from_str(oid)?, None)?;
    let kind = match mode {
        "soft" => ResetType::Soft,
        "mixed" => ResetType::Mixed,
        "hard" => ResetType::Hard,
        other => {
            return Err(git2::Error::from_str(&format!(
                "unknown reset mode '{}', expected soft/mixed/hard",
                other
            )));
        }
    };
    let mut co = CheckoutBuilder::new();
    if matches!(kind, ResetType::Hard) {
        co.force();
    }
    repo.reset(&obj, kind, Some(&mut co))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! Integration-y tests using a real on-disk git repo (same shape as
    //! the rebase / patch tests). We shell out to `git` to set up the
    //! initial commits since libgit2's commit-creation API is verbose
    //! and these tests aren't trying to verify *that* part.
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    fn tmp_repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gittools-cherry-{}-{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            assert!(Command::new("git")
                .args(args)
                .current_dir(&dir)
                .output()
                .unwrap()
                .status
                .success());
        };
        run(&["init", "-q", "-b", "main"]);
        run(&["config", "user.email", "t@t.t"]);
        run(&["config", "user.name", "t"]);
        run(&["config", "commit.gpgsign", "false"]);
        dir
    }

    fn commit_one(dir: &PathBuf, file: &str, body: &str, msg: &str) -> String {
        fs::write(dir.join(file), body).unwrap();
        Command::new("git")
            .args(["add", file])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-q", "-m", msg])
            .current_dir(dir)
            .output()
            .unwrap();
        let out = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(dir)
            .output()
            .unwrap();
        String::from_utf8(out.stdout).unwrap().trim().to_string()
    }

    #[test]
    fn sequence_picks_two_disjoint_commits_in_order() {
        // Layout:
        //   main:  A -- B   (HEAD)
        //   topic: A -- C -- D
        // We cherry-pick [C, D] onto main; both should land cleanly,
        // creating two new commits, and HEAD~2 should become B.
        let dir = tmp_repo("seq-clean");
        let _a = commit_one(&dir, "a.txt", "alpha\n", "A");
        let _b = commit_one(&dir, "b.txt", "bravo\n", "B");
        // Branch off A for the topic.
        Command::new("git")
            .args(["checkout", "-q", "-b", "topic", "HEAD~1"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let c = commit_one(&dir, "c.txt", "charlie\n", "C");
        let d = commit_one(&dir, "d.txt", "delta\n", "D");
        // Back to main (HEAD = B).
        Command::new("git")
            .args(["checkout", "-q", "main"])
            .current_dir(&dir)
            .output()
            .unwrap();

        let outcome = cherry_pick_sequence(dir.to_str().unwrap(), &[c.clone(), d.clone()]).unwrap();
        match outcome {
            CherrySequenceOutcome::Done { applied } => assert_eq!(applied, 2),
            CherrySequenceOutcome::Stopped { .. } => panic!("expected Done, got Stopped"),
        }

        // Files from C and D must now exist on main, with HEAD ahead by 2.
        assert!(dir.join("c.txt").exists());
        assert!(dir.join("d.txt").exists());
        let count = String::from_utf8(
            Command::new("git")
                .args(["rev-list", "--count", "HEAD"])
                .current_dir(&dir)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        assert_eq!(count, "4", "expected 4 commits on HEAD (A, B, C', D')");
    }

    #[test]
    fn sequence_stops_on_conflict_and_reports_pending() {
        // Layout: from a shared root A (`f.txt = "main"`), main and topic
        // both diverge edits to the same file:
        //   main:  A -- B  (B sets f.txt = "main2")
        //   topic: A -- C -- D  (C: "topic1", D: "topic2")
        // Cherry-picking [C, D] onto main now 3-way-merges with
        //   base=A → "main", ours=B → "main2", theirs=C → "topic1"
        // Different on both sides → conflict.
        let dir = tmp_repo("seq-conflict");
        let _a = commit_one(&dir, "f.txt", "main\n", "A");
        Command::new("git")
            .args(["checkout", "-q", "-b", "topic", "HEAD"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let c = commit_one(&dir, "f.txt", "topic1\n", "C");
        let d = commit_one(&dir, "f.txt", "topic2\n", "D");
        Command::new("git")
            .args(["checkout", "-q", "main"])
            .current_dir(&dir)
            .output()
            .unwrap();
        // Diverge main from A so the 3-way merge actually conflicts.
        let _b = commit_one(&dir, "f.txt", "main2\n", "B");

        let outcome = cherry_pick_sequence(dir.to_str().unwrap(), &[c.clone(), d.clone()]).unwrap();
        match outcome {
            CherrySequenceOutcome::Done { .. } => panic!("expected Stopped, got Done"),
            CherrySequenceOutcome::Stopped {
                applied,
                failed_oid,
                pending,
            } => {
                assert_eq!(applied, 0, "no commits should have landed before the conflict");
                assert_eq!(failed_oid, c, "stuck on C, the first commit");
                assert_eq!(pending, vec![c.clone(), d.clone()], "C and D both still pending");
            }
        }
        // Repo state should be CHERRY_PICK so the merge view picks it up.
        let state = String::from_utf8(
            Command::new("git")
                .args(["status", "--porcelain=v2", "--branch"])
                .current_dir(&dir)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        assert!(
            dir.join(".git").join("CHERRY_PICK_HEAD").exists(),
            "CHERRY_PICK_HEAD should be present after a conflicting cherry-pick; status was:\n{state}"
        );
    }

    #[test]
    fn single_cherry_pick_now_creates_a_commit() {
        // Regression check for the v0.13.9 hidden bug: pre-v0.13.26 the
        // single-shot `cherry_pick` only applied the changes to the index
        // without ever creating a commit. With the sequence-backed
        // implementation it must now produce one.
        let dir = tmp_repo("single");
        let _a = commit_one(&dir, "a.txt", "alpha\n", "A");
        Command::new("git")
            .args(["checkout", "-q", "-b", "topic", "HEAD"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let c = commit_one(&dir, "c.txt", "charlie\n", "C");
        Command::new("git")
            .args(["checkout", "-q", "main"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let before = String::from_utf8(
            Command::new("git")
                .args(["rev-list", "--count", "HEAD"])
                .current_dir(&dir)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        cherry_pick(dir.to_str().unwrap(), &c).expect("clean cherry-pick");
        let after = String::from_utf8(
            Command::new("git")
                .args(["rev-list", "--count", "HEAD"])
                .current_dir(&dir)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        assert_eq!(before, "1");
        assert_eq!(after, "2", "single cherry-pick should advance HEAD by 1 commit");
        assert!(dir.join("c.txt").exists());
    }
}
