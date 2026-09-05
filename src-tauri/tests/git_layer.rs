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

#[test]
fn list_tags_distinguishes_annotated_from_lightweight() {
    let r = TempRepo::init();
    let oid = r.commit_file("a.txt", "1\n", "init commit summary");

    git::refs_ops::create_tag(&r.path_str(), "v1.0", &oid.to_string(), None).unwrap();
    git::refs_ops::create_tag(
        &r.path_str(),
        "v1.1",
        &oid.to_string(),
        Some("Release notes go here"),
    )
    .unwrap();

    let tags = git::refs::list_tags(&r.path_str()).unwrap();
    let by_name: std::collections::HashMap<_, _> =
        tags.iter().map(|t| (t.name.as_str(), t)).collect();

    let v10 = by_name.get("v1.0").expect("lightweight tag listed");
    assert!(!v10.is_annotated, "v1.0 should be lightweight");
    assert!(v10.message.is_none());
    assert!(v10.tagger_name.is_none());
    assert_eq!(v10.target_oid, oid.to_string());
    assert_eq!(v10.commit_summary, "init commit summary");

    let v11 = by_name.get("v1.1").expect("annotated tag listed");
    assert!(v11.is_annotated, "v1.1 should be annotated");
    assert_eq!(
        v11.message.as_deref().unwrap().trim(),
        "Release notes go here"
    );
    assert!(v11.tagger_name.is_some());
    // Annotated tag has its own oid distinct from the commit it points at.
    assert!(v11.tag_oid.is_some());
    assert_ne!(v11.tag_oid.as_deref().unwrap(), v11.target_oid);
}

#[test]
fn commit_meta_lists_containing_branches_and_tags() {
    let r = TempRepo::init();
    // Build a tiny graph:  c1 ── c2 (default) ── c3 (release)
    // and a tag v1.0 on c2 plus an annotated tag v1.1 on c3.
    let c1 = r.commit_file("a.txt", "1\n", "c1: subject line\n\nWith a body paragraph.");
    let c2 = r.commit_file("a.txt", "2\n", "c2");
    git::refs_ops::create_tag(&r.path_str(), "v1.0", &c2.to_string(), None).unwrap();

    // Whatever the default branch is called (`main` on modern git, `master`
    // on older configs), capture the actual name now so the assertions below
    // don't hard-code one or the other.
    let default_branch = r.repo.head().unwrap().shorthand().unwrap().to_string();

    // Branch off `release` from c2, advance one more commit on it.
    git::refs_ops::create_branch(&r.path_str(), "release", &c2.to_string(), true).unwrap();
    let c3 = r.commit_file("a.txt", "3\n", "c3");
    git::refs_ops::create_tag(&r.path_str(), "v1.1", &c3.to_string(), Some("Release 1.1")).unwrap();

    let meta = git::log::commit_meta(&r.path_str(), &c1.to_string()).unwrap();
    // Full message preserved (subject + body), summary is just the first line.
    assert!(meta.message.starts_with("c1: subject line"));
    assert!(meta.message.contains("With a body paragraph."));
    assert_eq!(meta.summary, "c1: subject line");
    // Root commit has no parents.
    assert!(meta.parents.is_empty());
    // c1 is reachable from BOTH the default branch and `release`,
    // and from BOTH tags.
    assert!(
        meta.containing_branches
            .iter()
            .any(|b| b == &default_branch),
        "expected {} in {:?}",
        default_branch,
        meta.containing_branches
    );
    assert!(meta.containing_branches.iter().any(|b| b == "release"));
    assert!(meta.containing_tags.contains(&"v1.0".to_string()));
    assert!(meta.containing_tags.contains(&"v1.1".to_string()));

    // c3 is only on `release`, and only tagged with v1.1.
    let meta3 = git::log::commit_meta(&r.path_str(), &c3.to_string()).unwrap();
    assert_eq!(meta3.parents, vec![c2.to_string()]);
    assert!(meta3.containing_branches.iter().any(|b| b == "release"));
    assert!(!meta3
        .containing_branches
        .iter()
        .any(|b| b == &default_branch));
    assert_eq!(meta3.containing_tags, vec!["v1.1".to_string()]);

    // v0.13.19 perf cleanup folded the signature probe into commit_meta.
    // For an unsigned commit it must surface as `signed: false` rather than
    // erroring or being absent — the CommitDetails panel keys on this.
    assert!(!meta3.signature.signed);
    assert_eq!(meta3.signature.format, None);
}

// ---------------------------------------------------------------------------
// blob (image / binary preview)
// ---------------------------------------------------------------------------

#[test]
fn read_blob_at_commit_round_trips_bytes() {
    use base64::Engine as _;
    let r = TempRepo::init();
    let payload = b"\x89PNG\r\n\x1a\n fake png bytes \xff\xfe\xfd";
    // We can't use commit_file (it expects str); write raw bytes then commit_all.
    std::fs::write(r.dir.path().join("logo.png"), payload).unwrap();
    let oid = r.commit_all("add logo");

    let got = git::blob::read_blob_at_commit(&r.path_str(), &oid.to_string(), "logo.png").unwrap();
    assert!(!got.missing);
    assert!(!got.oversized);
    assert_eq!(got.size, payload.len());
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&got.data_b64)
        .unwrap();
    assert_eq!(decoded, payload);
}

#[test]
fn read_blob_at_commit_marks_missing_paths() {
    let r = TempRepo::init();
    let oid = r.commit_file("only.txt", "hi\n", "init");
    let got = git::blob::read_blob_at_commit(&r.path_str(), &oid.to_string(), "does-not-exist.png")
        .unwrap();
    assert!(got.missing);
    assert_eq!(got.size, 0);
    assert!(got.data_b64.is_empty());
}

