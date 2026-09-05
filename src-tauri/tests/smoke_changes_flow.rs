//! End-to-end smoke of the full Changes-panel flow against a real repo,
//! exercising every CLI-backed command the panel depends on in sequence.
use git_tools_lib::git;

mod common;
use common::TempRepo;

#[test]
fn changes_panel_full_flow_smoke() {
    let r = TempRepo::init();
    r.commit_file("base.txt", "keep\n", "base");

    // 1. edit + create files → working_changes classifies them.
    std::fs::write(r.path().join("base.txt"), "keep\nchanged\n").unwrap();
    std::fs::write(r.path().join("new.txt"), "brand new\n").unwrap();
    let changes = git::workspace::working_changes(&r.path_str()).unwrap();
    let base = changes.iter().find(|f| f.path == "base.txt").unwrap();
    let newf = changes.iter().find(|f| f.path == "new.txt").unwrap();
    assert!(matches!(base.flag, git::workspace::WorkingFlag::Unstaged));
    assert!(matches!(newf.flag, git::workspace::WorkingFlag::Untracked));

    // 2. inline preview (working_diff) picks up the unstaged edit.
    let fd = git::diff::working_diff(&r.path_str(), "base.txt", false).unwrap();
    assert_eq!(fd.new_path.as_deref(), Some("base.txt"));
    assert!(fd.hunks.iter().any(|h| h.lines.iter().any(|l| l.origin == "+" && l.content == "changed\n")));

    // 3. stage both, verify flags flip.
    git::workspace::stage_files(&r.path_str(), &["base.txt".to_string(), "new.txt".to_string()])
        .unwrap();
    let staged = git::workspace::working_changes(&r.path_str()).unwrap();
    assert!(
        staged
            .iter()
            .filter(|f| matches!(f.flag, git::workspace::WorkingFlag::Staged))
            .count()
            >= 2
    );

    // 4. line-level staging machinery: patch check + apply to index.
    let patch = "diff --git a/base.txt b/base.txt\n--- a/base.txt\n+++ b/base.txt\n@@ -1,2 +1,3 @@\n keep\n changed\n+changed2\n";
    git::patch::apply_patch_check(&r.path_str(), patch, git::patch::PatchLocation::Index).unwrap();
    git::patch::apply_patch(&r.path_str(), patch, git::patch::PatchLocation::Index).unwrap();
    // Real line-level staging already has the lines in the workdir — mirror that.
    std::fs::write(r.path().join("base.txt"), "keep\nchanged\nchanged2\n").unwrap();

    // 5. working-file editor plumbing.
    let head = git::workspace::read_head_file(&r.path_str(), "base.txt").unwrap();
    assert!(!head.missing);
    let live = git::workspace::read_working_file(&r.path_str(), "base.txt").unwrap();
    assert!(live.content.contains("changed"));
    git::workspace::write_working_file(&r.path_str(), "base.txt", &live.content).unwrap();

    // 6. commit via CLI (hooks default on; none installed here).
    let outcome = git::workspace::commit_changes(
        &r.path_str(),
        "smoke commit\n\nbody",
        &git::workspace::CommitOptions::default(),
    )
    .unwrap();
    assert!(!outcome.amended);
    assert_eq!(
        git::workspace::head_commit_message(&r.path_str())
            .unwrap()
            .as_deref()
            .map(str::trim_end),
        Some("smoke commit\n\nbody")
    );
    assert!(git::workspace::working_changes(&r.path_str()).unwrap().is_empty());

    // 7. amend round-trip (prefill source + amend commit).
    std::fs::write(r.path().join("base.txt"), "keep\nchanged\nchanged3\n").unwrap();
    git::workspace::stage_files(&r.path_str(), &["base.txt".to_string()]).unwrap();
    let amended = git::workspace::commit_changes(
        &r.path_str(),
        "smoke commit (amended)",
        &git::workspace::CommitOptions { amend: true, ..Default::default() },
    )
    .unwrap();
    assert!(amended.amended);

    // 8. stash button path.
    std::fs::write(r.path().join("base.txt"), "stash me\n").unwrap();
    let oid = git::stash::save(&r.path_str(), Some("smoke stash"), false, false).unwrap();
    assert!(!oid.is_empty());
    assert!(git::workspace::working_changes(&r.path_str()).unwrap().is_empty());
    // restore for cleanliness via existing stash machinery (Stash page).
    git::stash::pop(&r.path_str(), 0).unwrap();

    // 9. discard restores the workdir from the INDEX version.
    std::fs::write(r.path().join("base.txt"), "junk\n").unwrap();
    git::workspace::discard_files(&r.path_str(), &["base.txt".to_string()]).unwrap();
    let after = std::fs::read_to_string(r.path().join("base.txt")).unwrap();
    assert_eq!(after, "keep\nchanged\nchanged3\n");
}
