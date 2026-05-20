use super::CommitSummary;
use git2::{DiffOptions, Repository, Sort};
use std::collections::HashMap;

pub fn log(
    path: &str,
    limit: usize,
    skip: usize,
    pathspec: Option<&str>,
) -> Result<Vec<CommitSummary>, git2::Error> {
    let repo = Repository::discover(path)?;

    // Build map oid -> Vec<refname>
    let mut refmap: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    for r in repo.references()?.flatten() {
        if let Some(target) = r.target() {
            let name = r.shorthand().unwrap_or("").to_string();
            if !name.is_empty() {
                refmap.entry(target).or_default().push(name);
            }
        }
    }

    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
    if walk.push_head().is_err() {
        return Ok(Vec::new()); // empty repo
    }

    // When a pathspec is provided, only keep commits that touch that path
    // (mirrors `git log -- <path>`). For the root commit (no parents), we
    // include it if its tree contains the path.
    let path_filter = pathspec.filter(|p| !p.is_empty());

    let mut seen: usize = 0;
    let mut out = Vec::with_capacity(limit);
    for oid in walk.flatten() {
        let c = repo.find_commit(oid)?;
        if let Some(spec) = path_filter {
            let touched = commit_touches_path(&repo, &c, spec).unwrap_or(false);
            if !touched {
                continue;
            }
        }
        if seen < skip {
            seen += 1;
            continue;
        }
        if out.len() >= limit {
            break;
        }

        let parents: Vec<String> = c.parent_ids().map(|p| p.to_string()).collect();
        let author = c.author();
        out.push(CommitSummary {
            oid: oid.to_string(),
            short_oid: oid.to_string().chars().take(7).collect(),
            summary: c.summary().unwrap_or("").to_string(),
            author_name: author.name().unwrap_or("").to_string(),
            author_email: author.email().unwrap_or("").to_string(),
            time: c.time().seconds(),
            parents,
            refs: refmap.get(&oid).cloned().unwrap_or_default(),
        });
    }

    Ok(out)
}

fn commit_touches_path(
    repo: &Repository,
    commit: &git2::Commit<'_>,
    spec: &str,
) -> Result<bool, git2::Error> {
    let new_tree = commit.tree()?;
    if commit.parent_count() == 0 {
        // Root commit — match if the file/dir exists in this tree.
        return Ok(new_tree.get_path(std::path::Path::new(spec)).is_ok());
    }
    let mut opts = DiffOptions::new();
    opts.pathspec(spec);
    for i in 0..commit.parent_count() {
        let parent = commit.parent(i)?;
        let parent_tree = parent.tree()?;
        let diff = repo.diff_tree_to_tree(Some(&parent_tree), Some(&new_tree), Some(&mut opts))?;
        if diff.deltas().count() > 0 {
            return Ok(true);
        }
    }
    Ok(false)
}