#[test]
fn read_working_blob_roundtrips_bytes_and_flags_missing() {
    use base64::Engine as _;
    let r = TempRepo::init();
    // Seed an initial commit so the workdir is non-empty.
    let _c = r.commit_file("a.txt", "1\n", "init");

    // Untracked binary file in the working tree.
    let payload = b"GIF89a\x00\x01\x02\x03\x04";
    std::fs::write(r.dir.path().join("preview.gif"), payload).unwrap();

    let got = git::blob::read_working_blob(&r.path_str(), "preview.gif").unwrap();
    assert!(!got.missing);
    assert!(!got.oversized);
    assert_eq!(got.size, payload.len());
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&got.data_b64)
        .unwrap();
    assert_eq!(decoded, payload);

    // A path that doesn't exist comes back as missing.
    let absent = git::blob::read_working_blob(&r.path_str(), "ghost.png").unwrap();
    assert!(absent.missing);
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

// ---------------------------------------------------------------------------
// gitignore editor
// ---------------------------------------------------------------------------

#[test]
fn gitignore_read_returns_empty_when_missing() {
    let r = TempRepo::init();
    let s = git::gitignore::read(&r.path_str()).unwrap();
    assert_eq!(s, "");
}

#[test]
fn gitignore_write_then_read_round_trips() {
    let r = TempRepo::init();
    let body = "node_modules/\ndist/\n*.log\n";
    git::gitignore::write(&r.path_str(), body).unwrap();

    let read_back = git::gitignore::read(&r.path_str()).unwrap();
    assert_eq!(read_back, body);

    // Also verify the file actually lives at <workdir>/.gitignore.
    let on_disk = std::fs::read_to_string(r.path().join(".gitignore")).unwrap();
    assert_eq!(on_disk, body);
}

#[test]
fn gitignore_preview_marks_newly_ignored_path() {
    let r = TempRepo::init();
    // Create an untracked file the candidate rule will want to ignore.
    r.write_file("debug.log", "noise\n");
    // Also a tracked file that should NOT show up.
    r.commit_file("a.txt", "1\n", "init");

    let pv = git::gitignore::preview(&r.path_str(), "*.log\n").unwrap();
    assert!(pv.scanned >= 1);
    assert!(
        pv.newly_ignored.iter().any(|p| p == "debug.log"),
        "expected debug.log in newly_ignored, got {:?}",
        pv.newly_ignored
    );
    assert!(pv.no_longer_ignored.is_empty());
}

#[test]
fn gitignore_preview_marks_no_longer_ignored_when_rule_removed() {
    let r = TempRepo::init();
    r.write_file("debug.log", "noise\n");
    r.commit_file("a.txt", "1\n", "init");

    // Ignore *.log on disk, then preview an empty candidate (effectively
    // the user is deleting the rule).
    git::gitignore::write(&r.path_str(), "*.log\n").unwrap();

    let pv = git::gitignore::preview(&r.path_str(), "").unwrap();
    assert!(
        pv.no_longer_ignored.iter().any(|p| p == "debug.log"),
        "expected debug.log to flip back to tracked, got {:?}",
        pv.no_longer_ignored
    );
    assert!(pv.newly_ignored.is_empty());
}

#[test]
fn gitignore_templates_are_well_formed() {
    let tpls = git::gitignore::templates();
    assert!(tpls.len() >= 6, "expected at least 6 starter templates");
    for t in &tpls {
        assert!(!t.id.is_empty(), "template id must not be empty");
        assert!(!t.label.is_empty(), "template label must not be empty");
        assert!(
            t.content.contains('\n'),
            "template `{}` should have multi-line content",
            t.id
        );
    }
    // ids must be unique
    let mut ids: Vec<&str> = tpls.iter().map(|t| t.id.as_str()).collect();
    ids.sort();
    let before = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), before, "duplicate template ids");
}

// ---------------------------------------------------------------------------
// log_page (cursor pagination)
// ---------------------------------------------------------------------------

#[test]
fn log_page_first_page_starts_from_head_and_signals_more() {
    let r = TempRepo::init();
    // Build a 7-commit linear history.
    let mut last_oid = git2::Oid::zero();
    for i in 0..7 {
        last_oid = r.commit_file(&format!("f{i}.txt"), &format!("{i}\n"), &format!("c{i}"));
    }

    let page = git::log::log_page(&r.path_str(), None, 4, None).unwrap();
    assert_eq!(page.commits.len(), 4);
    assert!(page.has_more, "7 commits with limit 4 must signal has_more");
    // First page newest-first: commit[0] is the latest.
    assert_eq!(page.commits[0].oid, last_oid.to_string());
    // next_cursor is the OID of the last commit on this page.
    assert_eq!(
        page.next_cursor.as_deref(),
        Some(page.commits.last().unwrap().oid.as_str())
    );
}

#[test]
fn log_page_second_page_continues_from_cursor_without_overlap() {
    let r = TempRepo::init();
    let mut all: Vec<git2::Oid> = Vec::new();
    for i in 0..6 {
        all.push(r.commit_file(&format!("f{i}.txt"), &format!("{i}\n"), &format!("c{i}")));
    }

    let p1 = git::log::log_page(&r.path_str(), None, 3, None).unwrap();
    let p2 = git::log::log_page(&r.path_str(), p1.next_cursor.as_deref(), 10, None).unwrap();

    // Combined we should see all 6 commits, in newest-first order, with
    // no duplicates and no gaps.
    let combined: Vec<String> = p1
        .commits
        .iter()
        .chain(p2.commits.iter())
        .map(|c| c.oid.clone())
        .collect();
    assert_eq!(combined.len(), 6);
    let mut expected: Vec<String> = all.iter().rev().map(|o| o.to_string()).collect();
    // log_page is newest-first; `all` is oldest-first, so reverse for the cmp.
    assert_eq!(combined, expected, "no overlap, no gap");
    expected.clear(); // silence unused-mut warning if compiler nags
    assert!(!p2.has_more);
}

#[test]
fn log_page_empty_repo_returns_empty_page() {
    let r = TempRepo::init();
    let page = git::log::log_page(&r.path_str(), None, 100, None).unwrap();
    assert!(page.commits.is_empty());
    assert!(!page.has_more);
    assert!(page.next_cursor.is_none());
}

#[test]
fn log_page_with_pathspec_filters_and_paginates() {
    let r = TempRepo::init();
    // 5 commits: only commits 0, 2, 4 touch foo.txt; 1, 3 touch bar.txt.
    for i in 0..5 {
        let f = if i % 2 == 0 { "foo.txt" } else { "bar.txt" };
        r.commit_file(f, &format!("{i}\n"), &format!("c{i}"));
    }

    let page = git::log::log_page(&r.path_str(), None, 100, Some("foo.txt")).unwrap();
    // Expect 3 commits all touching foo.txt.
    assert_eq!(page.commits.len(), 3);
    assert!(!page.has_more);
}

