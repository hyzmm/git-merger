//! Interactive rebase.
//!
//! We don't use `git2::Rebase` directly because it's a 1:1 transcription of
//! `git rebase` and doesn't model squash/fixup/reword/drop natively. Instead
//! we drive the operation ourselves:
//!
//!   1. `start` records a plan (one step per commit in `base..HEAD`) plus the
//!      branch we will rewrite, then hard-resets that branch to the base.
//!   2. `next_step` consumes the head of the plan: cherry-picks the source
//!      commit, then commits with the action's chosen message — or amends the
//!      previous commit (squash/fixup), or skips (drop). On a conflict the
//!      step stays at the head of the plan and the index is left dirty for
//!      the user to resolve via the Merge view; they then call `rebase_continue`.
//!   3. When the plan is empty we wipe the on-disk state file. `abort`
//!      restores the original branch tip from the saved state.
//!
//! State lives at `<repo>/.git/gittools-rebase/state.json`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use git2::{
    build::CheckoutBuilder, CherrypickOptions, MergeOptions, Repository, ResetType, Signature,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RebaseAction {
    /// Apply the commit as-is.
    Pick,
    /// Apply the commit, then prompt for a new message.
    Reword,
    /// Apply the commit, then merge it into the previous one (combined message).
    Squash,
    /// Like squash but keep the previous message and discard this one.
    Fixup,
    /// Skip this commit entirely.
    Drop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebaseStep {
    pub action: RebaseAction,
    /// Source commit to apply.
    pub oid: String,
    pub short_oid: String,
    /// Original commit summary (subject line) — shown in the planner UI.
    pub summary: String,
    /// New message for `reword` / `squash`. Empty otherwise.
    #[serde(default)]
    pub new_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebaseState {
    /// Branch ref being rewritten (e.g. "refs/heads/main"), or None for detached HEAD.
    pub branch_ref: Option<String>,
    /// Tip of the branch *before* we started — for `abort`.
    pub original_head: String,
    /// Base commit (everything above this is being replayed).
    pub base: String,
    /// Steps not yet executed. Front of the vec = next.
    pub remaining: Vec<RebaseStep>,
    /// Number of steps already finished (for progress UI).
    pub done: usize,
    /// Total steps (== done + remaining at start, fixed thereafter).
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RebaseStatus {
    /// No rebase in progress.
    Idle,
    /// Rebase running and clean — UI can advance.
    Running { state: RebaseState },
    /// Last step produced conflicts; user must resolve via Merge view, then
    /// call `rebase_continue`.
    Conflicted { state: RebaseState },
    /// Rebase finished cleanly.
    Done { rewritten: usize },
}

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

fn state_file(repo: &Repository) -> PathBuf {
    repo.path().join("gittools-rebase").join("state.json")
}

fn load_state(repo: &Repository) -> Result<Option<RebaseState>, git2::Error> {
    let p = state_file(repo);
    if !p.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&p)
        .map_err(|e| git2::Error::from_str(&format!("read rebase state: {e}")))?;
    let st: RebaseState = serde_json::from_str(&text)
        .map_err(|e| git2::Error::from_str(&format!("parse rebase state: {e}")))?;
    Ok(Some(st))
}

fn save_state(repo: &Repository, st: &RebaseState) -> Result<(), git2::Error> {
    let p = state_file(repo);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| git2::Error::from_str(&format!("create state dir: {e}")))?;
    }
    let body = serde_json::to_string_pretty(st)
        .map_err(|e| git2::Error::from_str(&format!("serialize rebase state: {e}")))?;
    fs::write(&p, body).map_err(|e| git2::Error::from_str(&format!("write rebase state: {e}")))?;
    Ok(())
}

