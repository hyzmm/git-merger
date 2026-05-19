use super::CommitSummary;
use git2::{Repository, Sort};
use std::collections::HashMap;

pub fn log(path: &str, limit: usize, skip: usize) -> Result<Vec<CommitSummary>, git2::Error> {
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

    let mut out = Vec::with_capacity(limit);
    for (i, oid) in walk.flatten().enumerate() {
        if i < skip {
            continue;
        }
        if out.len() >= limit {
            break;
        }
        let c = repo.find_commit(oid)?;
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