#[test]
fn log_page_cursor_at_root_yields_empty_next_page() {
    let r = TempRepo::init();
    // Single commit.
    let oid = r.commit_file("a.txt", "1\n", "init");

    // Asking for the page after the root commit must return nothing
    // (the root has no parents, so the walker has no starting point).
    let page = git::log::log_page(&r.path_str(), Some(&oid.to_string()), 10, None).unwrap();
    assert!(page.commits.is_empty());
    assert!(!page.has_more);
    assert!(page.next_cursor.is_none());
}

// ---------------------------------------------------------------------------
// log_since (v0.13.21 — incremental top-up walk)
// ---------------------------------------------------------------------------

#[test]
fn log_since_returns_only_commits_newer_than_cursor() {
    let r = TempRepo::init();
    let c1 = r.commit_file("a.txt", "1\n", "c1");
    let _c2 = r.commit_file("a.txt", "2\n", "c2");
    let _c3 = r.commit_file("a.txt", "3\n", "c3");

    // Ask for everything strictly newer than c1 — should be c3, c2 in that order.
    let added = git::log::log_since(&r.path_str(), &c1.to_string(), 1000)
        .unwrap()
        .expect("cursor still reachable");
    let summaries: Vec<&str> = added.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["c3", "c2"]);
}

#[test]
fn log_since_returns_empty_when_cursor_is_head() {
    let r = TempRepo::init();
    let head = r.commit_file("a.txt", "1\n", "only");
    let added = git::log::log_since(&r.path_str(), &head.to_string(), 1000)
        .unwrap()
        .expect("cursor reachable");
    assert!(
        added.is_empty(),
        "no new commits when cursor == HEAD, got {} entries",
        added.len()
    );
}

#[test]
fn log_since_returns_none_when_cursor_is_orphaned() {
    // Build a repo where the cursor commit becomes unreachable from HEAD —
    // the realistic case is `git reset --hard <older>` after the user has
    // already loaded the History view. log_since must report None so the
    // caller can fall back to a full reload.
    let r = TempRepo::init();
    let c1 = r.commit_file("a.txt", "1\n", "c1");
    let c2 = r.commit_file("a.txt", "2\n", "c2");
    // Now hard-reset HEAD back to c1; c2 is still in the object DB but not
    // reachable from HEAD anymore.
    git::commit_ops::reset(&r.path_str(), &c1.to_string(), "hard").unwrap();

    let res = git::log::log_since(&r.path_str(), &c2.to_string(), 1000).unwrap();
    assert!(
        res.is_none(),
        "orphaned cursor must return None to trigger full reload"
    );
}

// ---------------------------------------------------------------------------
// search (cross-history grep + pickaxe)
// ---------------------------------------------------------------------------

#[test]
fn search_message_mode_finds_matching_commit() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "1\n", "init: scaffold");
    r.commit_file("b.txt", "2\n", "feat: shiny new feature");
    r.commit_file("c.txt", "3\n", "fix: typo in README");

    let summary = git::search::search_commits(
        &r.path_str(),
        "feature",
        git::SearchMode::Message,
        git::PatternKind::Literal,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(summary.hits.len(), 1);
    let hit = &summary.hits[0];
    assert!(hit.message_match);
    assert!(hit.diff_hits.is_empty());
    assert!(hit.summary.contains("shiny new feature"));
    assert!(!summary.truncated);
}

#[test]
fn search_diff_mode_finds_added_line_pickaxe() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "alpha\n", "c1");
    r.commit_file("b.txt", "the secret token is XYZZY\nrest\n", "c2 add token");
    r.commit_file("c.txt", "unrelated\n", "c3");

    let summary = git::search::search_commits(
        &r.path_str(),
        "XYZZY",
        git::SearchMode::Diff,
        git::PatternKind::Literal,
        true,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(summary.hits.len(), 1);
    let hit = &summary.hits[0];
    assert!(!hit.message_match);
    assert!(!hit.diff_hits.is_empty());
    let dh = &hit.diff_hits[0];
    assert_eq!(dh.side, '+');
    assert_eq!(dh.file, "b.txt");
    assert!(dh.text.contains("XYZZY"));
}

#[test]
fn search_both_mode_unions_message_and_diff_hits() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "hello world\n", "init: TODO write tests");
    r.commit_file("b.txt", "alpha\nTODO refactor here\n", "feat: add feature");
    r.commit_file("c.txt", "calm\n", "chore: noise");

    let summary = git::search::search_commits(
        &r.path_str(),
        "TODO",
        git::SearchMode::Both,
        git::PatternKind::Literal,
        true,
        None,
        None,
        None,
    )
    .unwrap();
    // Both commits should match — one via message ("init: TODO ..."), the
    // other via the added "TODO refactor here" diff line.
    assert_eq!(summary.hits.len(), 2);
    let by_message = summary.hits.iter().any(|h| h.message_match);
    let by_diff = summary
        .hits
        .iter()
        .any(|h| h.diff_hits.iter().any(|d| d.text.contains("TODO")));
    assert!(by_message);
    assert!(by_diff);
}

#[test]
fn search_regex_kind_treats_pattern_as_regex() {
    let r = TempRepo::init();
    r.commit_file("v1.txt", "version=1.2.3\n", "release v1.2.3");
    r.commit_file("v2.txt", "version=10.20.30\n", "release v10.20.30");

    // Anchored regex: only the strict 1-2-3 pattern matches.
    let summary = git::search::search_commits(
        &r.path_str(),
        r"version=1\.2\.3",
        git::SearchMode::Both,
        git::PatternKind::Regex,
        true,
        None,
        None,
        None,
    )
    .unwrap();
    // The first commit matches in both message and diff.
    assert_eq!(summary.hits.len(), 1);
    let hit = &summary.hits[0];
    assert!(
        hit.diff_hits
            .iter()
            .any(|d| d.text.contains("version=1.2.3")),
        "diff should contain v1.2.3 line"
    );
}

