//! Commit-targeting operations: cherry-pick, revert, reset.
//!
//! All of these mutate the working tree / HEAD. We return a `CmdOutcome`
//! string the UI can show in a toast.

use git2::{
    build::CheckoutBuilder, CherrypickOptions, MergeOptions, Repository, ResetType, RevertOptions,
};

/// Cherry-pick the given commit onto HEAD. Accepts any committish — annotated
/// tags are peeled to their target commit. May leave conflicts in the index;
/// callers should follow up with the merge view if so.
pub fn cherry_pick(path: &str, oid: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let commit = repo
        .find_object(git2::Oid::from_str(oid)?, None)?
        .peel_to_commit()?;
    let mut opts = CherrypickOptions::new();
    opts.merge_opts(MergeOptions::new());
    repo.cherrypick(&commit, Some(&mut opts))?;
    Ok(())
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
