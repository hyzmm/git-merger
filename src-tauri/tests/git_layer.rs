//! Integration tests for `git::log`, `git::stash`, `git::refs_ops`,
//! `git::commit_ops`, `git::reflog`, and `git::file_history`.

mod common;

use common::TempRepo;
use git_tools_lib::git;

#[test]
fn log_returns_commits_newest_first() {
    let r = TempRepo::init();
    let _a = r.commit_file("README.md", "first\n", "init");
    let _b = r.commit_file("README.md", "first\nsecond\n", "second");
    let _c = r.commit_file("README.md", "first\nsecond\nthird\n", "third");

    let commits = git::log::log(&r.path_str(), 100, 0, None).unwrap();
    assert_eq!(commits.len(), 3);
    assert_eq!(commits[0].summary, "third");
    assert_eq!(commits[1].summary, "second");
    assert_eq!(commits[2].summary, "init");
}

#[test]
fn log_pathspec_filters_to_commits_touching_path() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "a\n", "add a");
    r.commit_file("b.txt", "b\n", "add b");
    r.commit_file("a.txt", "a updated\n", "update a");

    let only_a = git::log::log(&r.path_str(), 100, 0, Some("a.txt")).unwrap();
    let only_b = git::log::log(&r.path_str(), 100, 0, Some("b.txt")).unwrap();
    assert_eq!(only_a.len(), 2);
    assert_eq!(only_a[0].summary, "update a");
    assert_eq!(only_a[1].summary, "add a");
    assert_eq!(only_b.len(), 1);
}

// ---------------------------------------------------------------------------
// refs_ops
// ---------------------------------------------------------------------------

#[test]
fn create_and_delete_branch_round_trip() {
    let r = TempRepo::init();
    let oid = r.commit_file("a.txt", "1\n", "init");

    git::refs_ops::create_branch(&r.path_str(), "feature/x", &oid.to_string(), false).unwrap();
    let refs = git::refs::list_refs(&r.path_str()).unwrap();
    assert!(refs.iter().any(|r| r.name == "feature/x"));

    git::refs_ops::delete_branch(&r.path_str(), "feature/x").unwrap();
    let refs = git::refs::list_refs(&r.path_str()).unwrap();
    assert!(!refs.iter().any(|r| r.name == "feature/x"));
}

#[test]
fn rename_branch_changes_name_but_keeps_target() {
    let r = TempRepo::init();
    let oid = r.commit_file("a.txt", "1\n", "init");
    git::refs_ops::create_branch(&r.path_str(), "old", &oid.to_string(), false).unwrap();
    git::refs_ops::rename_branch(&r.path_str(), "old", "new").unwrap();
    let refs = git::refs::list_refs(&r.path_str()).unwrap();
    let new_branch = refs.iter().find(|r| r.name == "new").expect("new branch");
    assert_eq!(new_branch.target.as_deref(), Some(oid.to_string().as_str()));
    assert!(!refs.iter().any(|r| r.name == "old"));
}

#[test]
fn create_lightweight_and_annotated_tags() {
    let r = TempRepo::init();
    let oid = r.commit_file("a.txt", "1\n", "init");

    // Lightweight (no message).
    git::refs_ops::create_tag(&r.path_str(), "v1", &oid.to_string(), None).unwrap();
    // Annotated.
    git::refs_ops::create_tag(&r.path_str(), "v2", &oid.to_string(), Some("Release 2")).unwrap();

    let refs = git::refs::list_refs(&r.path_str()).unwrap();
    assert!(refs
        .iter()
        .any(|r| r.name == "v1" && matches!(r.kind, git::refs::RefKind::Tag)));
    assert!(refs
        .iter()
        .any(|r| r.name == "v2" && matches!(r.kind, git::refs::RefKind::Tag)));
}

// ---------------------------------------------------------------------------
// commit_ops (cherry-pick + reset)
// ---------------------------------------------------------------------------

#[test]
fn reset_hard_moves_head_and_workdir() {
    let r = TempRepo::init();
    let a = r.commit_file("f.txt", "v1\n", "v1");
    let _b = r.commit_file("f.txt", "v2\n", "v2");

    // Hard-reset back to a.
    git::commit_ops::reset(&r.path_str(), &a.to_string(), "hard").unwrap();
    let head = r.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id(), a);

    // Working tree should also be at v1 now.
    let content = std::fs::read_to_string(r.path().join("f.txt")).unwrap();
    assert_eq!(content, "v1\n");
}

#[test]
fn reset_with_unknown_mode_errors() {
    let r = TempRepo::init();
    let oid = r.commit_file("f.txt", "v1\n", "v1");
    let err = git::commit_ops::reset(&r.path_str(), &oid.to_string(), "bananas").unwrap_err();
    assert!(err.message().contains("unknown reset mode"));
}

// ---------------------------------------------------------------------------
// stash
// ---------------------------------------------------------------------------