#[test]
fn search_case_sensitivity_is_honoured() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "Foo bar\n", "case demo");

    // case_sensitive=true with lowercase pattern should NOT match "Foo".
    let summary = git::search::search_commits(
        &r.path_str(),
        "foo",
        git::SearchMode::Diff,
        git::PatternKind::Literal,
        true,
        None,
        None,
        None,
    )
    .unwrap();
    assert!(summary.hits.is_empty());

    // case_sensitive=false should match it.
    let summary2 = git::search::search_commits(
        &r.path_str(),
        "foo",
        git::SearchMode::Diff,
        git::PatternKind::Literal,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    assert_eq!(summary2.hits.len(), 1);
}

#[test]
fn search_pathspec_scopes_to_directory() {
    let r = TempRepo::init();
    // Same content in two paths; pathspec should keep only one.
    r.commit_file("src/lib.rs", "TARGET\n", "c1 src");
    r.commit_file("docs/readme.md", "TARGET\n", "c2 docs");

    let summary = git::search::search_commits(
        &r.path_str(),
        "TARGET",
        git::SearchMode::Diff,
        git::PatternKind::Literal,
        true,
        Some("src"),
        None,
        None,
    )
    .unwrap();
    // Only the src/ commit should surface a diff hit.
    assert_eq!(summary.hits.len(), 1);
    let hit = &summary.hits[0];
    assert!(hit.diff_hits.iter().all(|d| d.file.starts_with("src/")));
}

#[test]
fn search_empty_pattern_returns_no_hits() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "1\n", "init");

    let summary = git::search::search_commits(
        &r.path_str(),
        "",
        git::SearchMode::Both,
        git::PatternKind::Literal,
        false,
        None,
        None,
        None,
    )
    .unwrap();
    assert!(summary.hits.is_empty());
    assert_eq!(summary.scanned, 0);
}

#[test]
fn search_max_commits_truncates_walk() {
    let r = TempRepo::init();
    for i in 0..6 {
        r.commit_file(&format!("f{i}.txt"), &format!("{i}\n"), &format!("c{i}"));
    }
    let summary = git::search::search_commits(
        &r.path_str(),
        "nonexistent",
        git::SearchMode::Both,
        git::PatternKind::Literal,
        false,
        None,
        Some(3),
        None,
    )
    .unwrap();
    assert_eq!(summary.scanned, 3);
    assert!(summary.truncated);
    assert!(summary.hits.is_empty());
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

#[test]
fn diff_commit_files_lists_added_modified_and_deleted() {
    let r = TempRepo::init();
    r.commit_file("keep.txt", "k1\n", "c1: keep");
    r.commit_file("mod.txt", "before\n", "c2: add mod");
    // c3: modify mod.txt + add new.txt + delete keep.txt.
    std::fs::write(r.path().join("mod.txt"), "after\n").unwrap();
    std::fs::write(r.path().join("new.txt"), "fresh\n").unwrap();
    std::fs::remove_file(r.path().join("keep.txt")).unwrap();
    let oid = r.commit_all("c3: churn").to_string();

    let files = git::diff::commit_files(&r.path_str(), &oid).unwrap();
    let by_path: std::collections::HashMap<&str, &git::FileChange> =
        files.iter().map(|f| (f.path.as_str(), f)).collect();
    assert!(by_path.contains_key("mod.txt"));
    assert!(by_path.contains_key("new.txt"));
    assert!(by_path.contains_key("keep.txt"));
    assert!(matches!(
        by_path["mod.txt"].status,
        git::ChangeStatus::Modified
    ));
    assert!(matches!(
        by_path["new.txt"].status,
        git::ChangeStatus::Added
    ));
    assert!(matches!(
        by_path["keep.txt"].status,
        git::ChangeStatus::Deleted
    ));
}

/// Regression for the v0.13.19 perf cleanup that swapped per-file
/// `Patch::from_diff` for a single `diff.foreach` line-callback pass.
/// Make sure the `+` / `-` counters still attribute to the right file
/// and stay accurate when the commit touches a mix of pure-add /
/// pure-delete / modified files.
#[test]
fn diff_commit_files_per_file_line_stats_are_accurate() {
    let r = TempRepo::init();
    // c1: seed two files we'll churn in c2.
    r.commit_file("keep.txt", "k1\nk2\nk3\n", "c1: seed keep");
    r.commit_file("mod.txt", "m1\nm2\nm3\n", "c2: seed mod");
    // c3: modify mod.txt (1 added, 1 removed line, 2 context),
    //     add new.txt (3 added),
    //     delete keep.txt (3 removed).
    std::fs::write(r.path().join("mod.txt"), "m1\nM_2\nm3\n").unwrap();
    std::fs::write(r.path().join("new.txt"), "n1\nn2\nn3\n").unwrap();
    std::fs::remove_file(r.path().join("keep.txt")).unwrap();
    let oid = r.commit_all("c3: per-file stats").to_string();

    let files = git::diff::commit_files(&r.path_str(), &oid).unwrap();
    let by_path: std::collections::HashMap<&str, &git::FileChange> =
        files.iter().map(|f| (f.path.as_str(), f)).collect();

    // Modified file: exactly +1 / -1 (the M_2 line).
    let m = by_path["mod.txt"];
    assert_eq!(m.insertions, 1, "mod.txt insertions");
    assert_eq!(m.deletions, 1, "mod.txt deletions");

    // Pure addition: all three lines counted as inserts, zero deletes.
    let n = by_path["new.txt"];
    assert_eq!(n.insertions, 3, "new.txt insertions");
    assert_eq!(n.deletions, 0, "new.txt deletions");

    // Pure deletion: zero inserts, three deletes.
    let k = by_path["keep.txt"];
    assert_eq!(k.insertions, 0, "keep.txt insertions");
    assert_eq!(k.deletions, 3, "keep.txt deletions");
}

#[test]
fn diff_file_diff_returns_hunks_for_a_modified_file() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "alpha\nbeta\ngamma\n", "c1");
    std::fs::write(r.path().join("a.txt"), "alpha\nBETA\ngamma\n").unwrap();
    let oid = r.commit_all("c2: change beta").to_string();

    let fd = git::diff::file_diff(&r.path_str(), &oid, "a.txt", false).unwrap();
    assert!(!fd.is_binary);
    assert!(!fd.hunks.is_empty(), "expected at least one hunk");
    let added: Vec<&str> = fd
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .filter(|l| l.origin == "+")
        .map(|l| l.content.as_str())
        .collect();
    let removed: Vec<&str> = fd
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .filter(|l| l.origin == "-")
        .map(|l| l.content.as_str())
        .collect();
    assert!(added.iter().any(|s| s.contains("BETA")));
    assert!(removed.iter().any(|s| s.contains("beta")));
}