fn clear_state(repo: &Repository) -> Result<(), git2::Error> {
    let p = state_file(repo);
    if p.exists() {
        fs::remove_file(&p)
            .map_err(|e| git2::Error::from_str(&format!("remove rebase state: {e}")))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Public ops
// ---------------------------------------------------------------------------

/// Build the default plan for an interactive rebase onto `base_oid`.
/// Walks `base..HEAD` in chronological order (oldest first) and assigns
/// `Pick` to every commit. The UI lets the user reorder / re-action this list
/// before calling `start`.
pub fn plan(path: &str, base_oid: &str) -> Result<Vec<RebaseStep>, git2::Error> {
    let repo = Repository::discover(path)?;
    let head = repo.head()?.peel_to_commit()?;
    let base = repo
        .find_object(git2::Oid::from_str(base_oid)?, None)?
        .peel_to_commit()?;

    // Walk `base..HEAD` (excludes base, includes HEAD).
    let mut walk = repo.revwalk()?;
    walk.push(head.id())?;
    walk.hide(base.id())?;
    walk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME | git2::Sort::REVERSE)?;

    let mut steps = Vec::new();
    for oid in walk {
        let oid = oid?;
        let c = repo.find_commit(oid)?;
        steps.push(RebaseStep {
            action: RebaseAction::Pick,
            oid: oid.to_string(),
            short_oid: oid.to_string()[..7].to_string(),
            summary: c.summary().unwrap_or("").to_string(),
            new_message: String::new(),
        });
    }
    Ok(steps)
}

/// Begin a rebase. The branch (or HEAD if detached) is hard-reset to `base`,
/// and the supplied `steps` plan is persisted. Then `next_step` should be
/// called repeatedly until idle.
pub fn start(
    path: &str,
    base_oid: &str,
    steps: Vec<RebaseStep>,
) -> Result<RebaseStatus, git2::Error> {
    let repo = Repository::discover(path)?;

    if load_state(&repo)?.is_some() {
        return Err(git2::Error::from_str(
            "a rebase is already in progress — continue or abort it first",
        ));
    }

    let head = repo.head()?;
    let original_head = head.peel_to_commit()?.id().to_string();
    let branch_ref = if head.is_branch() {
        head.name().map(|s| s.to_string())
    } else {
        None
    };

    let total = steps.len();
    let st = RebaseState {
        branch_ref,
        original_head,
        base: base_oid.to_string(),
        remaining: steps,
        done: 0,
        total,
    };

    // Hard-reset to base before we start replaying.
    let base = repo
        .find_object(git2::Oid::from_str(base_oid)?, None)?
        .peel_to_commit()?
        .into_object();
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.reset(&base, ResetType::Hard, Some(&mut co))?;

    save_state(&repo, &st)?;

    Ok(RebaseStatus::Running { state: st })
}

/// Execute the next step. Returns `Conflicted` if the cherry-pick produced
/// conflicts (user must resolve + call `rebase_continue`); `Running` if there
/// are more steps; `Done` when finished.
pub fn next_step(path: &str) -> Result<RebaseStatus, git2::Error> {
    let repo = Repository::discover(path)?;
    let mut st = match load_state(&repo)? {
        Some(s) => s,
        None => return Ok(RebaseStatus::Idle),
    };

    if st.remaining.is_empty() {
        return finalize(&repo, &st);
    }

    let step = st.remaining[0].clone();

    match step.action {
        RebaseAction::Drop => {
            // No-op; just advance.
            st.remaining.remove(0);
            st.done += 1;
            save_state(&repo, &st)?;
            return Ok(RebaseStatus::Running { state: st });
        }
        RebaseAction::Pick | RebaseAction::Reword => {
            let commit = repo
                .find_object(git2::Oid::from_str(&step.oid)?, None)?
                .peel_to_commit()?;

            let mut opts = CherrypickOptions::new();
            opts.merge_opts(MergeOptions::new());
            repo.cherrypick(&commit, Some(&mut opts))?;

            if repo.index()?.has_conflicts() {
                save_state(&repo, &st)?;
                return Ok(RebaseStatus::Conflicted { state: st });
            }

            // Build a new commit on top of HEAD with the (possibly reworded) message.
            let message =
                if matches!(step.action, RebaseAction::Reword) && !step.new_message.is_empty() {
                    step.new_message.clone()
                } else {
                    commit.message().unwrap_or("").to_string()
                };
            let parent = repo.head()?.peel_to_commit()?;
            create_commit(&repo, &commit, &parent, &message)?;

            // libgit2's cherrypick leaves CHERRY_PICK_HEAD; clear it.
            repo.cleanup_state().ok();
        }
        RebaseAction::Squash | RebaseAction::Fixup => {
            // Apply the commit's content on top of the previous one and amend.
            let commit = repo
                .find_object(git2::Oid::from_str(&step.oid)?, None)?
                .peel_to_commit()?;

            let mut opts = CherrypickOptions::new();
            opts.merge_opts(MergeOptions::new());
            repo.cherrypick(&commit, Some(&mut opts))?;

            if repo.index()?.has_conflicts() {
                save_state(&repo, &st)?;
                return Ok(RebaseStatus::Conflicted { state: st });
            }

            // HEAD is the previous commit (the one we'll absorb into).
            let prev = repo.head()?.peel_to_commit()?;
            let combined_msg = match step.action {
                RebaseAction::Fixup => prev.message().unwrap_or("").to_string(),
                _ => {
                    // squash: prefer user-supplied combined message, else
                    // concatenate previous + this commit's message.
                    if !step.new_message.is_empty() {
                        step.new_message.clone()
                    } else {
                        format!(
                            "{}\n\n{}",
                            prev.message().unwrap_or("").trim_end(),
                            commit.message().unwrap_or("").trim_end()
                        )
                    }
                }
            };
            amend_with_index(&repo, &prev, &commit, &combined_msg)?;
            repo.cleanup_state().ok();
        }
    }

    st.remaining.remove(0);
    st.done += 1;

    if st.remaining.is_empty() {
        finalize(&repo, &st)
    } else {
        save_state(&repo, &st)?;
        Ok(RebaseStatus::Running { state: st })
    }
}

/// User has resolved the conflicts and re-staged. Commit the merge result and
/// then advance.
pub fn cont(path: &str) -> Result<RebaseStatus, git2::Error> {
    let repo = Repository::discover(path)?;
    let mut st = match load_state(&repo)? {
        Some(s) => s,
        None => return Ok(RebaseStatus::Idle),
    };
    if st.remaining.is_empty() {
        return finalize(&repo, &st);
    }
    let step = st.remaining[0].clone();

    if repo.index()?.has_conflicts() {
        return Err(git2::Error::from_str(
            "there are still unresolved conflicts; resolve them in the Merge view first",
        ));
    }

    let source = repo
        .find_object(git2::Oid::from_str(&step.oid)?, None)?
        .peel_to_commit()?;

    match step.action {
        RebaseAction::Pick | RebaseAction::Reword | RebaseAction::Drop => {
            let message =
                if matches!(step.action, RebaseAction::Reword) && !step.new_message.is_empty() {
                    step.new_message.clone()
                } else {
                    source.message().unwrap_or("").to_string()
                };
            let parent = repo.head()?.peel_to_commit()?;
            create_commit(&repo, &source, &parent, &message)?;
        }
        RebaseAction::Squash | RebaseAction::Fixup => {
            let prev = repo.head()?.peel_to_commit()?;
            let combined_msg = match step.action {
                RebaseAction::Fixup => prev.message().unwrap_or("").to_string(),
                _ => {
                    if !step.new_message.is_empty() {
                        step.new_message.clone()
                    } else {
                        format!(
                            "{}\n\n{}",
                            prev.message().unwrap_or("").trim_end(),
                            source.message().unwrap_or("").trim_end()
                        )
                    }
                }
            };
            amend_with_index(&repo, &prev, &source, &combined_msg)?;
        }
    }
    repo.cleanup_state().ok();

    st.remaining.remove(0);
    st.done += 1;

    if st.remaining.is_empty() {
        finalize(&repo, &st)
    } else {
        save_state(&repo, &st)?;
        // Don't auto-advance — the UI calls next_step on its own.
        Ok(RebaseStatus::Running { state: st })
    }
}

/// Cancel an in-progress rebase and restore the original branch tip.
pub fn abort(path: &str) -> Result<RebaseStatus, git2::Error> {
    let repo = Repository::discover(path)?;
    let st = match load_state(&repo)? {
        Some(s) => s,
        None => return Ok(RebaseStatus::Idle),
    };

    let target = repo
        .find_object(git2::Oid::from_str(&st.original_head)?, None)?
        .peel_to_commit()?
        .into_object();
    let mut co = CheckoutBuilder::new();
    co.force();
    repo.reset(&target, ResetType::Hard, Some(&mut co))?;
    repo.cleanup_state().ok();
    clear_state(&repo)?;
    Ok(RebaseStatus::Idle)
}

/// What's the current rebase state? (For the UI to know whether to show
/// the rebase page.)
pub fn status(path: &str) -> Result<RebaseStatus, git2::Error> {
    let repo = Repository::discover(path)?;
    let st = match load_state(&repo)? {
        Some(s) => s,
        None => return Ok(RebaseStatus::Idle),
    };
    if repo.index()?.has_conflicts() {
        Ok(RebaseStatus::Conflicted { state: st })
    } else {
        Ok(RebaseStatus::Running { state: st })
    }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/// Resolve the author/committer signatures, preferring the original author
/// of `source` (so rebasing preserves authorship), with a fresh committer.
fn signatures<'a>(
    repo: &'a Repository,
    source: &'a git2::Commit<'a>,
) -> Result<(Signature<'a>, Signature<'a>), git2::Error> {
    let author = source.author().to_owned();
    let committer = repo.signature()?;
    Ok((author, committer))
}

/// Commit the current index with the given parent + message.
fn create_commit(
    repo: &Repository,
    source: &git2::Commit<'_>,
    parent: &git2::Commit<'_>,
    message: &str,
) -> Result<git2::Oid, git2::Error> {
    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let (author, committer) = signatures(repo, source)?;
    let new_oid = repo.commit(Some("HEAD"), &author, &committer, message, &tree, &[parent])?;
    index.write()?;
    Ok(new_oid)
}

/// Replace `prev` with a new commit that has `prev`'s parent and the current
/// index tree (which already includes `source`'s changes), preserving
/// `source`'s author. Updates HEAD to point at the new commit.
fn amend_with_index(
    repo: &Repository,
    prev: &git2::Commit<'_>,
    source: &git2::Commit<'_>,
    message: &str,
) -> Result<git2::Oid, git2::Error> {
    let mut index = repo.index()?;
    let tree_oid = index.write_tree()?;
    let tree = repo.find_tree(tree_oid)?;
    let (author, committer) = signatures(repo, source)?;
    let parents: Vec<git2::Commit<'_>> = (0..prev.parent_count())
        .map(|i| prev.parent(i))
        .collect::<Result<_, _>>()?;
    let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
    let new_oid = repo.commit(
        Some("HEAD"),
        &author,
        &committer,
        message,
        &tree,
        &parent_refs,
    )?;
    index.write()?;
    Ok(new_oid)
}

/// Move the saved branch ref (if any) to the current detached HEAD's tip,
/// clear state, and report Done.
fn finalize(repo: &Repository, st: &RebaseState) -> Result<RebaseStatus, git2::Error> {
    if let Some(branch_ref) = &st.branch_ref {
        let new_tip = repo.head()?.peel_to_commit()?.id();
        // Move the saved branch ref to the new tip, then re-attach HEAD.
        let mut r = repo.find_reference(branch_ref)?;
        r.set_target(new_tip, "rebase: finalize")?;
        repo.set_head(branch_ref)?;
        let mut co = CheckoutBuilder::new();
        co.force();
        repo.checkout_head(Some(&mut co))?;
    }
    clear_state(repo)?;
    Ok(RebaseStatus::Done { rewritten: st.done })
}