#[test]
fn stash_save_apply_and_drop() {
    let r = TempRepo::init();
    r.commit_file("f.txt", "base\n", "base");

    // Modify working tree then stash.
    r.write_file("f.txt", "dirty\n");
    let stash_oid = git::stash::save(&r.path_str(), Some("wip"), false, false).unwrap();
    assert!(!stash_oid.is_empty());

    // Working tree should be clean again.
    let content = std::fs::read_to_string(r.path().join("f.txt")).unwrap();
    assert_eq!(content, "base\n");

    // List should have one entry.
    let entries = git::stash::list(&r.path_str()).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].message.contains("wip") || !entries[0].message.is_empty());

    // Apply restores the dirty content.
    git::stash::apply(&r.path_str(), 0).unwrap();
    let content = std::fs::read_to_string(r.path().join("f.txt")).unwrap();
    assert_eq!(content, "dirty\n");

    // Drop removes it from the stack.
    git::stash::drop(&r.path_str(), 0).unwrap();
    let entries = git::stash::list(&r.path_str()).unwrap();
    assert!(entries.is_empty());
}

// ---------------------------------------------------------------------------
// reflog
// ---------------------------------------------------------------------------

#[test]
fn reflog_records_each_commit() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "1\n", "first");
    r.commit_file("a.txt", "2\n", "second");
    r.commit_file("a.txt", "3\n", "third");

    let entries = git::reflog::list(&r.path_str(), None).unwrap();
    // Each commit on the active branch produces a reflog entry. We expect at
    // least 3 — the exact count may include an extra "branch creation" hop.
    assert!(entries.len() >= 3, "got only {} entries", entries.len());
}

// ---------------------------------------------------------------------------
// file_history (with rename detection)
// ---------------------------------------------------------------------------

#[test]
fn file_history_basic() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "1\n", "add a");
    r.commit_file("a.txt", "1\n2\n", "modify a");
    r.commit_file("b.txt", "x\n", "unrelated");

    let h = git::file_history::file_history(&r.path_str(), "a.txt", 100).unwrap();
    assert_eq!(h.len(), 2);
    assert_eq!(h[0].commit.summary, "modify a");
    assert_eq!(h[1].commit.summary, "add a");
    // a.txt was always at the same path.
    assert_eq!(h[0].path_at_commit, "a.txt");
    assert_eq!(h[1].path_at_commit, "a.txt");
}

#[test]
fn file_history_follows_renames() {
    let r = TempRepo::init();
    r.commit_file("old.txt", "hello\nworld\n", "init");
    r.rename_file("old.txt", "new.txt");
    r.commit_all("rename old.txt -> new.txt");
    r.commit_file("new.txt", "hello\nworld\nmore\n", "extend new.txt");

    let h = git::file_history::file_history(&r.path_str(), "new.txt", 100).unwrap();
    assert_eq!(h.len(), 3, "expected init + rename + extend, got {h:?}");
    // Newest first: extend, rename, init.
    assert_eq!(h[0].commit.summary, "extend new.txt");
    assert_eq!(h[1].commit.summary, "rename old.txt -> new.txt");
    assert_eq!(h[2].commit.summary, "init");
    // Last entry was the file's old name.
    assert_eq!(h[2].path_at_commit, "old.txt");
    // The middle (rename) entry exposes the old path.
    assert_eq!(h[1].old_path.as_deref(), Some("old.txt"));
}

// ---------------------------------------------------------------------------
// Interactive Rebase
// ---------------------------------------------------------------------------

#[test]
fn rebase_pick_only_replays_commits_in_order() {
    let r = TempRepo::init();
    let base = r.commit_file("a.txt", "1\n", "init");
    r.commit_file("b.txt", "b\n", "add b");
    r.commit_file("c.txt", "c\n", "add c");

    // Plan = pick all of base..HEAD in order. Reorder: swap b/c so the
    // resulting history is c then b on top of base.
    let mut plan = git::rebase::plan(&r.path_str(), &base.to_string()).unwrap();
    assert_eq!(plan.len(), 2);
    plan.swap(0, 1);

    let status = git::rebase::start(&r.path_str(), &base.to_string(), plan).unwrap();
    assert!(matches!(status, git::rebase::RebaseStatus::Running { .. }));

    // Drive the executor to completion.
    loop {
        let s = git::rebase::next_step(&r.path_str()).unwrap();
        match s {
            git::rebase::RebaseStatus::Running { state } if !state.remaining.is_empty() => continue,
            git::rebase::RebaseStatus::Done { rewritten } => {
                assert_eq!(rewritten, 2);
                break;
            }
            other => panic!("unexpected rebase status: {other:?}"),
        }
    }

    // After the rebase HEAD should sit on the swapped tip; messages: "add b"
    // (newest, since we swapped) then "add c" then "init".
    let log = git::log::log(&r.path_str(), 100, 0, None).unwrap();
    let msgs: Vec<&str> = log.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(msgs, vec!["add b", "add c", "init"]);
}