#[test]
fn diff_working_diff_picks_up_unstaged_edits() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "one\ntwo\nthree\n", "init");
    // Modify in workdir but DON'T stage it.
    std::fs::write(r.path().join("a.txt"), "one\nTWO\nthree\n").unwrap();

    let fd = git::diff::working_diff(&r.path_str(), "a.txt", false).unwrap();
    assert!(!fd.is_binary);
    assert!(!fd.hunks.is_empty());
    let has_two = fd
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .any(|l| l.origin == "+" && l.content.contains("TWO"));
    assert!(
        has_two,
        "working_diff should surface the unstaged 'TWO' line"
    );
}

// ---------------------------------------------------------------------------
// blame
// ---------------------------------------------------------------------------

#[test]
fn blame_file_attributes_each_line_to_its_commit() {
    let r = TempRepo::init();
    let c1 = r.commit_file("a.txt", "first\n", "c1");
    // c2: append a new line (first stays from c1, second comes from c2).
    std::fs::write(r.path().join("a.txt"), "first\nsecond\n").unwrap();
    let c2 = r.commit_all("c2: append");

    let lines = git::blame::blame_file(&r.path_str(), "a.txt").unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].line, 1);
    assert_eq!(lines[0].oid, c1.to_string());
    assert!(lines[0].content.contains("first"));
    assert_eq!(lines[1].line, 2);
    assert_eq!(lines[1].oid, c2.to_string());
    assert!(lines[1].content.contains("second"));
}

#[test]
fn blame_previous_filename_follows_a_rename() {
    let r = TempRepo::init();
    r.commit_file("old_name.txt", "v1\n", "c1: introduce");
    // c2: rename old_name.txt -> new_name.txt.
    r.rename_file("old_name.txt", "new_name.txt");
    let c2 = r.commit_all("c2: rename");

    let prev =
        git::blame::previous_filename(&r.path_str(), "new_name.txt", &c2.to_string()).unwrap();
    let prev = prev.expect("previous_filename should resolve across the rename");
    assert_eq!(prev.path, "old_name.txt");
}

#[test]
fn blame_previous_filename_returns_none_at_introduction_commit() {
    let r = TempRepo::init();
    let c1 = r.commit_file("a.txt", "1\n", "c1: introduce");
    // a.txt has no history before c1 — previous_filename should be None.
    let prev = git::blame::previous_filename(&r.path_str(), "a.txt", &c1.to_string()).unwrap();
    assert!(prev.is_none());
}

// ---------------------------------------------------------------------------
// commit_ops (cherry-pick / revert / reset soft & mixed)
// ---------------------------------------------------------------------------

#[test]
fn commit_ops_cherry_pick_stages_target_change_into_index() {
    // v0.13.26 — what this test checks changed. Pre-v0.13.26, libgit2's
    // bare `repo.cherrypick()` was used and it left the cherry-picked
    // change in the index without ever creating a commit — a hidden bug
    // we accidentally codified here. The new sequence-backed
    // `commit_ops::cherry_pick` always finishes the cherry-pick into a
    // real commit (matches `git cherry-pick`'s behaviour), so the
    // assertions are now:
    //   - the file appears on disk + in the index after cherry-pick
    //   - HEAD has *advanced* by exactly one commit, parented at the
    //     pre-cherry-pick HEAD, with the source commit's message.
    let r = TempRepo::init();
    let c1 = r.commit_file("a.txt", "1\n", "c1");
    let c2 = r.commit_file("b.txt", "from-c2\n", "c2: add b");

    // Wind HEAD back to c1 with a hard reset, removing b.txt from disk.
    git::commit_ops::reset(&r.path_str(), &c1.to_string(), "hard").unwrap();
    assert!(!r.path().join("b.txt").exists());

    git::commit_ops::cherry_pick(&r.path_str(), &c2.to_string()).unwrap();

    // The cherry-picked file should land in both the working tree and
    // the index.
    assert!(r.path().join("b.txt").exists(), "b.txt should be on disk");
    let mut index = r.repo.index().unwrap();
    index.read(true).unwrap();
    let staged = index.get_path(std::path::Path::new("b.txt"), 0);
    assert!(staged.is_some(), "b.txt should be staged in the index");

    // HEAD must have advanced to a new commit whose parent is c1 and
    // whose message comes from c2 (sequence-backed cherry-pick reuses
    // the source commit's message). Note: when c2 is c1's direct child,
    // cherry-picking it onto c1 deterministically produces a commit
    // with the same tree, parent, author *and* committer as c2, and
    // therefore the same oid — that's not a bug, it's content-addressed
    // storage doing its job. So we don't assert HEAD ≠ c2.
    let head_now = r.repo.head().unwrap().peel_to_commit().unwrap();
    assert_ne!(head_now.id(), c1, "cherry_pick should advance HEAD");
    assert_eq!(head_now.parent_count(), 1);
    assert_eq!(
        head_now.parent(0).unwrap().id(),
        c1,
        "new HEAD should sit on top of the pre-cherry-pick HEAD",
    );
    assert!(
        head_now.message().unwrap_or("").contains("c2: add b"),
        "new commit should preserve the source commit's message",
    );
}

