//! Shared helpers for integration tests.
//!
//! Builds throwaway repositories in temp dirs and lets each test exercise the
//! `git_tools_lib::git` API surface without touching the user's environment.

use std::fs;
use std::path::Path;

use git2::{Repository, Signature};
use tempfile::TempDir;

pub struct TempRepo {
    pub dir: TempDir,
    pub repo: Repository,
}

impl TempRepo {
    /// Create an empty repo in a fresh temp dir.
    pub fn init() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("repo init");

        // Force a deterministic identity for tests so commits don't depend on
        // the developer's git config.
        let mut cfg = repo.config().expect("config");
        cfg.set_str("user.name", "Test User").unwrap();
        cfg.set_str("user.email", "test@example.com").unwrap();
        // Disable autocrlf to avoid OS-dependent diff output on Windows CI.
        cfg.set_str("core.autocrlf", "false").unwrap();

        Self { dir, repo }
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn path_str(&self) -> String {
        self.dir.path().to_string_lossy().to_string()
    }

    /// Write a file (relative to the workdir) with `contents`, then `git add`
    /// + commit it. Returns the new commit oid.
    pub fn commit_file(&self, relpath: &str, contents: &str, message: &str) -> git2::Oid {
        let abs = self.dir.path().join(relpath);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&abs, contents).expect("write file");
        let mut index = self.repo.index().unwrap();
        index.add_path(Path::new(relpath)).unwrap();
        index.write().unwrap();
        self.commit(message)
    }

    /// Stage all tracked-but-modified + untracked files and commit.
    pub fn commit_all(&self, message: &str) -> git2::Oid {
        let mut index = self.repo.index().unwrap();
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        self.commit(message)
    }

    fn commit(&self, message: &str) -> git2::Oid {
        let sig = Signature::now("Test User", "test@example.com").unwrap();
        let mut index = self.repo.index().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = self.repo.find_tree(tree_oid).unwrap();
        let parents: Vec<git2::Commit> = match self.repo.head() {
            Ok(h) => vec![h.peel_to_commit().unwrap()],
            Err(_) => vec![],
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        self.repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .unwrap()
    }

    /// Rename a tracked file in the workdir + index, but don't commit.
    pub fn rename_file(&self, from: &str, to: &str) {
        let abs_from = self.dir.path().join(from);
        let abs_to = self.dir.path().join(to);
        if let Some(parent) = abs_to.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::rename(&abs_from, &abs_to).unwrap();
        let mut index = self.repo.index().unwrap();
        index.remove_path(Path::new(from)).unwrap();
        index.add_path(Path::new(to)).unwrap();
        index.write().unwrap();
    }

    /// Mutate a file's content in the workdir (no staging).
    pub fn write_file(&self, relpath: &str, contents: &str) {
        let abs = self.dir.path().join(relpath);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&abs, contents).unwrap();
    }
}