#[test]
fn rebase_drop_removes_a_commit() {
    let r = TempRepo::init();
    let base = r.commit_file("a.txt", "1\n", "init");
    r.commit_file("b.txt", "b\n", "to drop");
    r.commit_file("c.txt", "c\n", "keep me");

    let mut plan = git::rebase::plan(&r.path_str(), &base.to_string()).unwrap();
    // Drop the first commit ("to drop").
    plan[0].action = git::rebase::RebaseAction::Drop;

    git::rebase::start(&r.path_str(), &base.to_string(), plan).unwrap();
    loop {
        let s = git::rebase::next_step(&r.path_str()).unwrap();
        if matches!(s, git::rebase::RebaseStatus::Done { .. }) {
            break;
        }
    }

    let log = git::log::log(&r.path_str(), 100, 0, None).unwrap();
    let msgs: Vec<&str> = log.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(msgs, vec!["keep me", "init"]);
    // The dropped change shouldn't be on disk either.
    assert!(!r.path().join("b.txt").exists());
}

#[test]
fn rebase_abort_restores_original_head() {
    let r = TempRepo::init();
    let base = r.commit_file("a.txt", "1\n", "init");
    r.commit_file("b.txt", "b\n", "second");
    let original_head = r.repo.head().unwrap().peel_to_commit().unwrap().id();

    let plan = git::rebase::plan(&r.path_str(), &base.to_string()).unwrap();
    git::rebase::start(&r.path_str(), &base.to_string(), plan).unwrap();

    // Abort *before* advancing.
    let s = git::rebase::abort(&r.path_str()).unwrap();
    assert!(matches!(s, git::rebase::RebaseStatus::Idle));

    let head_now = r.repo.head().unwrap().peel_to_commit().unwrap().id();
    assert_eq!(head_now, original_head);
}

// ---------------------------------------------------------------------------
// worktree
// ---------------------------------------------------------------------------

#[test]
fn worktree_list_returns_main_only_for_fresh_repo() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "1\n", "init");

    let wts = git::worktree::list(&r.path_str()).unwrap();
    assert_eq!(
        wts.len(),
        1,
        "fresh repo should report only the main checkout"
    );
    let main = &wts[0];
    assert!(main.is_main);
    assert!(!main.is_locked);
    assert!(!main.is_prunable);
    assert!(main.head_oid.is_some());
    let branch = main.branch.as_deref().unwrap();
    assert!(
        branch == "master" || branch == "main",
        "unexpected default branch name: {branch}"
    );
}

#[test]
fn worktree_add_and_remove_round_trip() {
    let r = TempRepo::init();
    let oid = r.commit_file("a.txt", "1\n", "init");

    // Need a branch to attach the worktree to (libgit2 does not auto-create).
    git::refs_ops::create_branch(&r.path_str(), "feature/wt", &oid.to_string(), false).unwrap();

    // Place the new worktree in a sibling temp dir to avoid nested-repo issues.
    let target_root = tempfile::tempdir().expect("sibling tempdir");
    let target_path = target_root
        .path()
        .join("wt-feature")
        .to_string_lossy()
        .to_string();

    let added = git::worktree::add(
        &r.path_str(),
        "wt-feature",
        &target_path,
        Some("feature/wt"),
    )
    .unwrap();

    assert_eq!(added.name, "wt-feature");
    assert!(!added.is_main);
    assert_eq!(added.branch.as_deref(), Some("feature/wt"));

    // List should now report 2 entries (main + wt-feature).
    let wts = git::worktree::list(&r.path_str()).unwrap();
    assert_eq!(wts.len(), 2);
    assert_eq!(wts.iter().filter(|w| w.is_main).count(), 1);
    assert!(wts.iter().any(|w| w.name == "wt-feature" && !w.is_main));

    // Remove with force=true (working tree still exists).
    git::worktree::remove(&r.path_str(), "wt-feature", true).unwrap();

    let wts_after = git::worktree::list(&r.path_str()).unwrap();
    assert_eq!(wts_after.len(), 1);
    assert!(wts_after[0].is_main);
}

#[test]
fn worktree_prune_cleans_dangling_metadata() {
    let r = TempRepo::init();
    let oid = r.commit_file("a.txt", "1\n", "init");
    git::refs_ops::create_branch(&r.path_str(), "feature/zombie", &oid.to_string(), false).unwrap();

    let target_root = tempfile::tempdir().expect("sibling tempdir");
    let target_path = target_root
        .path()
        .join("zombie")
        .to_string_lossy()
        .to_string();
    git::worktree::add(
        &r.path_str(),
        "zombie",
        &target_path,
        Some("feature/zombie"),
    )
    .unwrap();

    // Simulate the user nuking the working directory on disk while metadata
    // under `.git/worktrees/zombie` survives — that's exactly the case
    // `prune` is for.
    std::fs::remove_dir_all(&target_path).unwrap();

    let pruned = git::worktree::prune(&r.path_str()).unwrap();
    assert_eq!(pruned, vec!["zombie".to_string()]);

    let wts_after = git::worktree::list(&r.path_str()).unwrap();
    assert_eq!(wts_after.len(), 1);
    assert!(wts_after[0].is_main);
}