#[test]
fn commit_ops_revert_creates_inverse_change_in_index() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "alpha\n", "c1: alpha");
    let c2 = r.commit_file("a.txt", "alpha\nbeta\n", "c2: add beta line");

    // Revert c2 -> the inverse (drop beta) should land in the index.
    git::commit_ops::revert(&r.path_str(), &c2.to_string()).unwrap();

    let mut index = r.repo.index().unwrap();
    index.read(true).unwrap();
    let entry = index.get_path(std::path::Path::new("a.txt"), 0).unwrap();
    let blob = r.repo.find_blob(entry.id).unwrap();
    let content = std::str::from_utf8(blob.content()).unwrap();
    assert_eq!(
        content, "alpha\n",
        "revert of c2 should restore the c1 content of a.txt"
    );
}

#[test]
fn commit_ops_reset_soft_keeps_index_and_workdir() {
    let r = TempRepo::init();
    let c1 = r.commit_file("a.txt", "1\n", "c1");
    r.commit_file("a.txt", "2\n", "c2");

    git::commit_ops::reset(&r.path_str(), &c1.to_string(), "soft").unwrap();

    // HEAD moved back to c1 ...
    let head_now = r.repo.head().unwrap().peel_to_commit().unwrap().id();
    assert_eq!(head_now, c1);
    // ... but the workdir still has the c2 content.
    let on_disk = std::fs::read_to_string(r.path().join("a.txt")).unwrap();
    assert_eq!(on_disk, "2\n");
    // ... and the index keeps the c2 staged version too (so `git status`
    // would show "Changes to be committed").
    let mut index = r.repo.index().unwrap();
    index.read(true).unwrap();
    let entry = index.get_path(std::path::Path::new("a.txt"), 0).unwrap();
    let blob = r.repo.find_blob(entry.id).unwrap();
    assert_eq!(std::str::from_utf8(blob.content()).unwrap(), "2\n");
}

#[test]
fn commit_ops_reset_mixed_clears_index_but_keeps_workdir() {
    let r = TempRepo::init();
    let c1 = r.commit_file("a.txt", "1\n", "c1");
    r.commit_file("a.txt", "2\n", "c2");

    git::commit_ops::reset(&r.path_str(), &c1.to_string(), "mixed").unwrap();

    // HEAD moved back, workdir untouched.
    assert_eq!(r.repo.head().unwrap().peel_to_commit().unwrap().id(), c1);
    assert_eq!(
        std::fs::read_to_string(r.path().join("a.txt")).unwrap(),
        "2\n"
    );
    // Index resets to c1 — so a.txt in the index now has the c1 content.
    let mut index = r.repo.index().unwrap();
    index.read(true).unwrap();
    let entry = index.get_path(std::path::Path::new("a.txt"), 0).unwrap();
    let blob = r.repo.find_blob(entry.id).unwrap();
    assert_eq!(std::str::from_utf8(blob.content()).unwrap(), "1\n");
}

// ---------------------------------------------------------------------------
// workspace (status / stage / unstage / discard / commit)
// ---------------------------------------------------------------------------

#[test]
fn workspace_working_changes_classifies_untracked_and_unstaged() {
    let r = TempRepo::init();
    r.commit_file("tracked.txt", "v1\n", "init");
    // Modify the tracked file (unstaged) and add an untracked one.
    std::fs::write(r.path().join("tracked.txt"), "v2\n").unwrap();
    std::fs::write(r.path().join("new.txt"), "hi\n").unwrap();

    let changes = git::workspace::working_changes(&r.path_str()).unwrap();
    let by_path: std::collections::HashMap<&str, &git::WorkingFile> =
        changes.iter().map(|f| (f.path.as_str(), f)).collect();
    let tracked = by_path.get("tracked.txt").expect("tracked.txt missing");
    let untracked = by_path.get("new.txt").expect("new.txt missing");

    assert!(matches!(
        tracked.flag,
        git::workspace::WorkingFlag::Unstaged
    ));
    assert!(matches!(
        tracked.status,
        git::workspace::WorkingStatus::Modified
    ));
    assert!(matches!(
        untracked.flag,
        git::workspace::WorkingFlag::Untracked
    ));
}

#[test]
fn workspace_stage_then_unstage_round_trip() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "v1\n", "init");
    std::fs::write(r.path().join("a.txt"), "v2\n").unwrap();

    // stage_files: now the change should appear as "staged".
    git::workspace::stage_files(&r.path_str(), &["a.txt".to_string()]).unwrap();
    let after_stage = git::workspace::working_changes(&r.path_str()).unwrap();
    let staged = after_stage
        .iter()
        .find(|f| f.path == "a.txt")
        .expect("a.txt should still be in changes");
    assert!(matches!(staged.flag, git::workspace::WorkingFlag::Staged));

    // unstage_files: should flip back to "unstaged" (workdir still differs).
    git::workspace::unstage_files(&r.path_str(), &["a.txt".to_string()]).unwrap();
    let after_unstage = git::workspace::working_changes(&r.path_str()).unwrap();
    let unstaged = after_unstage
        .iter()
        .find(|f| f.path == "a.txt")
        .expect("a.txt should still be in changes after unstage");
    assert!(matches!(
        unstaged.flag,
        git::workspace::WorkingFlag::Unstaged
    ));
}

#[test]
fn workspace_discard_files_reverts_workdir_to_index_for_tracked() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "original\n", "init");
    std::fs::write(r.path().join("a.txt"), "garbage\n").unwrap();

    git::workspace::discard_files(&r.path_str(), &["a.txt".to_string()]).unwrap();

    let on_disk = std::fs::read_to_string(r.path().join("a.txt")).unwrap();
    assert_eq!(on_disk, "original\n");
    // No remaining working changes.
    let after = git::workspace::working_changes(&r.path_str()).unwrap();
    assert!(after.iter().all(|f| f.path != "a.txt"));
}

#[test]
fn workspace_discard_files_deletes_untracked_files() {
    let r = TempRepo::init();
    r.commit_file("anchor.txt", "stay\n", "init");
    // Create an untracked file.
    std::fs::write(r.path().join("trash.txt"), "noise\n").unwrap();
    assert!(r.path().join("trash.txt").exists());

    git::workspace::discard_files(&r.path_str(), &["trash.txt".to_string()]).unwrap();
    assert!(
        !r.path().join("trash.txt").exists(),
        "discard should delete untracked files from disk"
    );
}

