use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitCmdResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

/// Run `git <args>` inside the repo's workdir. Inherits the user's git
/// configuration, credential helpers, and SSH agent.
pub fn run_git(path: &str, args: &[&str]) -> Result<GitCmdResult, git2::Error> {
    // Resolve the workdir from the repo so we run in the right place.
    let repo = git2::Repository::discover(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| git2::Error::from_str("repository has no workdir"))?;

    let output = Command::new("git")
        .args(args)
        .current_dir(workdir)
        .output()
        .map_err(|e| {
            git2::Error::from_str(&format!(
                "failed to spawn `git` (is it installed and on PATH?): {e}"
            ))
        })?;

    Ok(GitCmdResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        code: output.status.code().unwrap_or(-1),
    })
}

pub fn fetch(path: &str, remote: Option<&str>) -> Result<GitCmdResult, git2::Error> {
    let r = remote.unwrap_or("--all");
    if r == "--all" {
        run_git(path, &["fetch", "--all", "--prune"])
    } else {
        run_git(path, &["fetch", "--prune", r])
    }
}

pub fn pull(path: &str) -> Result<GitCmdResult, git2::Error> {
    run_git(path, &["pull", "--ff-only"])
}

pub fn push(
    path: &str,
    remote: Option<&str>,
    branch: Option<&str>,
    set_upstream: bool,
) -> Result<GitCmdResult, git2::Error> {
    let mut args: Vec<String> = vec!["push".into()];
    if set_upstream {
        args.push("-u".into());
    }
    if let Some(r) = remote {
        args.push(r.into());
        if let Some(b) = branch {
            args.push(b.into());
        }
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git(path, &arg_refs)
}
