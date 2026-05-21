//! `.gitignore` editor backend — read / write the repository's root
//! `.gitignore`, plus a non-destructive `preview` that reports which
//! tracked + untracked working-tree paths a candidate ignore-text would
//! flip relative to the on-disk version.
//!
//! Implementation notes:
//! - We always operate on the repo's root `.gitignore` (the most common
//!   case). Nested `.gitignore` files inside subdirectories still take
//!   effect via libgit2's normal layered match, so the preview reflects
//!   the merged effect.
//! - `preview` opens a fresh `Repository` so the in-memory rule injection
//!   (`add_ignore_rule`) on the candidate text never leaks into the
//!   caller's process state.

use git2::Repository;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// One of the curated starter templates the UI offers.
#[derive(Debug, Serialize, Deserialize)]
pub struct GitignoreTemplate {
    pub id: String,
    pub label: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IgnorePreview {
    /// Total tracked-files scanned.
    pub scanned: usize,
    /// Working-tree paths the candidate text **starts** ignoring (i.e.
    /// not ignored under the current `.gitignore`, but ignored under the
    /// candidate). For tracked files this means git would still track
    /// them (gitignore doesn't untrack) — the UI surfaces them so the
    /// user knows the rule may need a follow-up `git rm --cached`.
    pub newly_ignored: Vec<String>,
    /// Paths that switched from ignored → not ignored.
    pub no_longer_ignored: Vec<String>,
}

const ROOT_FILENAME: &str = ".gitignore";

fn root_gitignore_path(repo_path: &str) -> Result<PathBuf, git2::Error> {
    let repo = Repository::discover(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| git2::Error::from_str("repository has no working directory"))?;
    Ok(workdir.join(ROOT_FILENAME))
}

pub fn read(repo_path: &str) -> Result<String, git2::Error> {
    let p = root_gitignore_path(repo_path)?;
    if !p.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&p).map_err(|e| git2::Error::from_str(&e.to_string()))
}

pub fn write(repo_path: &str, contents: &str) -> Result<(), git2::Error> {
    let p = root_gitignore_path(repo_path)?;

    // Atomic-ish: write to a sibling temp file then rename.
    let tmp = p.with_extension("gitignore.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| git2::Error::from_str(&e.to_string()))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| git2::Error::from_str(&e.to_string()))?;
        f.sync_all()
            .map_err(|e| git2::Error::from_str(&e.to_string()))?;
    }
    fs::rename(&tmp, &p).map_err(|e| git2::Error::from_str(&e.to_string()))?;
    Ok(())
}

/// Compute the diff between current ignore behaviour (as on disk) and
/// the candidate text, without permanently changing the on-disk file.
///
/// Implementation: we briefly rename `<workdir>/.gitignore` to
/// `<workdir>/.gitignore.gittools-tmp` while we evaluate the candidate
/// rules in a fresh `Repository`, then restore it. A `Drop` guard makes
/// the rename always reverse even on panic. The window is single-digit
/// milliseconds and confined to this thread.
pub fn preview(repo_path: &str, candidate: &str) -> Result<IgnorePreview, git2::Error> {
    // 1) Snapshot current ignore state for every path.
    let repo_now = Repository::discover(repo_path)?;
    let mut paths: Vec<String> = Vec::new();
    {
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true)
            .include_ignored(true)
            .recurse_untracked_dirs(true);
        let statuses = repo_now.statuses(Some(&mut opts))?;
        for entry in statuses.iter() {
            if let Some(p) = entry.path() {
                paths.push(p.to_string());
            }
        }
    }
    paths.sort();
    paths.dedup();
    let scanned = paths.len();

    let mut current_state: Vec<bool> = Vec::with_capacity(scanned);
    for p in &paths {
        current_state.push(repo_now.is_path_ignored(p).unwrap_or(false));
    }
    let workdir = repo_now
        .workdir()
        .ok_or_else(|| git2::Error::from_str("repository has no working directory"))?
        .to_path_buf();
    drop(repo_now);

    // 2) Briefly relocate the on-disk .gitignore so the candidate text
    //    becomes the sole source of root rules. Nested .gitignore files
    //    inside subdirectories are intentionally left in place so the
    //    preview reflects their layered effect.
    let real_path = workdir.join(ROOT_FILENAME);
    let bak_path = workdir.join(".gitignore.gittools-preview-bak");
    let _guard = if real_path.exists() {
        fs::rename(&real_path, &bak_path).map_err(|e| git2::Error::from_str(&e.to_string()))?;
        Some(RestoreGuard {
            from: bak_path.clone(),
            to: real_path.clone(),
        })
    } else {
        None
    };

    // 3) Open a *fresh* Repository so libgit2's per-handle ignore cache
    //    is rebuilt against the now-missing root file, then inject the
    //    candidate as in-memory rules.
    let repo_cand = Repository::discover(repo_path)?;
    repo_cand.clear_ignore_rules()?;
    if !candidate.is_empty() {
        repo_cand.add_ignore_rule(candidate)?;
    }

    let mut newly_ignored = Vec::new();
    let mut no_longer_ignored = Vec::new();
    for (i, p) in paths.iter().enumerate() {
        let cand = repo_cand.is_path_ignored(p).unwrap_or(false);
        let cur = current_state[i];
        match (cur, cand) {
            (false, true) => newly_ignored.push(p.clone()),
            (true, false) => no_longer_ignored.push(p.clone()),
            _ => {}
        }
    }

    // Cap the lists so the UI doesn't drown on huge repos.
    const CAP: usize = 200;
    if newly_ignored.len() > CAP {
        newly_ignored.truncate(CAP);
    }
    if no_longer_ignored.len() > CAP {
        no_longer_ignored.truncate(CAP);
    }

    // _guard runs here, putting .gitignore back exactly where it was.
    Ok(IgnorePreview {
        scanned,
        newly_ignored,
        no_longer_ignored,
    })
}