#[test]
fn workspace_commit_changes_creates_a_new_head_commit() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "v1\n", "init");
    std::fs::write(r.path().join("a.txt"), "v2\n").unwrap();
    git::workspace::stage_files(&r.path_str(), &["a.txt".to_string()]).unwrap();
    let head_before = r.repo.head().unwrap().target().unwrap();

    let outcome = git::workspace::commit_changes(
        &r.path_str(),
        "v2 commit",
        &git::workspace::CommitOptions::default(),
    )
    .unwrap();
    let new_oid = git2::Oid::from_str(&outcome.oid).unwrap();
    assert!(!outcome.amended);

    let head_after = r.repo.head().unwrap().target().unwrap();
    assert_ne!(head_before, head_after);
    assert_eq!(head_after, new_oid);
    let c = r.repo.find_commit(new_oid).unwrap();
    assert_eq!(c.summary().unwrap_or(""), "v2 commit");
    // No remaining working changes.
    let after = git::workspace::working_changes(&r.path_str()).unwrap();
    assert!(after.is_empty());
}

/// v0.13.35 — CLI-backed amend prefill: `git log -1 --format=%B` returns
/// HEAD's full message (subject + body), and `None` on an unborn HEAD.
#[test]
fn workspace_head_commit_message_full_message_and_unborn_none() {
    let r = TempRepo::init();
    // No commits yet → None.
    assert!(git::workspace::head_commit_message(&r.path_str())
        .unwrap()
        .is_none());

    r.commit_file("a.txt", "v1\n", "subject line\n\nbody text");
    let msg = git::workspace::head_commit_message(&r.path_str()).unwrap();
    assert_eq!(
        msg.as_deref().map(str::trim_end),
        Some("subject line\n\nbody text")
    );
}

/// v0.13.20 amend: replaces HEAD with a new commit whose parents are
/// HEAD's parents (root commit ⇒ no parents) and whose tree picks up the
/// freshly-staged delta. The original commit becomes unreferenced.
#[test]
fn workspace_commit_amend_replaces_head_and_keeps_history_linear() {
    let r = TempRepo::init();
    let first = r.commit_file("a.txt", "v1\n", "init");
    // Stage an additional file we want to fold into the same commit.
    std::fs::write(r.path().join("b.txt"), "fresh\n").unwrap();
    git::workspace::stage_files(&r.path_str(), &["b.txt".to_string()]).unwrap();

    let outcome = git::workspace::commit_changes(
        &r.path_str(),
        "init (amended)",
        &git::workspace::CommitOptions {
            amend: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(outcome.amended);

    // HEAD has moved to a brand-new oid…
    let head_after = r.repo.head().unwrap().target().unwrap();
    assert_ne!(head_after, first);
    // …but the parent count is preserved (was a root commit → still a root).
    let amended = r.repo.find_commit(head_after).unwrap();
    assert_eq!(amended.parent_count(), 0);
    assert_eq!(amended.summary().unwrap_or(""), "init (amended)");
    // And it now contains b.txt as well.
    let tree = amended.tree().unwrap();
    assert!(tree.get_path(std::path::Path::new("a.txt")).is_ok());
    assert!(tree.get_path(std::path::Path::new("b.txt")).is_ok());
}

/// Signoff = true appends `Signed-off-by:` trailer using user.{name,email}
/// from git config.
#[test]
fn workspace_commit_changes_appends_signoff_trailer_when_requested() {
    let r = TempRepo::init();
    r.commit_file("seed.txt", "1\n", "seed");
    std::fs::write(r.path().join("seed.txt"), "2\n").unwrap();
    git::workspace::stage_files(&r.path_str(), &["seed.txt".to_string()]).unwrap();

    let outcome = git::workspace::commit_changes(
        &r.path_str(),
        "Subject only",
        &git::workspace::CommitOptions {
            signoff: true,
            ..Default::default()
        },
    )
    .unwrap();
    let c = r
        .repo
        .find_commit(git2::Oid::from_str(&outcome.oid).unwrap())
        .unwrap();
    let msg = c.message().unwrap_or("");
    assert!(msg.contains("Signed-off-by: Test User <test@example.com>"));
    // Subject + blank line + trailer.
    assert!(msg.starts_with("Subject only\n\nSigned-off-by:"));
}

/// Amend with `reset_author = true` overwrites the original author
/// identity + timestamp with `user.*` + now. Useful when picking up
/// someone else's commit and re-attributing it to yourself.
#[test]
fn workspace_commit_amend_with_reset_author_replaces_author_identity() {
    let r = TempRepo::init();
    // Seed a commit authored by a *different* identity than the test repo's
    // configured user.{name,email}.
    let other = git2::Signature::new(
        "Other",
        "other@example.com",
        &git2::Time::new(1_700_000_000, 0),
    )
    .unwrap();
    let mut idx = r.repo.index().unwrap();
    std::fs::write(r.path().join("a.txt"), "1\n").unwrap();
    idx.add_path(std::path::Path::new("a.txt")).unwrap();
    idx.write().unwrap();
    let tree = r.repo.find_tree(idx.write_tree().unwrap()).unwrap();
    r.repo
        .commit(Some("HEAD"), &other, &other, "first", &tree, &[])
        .unwrap();

    // Amend with reset_author.
    std::fs::write(r.path().join("a.txt"), "2\n").unwrap();
    git::workspace::stage_files(&r.path_str(), &["a.txt".to_string()]).unwrap();
    let outcome = git::workspace::commit_changes(
        &r.path_str(),
        "first (amended)",
        &git::workspace::CommitOptions {
            amend: true,
            reset_author: true,
            ..Default::default()
        },
    )
    .unwrap();
    let amended = r
        .repo
        .find_commit(git2::Oid::from_str(&outcome.oid).unwrap())
        .unwrap();
    let new_author = amended.author();
    assert_eq!(new_author.email().unwrap_or(""), "test@example.com");
    assert_eq!(new_author.name().unwrap_or(""), "Test User");
}

/// pre-commit failure aborts the commit (no new HEAD) with the hook's
/// stderr surfaced verbatim. Skipped on Windows because writing a
/// shebang-style hook that reliably runs in CI is brittle there.
#[cfg(unix)]
#[test]
fn workspace_commit_changes_aborts_when_pre_commit_hook_fails() {
    use std::os::unix::fs::PermissionsExt;

    let r = TempRepo::init();
    r.commit_file("a.txt", "v1\n", "seed");
    std::fs::write(r.path().join("a.txt"), "v2\n").unwrap();
    git::workspace::stage_files(&r.path_str(), &["a.txt".to_string()]).unwrap();

    // Drop a pre-commit that bails with a recognisable string.
    let hook = r.path().join(".git").join("hooks").join("pre-commit");
    std::fs::write(&hook, b"#!/bin/sh\necho \"linter says no\" >&2\nexit 7\n").unwrap();
    let mut perm = std::fs::metadata(&hook).unwrap().permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(&hook, perm).unwrap();

    let head_before = r.repo.head().unwrap().target().unwrap();
    let err = git::workspace::commit_changes(
        &r.path_str(),
        "should not land",
        &git::workspace::CommitOptions::default(),
    )
    .unwrap_err();
    // git itself relays the hook's stderr verbatim; the failing script's
    // message must survive into the error (git doesn't name the hook).
    assert!(err.message().contains("linter says no"));
    let head_after = r.repo.head().unwrap().target().unwrap();
    assert_eq!(
        head_before, head_after,
        "HEAD must not move when pre-commit fails"
    );
}

/// `run_hooks: false` skips hook execution entirely, even if a hook exists
/// and would normally fail. Mirrors `git commit --no-verify`.
#[cfg(unix)]
#[test]
fn workspace_commit_changes_skips_hooks_when_disabled() {
    use std::os::unix::fs::PermissionsExt;

    let r = TempRepo::init();
    r.commit_file("a.txt", "v1\n", "seed");
    std::fs::write(r.path().join("a.txt"), "v2\n").unwrap();
    git::workspace::stage_files(&r.path_str(), &["a.txt".to_string()]).unwrap();

    let hook = r.path().join(".git").join("hooks").join("pre-commit");
    std::fs::write(&hook, b"#!/bin/sh\nexit 1\n").unwrap();
    let mut perm = std::fs::metadata(&hook).unwrap().permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(&hook, perm).unwrap();

    let outcome = git::workspace::commit_changes(
        &r.path_str(),
        "no-verify",
        &git::workspace::CommitOptions {
            run_hooks: false,
            ..Default::default()
        },
    )
    .expect("hook bypass");
    assert!(!outcome.amended);
}

// ---------------------------------------------------------------------------
// working-file editor (read_working_file / read_head_file / write_working_file)
// ---------------------------------------------------------------------------

#[test]
fn working_file_read_returns_disk_contents() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "hello\nworld\n", "init");
    // Modify the working tree.
    std::fs::write(r.path().join("a.txt"), "hello\nplanet\n").unwrap();
    let got = git_tools_lib::git::workspace::read_working_file(&r.path_str(), "a.txt").unwrap();
    assert!(!got.missing);
    assert_eq!(got.content, "hello\nplanet\n");
}

