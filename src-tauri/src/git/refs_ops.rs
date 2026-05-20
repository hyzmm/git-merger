//! Branch & tag mutating operations.

use git2::{BranchType, Repository};

/// Create a local branch pointing at `start_point` (any committish).
/// `start_point` may be a SHA, branch name, or tag name. If `checkout` is
/// true, also switch HEAD + working tree to the new branch.
pub fn create_branch(
    path: &str,
    name: &str,
    start_point: &str,
    checkout: bool,
) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let obj = repo.revparse_single(start_point)?;
    let commit = obj.peel_to_commit()?;
    repo.branch(name, &commit, false)?;
    if checkout {
        checkout_branch_inner(&repo, name)?;
    }
    Ok(())
}

/// Switch HEAD + working tree to an existing local branch.
pub fn checkout_branch(path: &str, name: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    checkout_branch_inner(&repo, name)
}

fn checkout_branch_inner(repo: &Repository, name: &str) -> Result<(), git2::Error> {
    let refname = format!("refs/heads/{}", name);
    let obj = repo.revparse_single(&refname)?;
    repo.checkout_tree(&obj, None)?;
    repo.set_head(&refname)?;
    Ok(())
}

/// Detach HEAD onto an arbitrary commit (`git checkout <sha>`).
pub fn checkout_commit(path: &str, oid: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let obj = repo.revparse_single(oid)?;
    let commit = obj.peel_to_commit()?;
    repo.checkout_tree(commit.as_object(), None)?;
    repo.set_head_detached(commit.id())?;
    Ok(())
}

/// Delete a local branch. Refuses to delete the currently checked-out branch.
pub fn delete_branch(path: &str, name: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let mut branch = repo.find_branch(name, BranchType::Local)?;
    if branch.is_head() {
        return Err(git2::Error::from_str(
            "Cannot delete the branch that is currently checked out.",
        ));
    }
    branch.delete()
}

/// Rename a local branch.
pub fn rename_branch(path: &str, old_name: &str, new_name: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let mut branch = repo.find_branch(old_name, BranchType::Local)?;
    branch.rename(new_name, false)?;
    Ok(())
}

/// Create a (lightweight by default, annotated if `message` provided) tag at
/// `target` (any committish: SHA, branch, etc.).
pub fn create_tag(
    path: &str,
    name: &str,
    target: &str,
    message: Option<&str>,
) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    let obj = repo.revparse_single(target)?;
    if let Some(msg) = message.filter(|m| !m.is_empty()) {
        let sig = repo.signature()?;
        repo.tag(name, &obj, &sig, msg, false)?;
    } else {
        repo.tag_lightweight(name, &obj, false)?;
    }
    Ok(())
}

/// Delete a tag by short name (without "refs/tags/" prefix).
pub fn delete_tag(path: &str, name: &str) -> Result<(), git2::Error> {
    let repo = Repository::discover(path)?;
    repo.tag_delete(name)
}