struct RestoreGuard {
    from: PathBuf,
    to: PathBuf,
}

impl Drop for RestoreGuard {
    fn drop(&mut self) {
        // Best-effort restore. If this fails the user will see a stray
        // `.gitignore.gittools-preview-bak` next to their .gitignore;
        // that's recoverable manually and far better than crashing.
        let _ = fs::rename(&self.from, &self.to);
    }
}

/// Curated starter templates. Kept short on purpose — users can paste
/// from gitignore.io / GitHub's gitignore repo if they want more.
pub fn templates() -> Vec<GitignoreTemplate> {
    vec![
        GitignoreTemplate {
            id: "node".into(),
            label: "Node.js".into(),
            content: concat!(
                "# Node\n",
                "node_modules/\n",
                "npm-debug.log*\n",
                "yarn-debug.log*\n",
                "yarn-error.log*\n",
                "pnpm-debug.log*\n",
                ".pnpm-store/\n",
                "dist/\n",
                "build/\n",
                ".next/\n",
                ".nuxt/\n",
                ".turbo/\n",
                ".env\n",
                ".env.local\n",
                ".env.*.local\n",
            )
            .into(),
        },
        GitignoreTemplate {
            id: "rust".into(),
            label: "Rust".into(),
            content: concat!(
                "# Rust\n",
                "/target/\n",
                "**/*.rs.bk\n",
                "Cargo.lock\n",
                "*.pdb\n",
            )
            .into(),
        },
        GitignoreTemplate {
            id: "python".into(),
            label: "Python".into(),
            content: concat!(
                "# Python\n",
                "__pycache__/\n",
                "*.py[cod]\n",
                "*$py.class\n",
                "*.so\n",
                ".Python\n",
                "build/\n",
                "develop-eggs/\n",
                "dist/\n",
                "*.egg-info/\n",
                ".venv/\n",
                "venv/\n",
                ".pytest_cache/\n",
                ".mypy_cache/\n",
                ".ruff_cache/\n",
            )
            .into(),
        },
        GitignoreTemplate {
            id: "go".into(),
            label: "Go".into(),
            content: concat!(
                "# Go\n",
                "*.exe\n",
                "*.exe~\n",
                "*.dll\n",
                "*.so\n",
                "*.dylib\n",
                "*.test\n",
                "*.out\n",
                "go.work\n",
                "vendor/\n",
            )
            .into(),
        },
        GitignoreTemplate {
            id: "macos".into(),
            label: "macOS".into(),
            content: concat!(
                "# macOS\n",
                ".DS_Store\n",
                ".AppleDouble\n",
                ".LSOverride\n",
                "Icon\n",
                "._*\n",
                ".Spotlight-V100\n",
                ".Trashes\n",
            )
            .into(),
        },
        GitignoreTemplate {
            id: "windows".into(),
            label: "Windows".into(),
            content: concat!(
                "# Windows\n",
                "Thumbs.db\n",
                "ehthumbs.db\n",
                "Desktop.ini\n",
                "$RECYCLE.BIN/\n",
                "*.lnk\n",
            )
            .into(),
        },
        GitignoreTemplate {
            id: "jetbrains".into(),
            label: "JetBrains IDEs".into(),
            content: concat!(
                "# JetBrains\n",
                ".idea/\n",
                "*.iml\n",
                "*.ipr\n",
                "*.iws\n",
                "out/\n",
            )
            .into(),
        },
        GitignoreTemplate {
            id: "vscode".into(),
            label: "VS Code".into(),
            content: concat!(
                "# VS Code\n",
                ".vscode/*\n",
                "!.vscode/settings.json\n",
                "!.vscode/tasks.json\n",
                "!.vscode/launch.json\n",
                "!.vscode/extensions.json\n",
            )
            .into(),
        },
    ]
}