#[test]
fn working_file_read_missing_marks_flag() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "x\n", "init");
    let got = git_tools_lib::git::workspace::read_working_file(&r.path_str(), "nope.txt").unwrap();
    assert!(got.missing);
    assert!(got.content.is_empty());
}

#[test]
fn working_file_read_rejects_path_traversal() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "x\n", "init");
    let err = git_tools_lib::git::workspace::read_working_file(&r.path_str(), "../escape.txt")
        .unwrap_err();
    assert!(
        err.message().to_lowercase().contains("escape")
            || err.message().to_lowercase().contains("escapes"),
        "got: {}",
        err.message()
    );
}

#[test]
fn working_file_read_rejects_binary() {
    let r = TempRepo::init();
    let bytes: Vec<u8> = vec![0x00, 0xff, 0x00, 0xff, 0x00];
    std::fs::write(r.path().join("blob.bin"), &bytes).unwrap();
    let err =
        git_tools_lib::git::workspace::read_working_file(&r.path_str(), "blob.bin").unwrap_err();
    assert!(err.message().to_lowercase().contains("binary"));
}

#[test]
fn write_working_file_round_trips_through_disk() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "v1\n", "init");

    git_tools_lib::git::workspace::write_working_file(&r.path_str(), "a.txt", "v2 from editor\n")
        .unwrap();

    let on_disk = std::fs::read_to_string(r.path().join("a.txt")).unwrap();
    assert_eq!(on_disk, "v2 from editor\n");
    // working_changes should now report a.txt as unstaged-modified.
    let changes = git_tools_lib::git::workspace::working_changes(&r.path_str()).unwrap();
    assert!(changes.iter().any(|f| f.path == "a.txt"));
}

#[test]
fn write_working_file_creates_missing_parent_dirs() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "v1\n", "init");

    git_tools_lib::git::workspace::write_working_file(
        &r.path_str(),
        "deep/nested/path/new.txt",
        "hi\n",
    )
    .unwrap();
    let on_disk = std::fs::read_to_string(r.path().join("deep/nested/path/new.txt")).unwrap();
    assert_eq!(on_disk, "hi\n");
}

#[test]
fn write_working_file_refuses_path_traversal() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "x\n", "init");
    let err =
        git_tools_lib::git::workspace::write_working_file(&r.path_str(), "../evil.txt", "hello")
            .unwrap_err();
    assert!(err.message().to_lowercase().contains("escape"));
    // And nothing was written outside the workdir.
    assert!(!r.path().parent().unwrap().join("evil.txt").exists());
}

#[test]
fn read_head_file_returns_blob_at_head() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "original\n", "init");
    std::fs::write(r.path().join("a.txt"), "dirty\n").unwrap();

    let head_text = git_tools_lib::git::workspace::read_head_file(&r.path_str(), "a.txt").unwrap();
    assert!(!head_text.missing);
    assert_eq!(head_text.content, "original\n");
}

#[test]
fn read_head_file_marks_missing_when_file_not_in_head() {
    let r = TempRepo::init();
    r.commit_file("a.txt", "only-a\n", "init");
    let got =
        git_tools_lib::git::workspace::read_head_file(&r.path_str(), "new-untracked.txt").unwrap();
    assert!(got.missing);
    assert!(got.content.is_empty());
}
