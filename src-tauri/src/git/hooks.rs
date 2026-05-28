//! Git hook execution (v0.13.20).
//!
//! libgit2 — and therefore `Repository::commit` — does **not** invoke any of
//! the hook scripts under `.git/hooks/`. That's a deliberate design choice
//! (libgit2 is a library, not a porcelain), but it means the user's
//! lint-staged / commitizen / commit-msg-validator stack would silently
//! fail to run if we just called `repo.commit(...)` and called it a day.
//!
//! This module bridges the gap: before / after the user's commit we shell
//! out to the matching hook (if it exists, is executable, and the user
//! hasn't disabled hook execution in Settings), and surface the hook's
//! exit code as a `HookFailed` error so the UI can refuse to commit when
//! e.g. `pre-commit` fails.
//!
//! ### Hook resolution
//!
//! Honours `core.hooksPath` (added in git 2.9), falling back to
//! `<repo>/.git/hooks/<name>`. Relative paths are resolved against the
//! repo's working directory, matching upstream git's behaviour.
//!
//! ### Executability
//!
//! On Unix we check the file's execute bit; on Windows there *is* no execute
//! bit, so we treat any file with a recognised extension (`.bat` / `.cmd` /
//! `.ps1` / `.exe`) OR a shebang as runnable, and otherwise spawn it via
//! the system shell as a best-effort. Hooks shipped by tools like husky
//! always include a `#!/usr/bin/env sh` line, which Windows git for-windows
//! handles via its bundled bash; we follow the same convention.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use git2::Repository;

/// Names of hooks we actually invoke during the commit flow. Other hooks
/// (pre-receive, post-receive, …) live on the server side and aren't our
/// concern.
#[derive(Debug, Clone, Copy)]
pub enum CommitHook {
    PreCommit,
    CommitMsg,
    PostCommit,
}

impl CommitHook {
    fn name(self) -> &'static str {
        match self {
            CommitHook::PreCommit => "pre-commit",
            CommitHook::CommitMsg => "commit-msg",
            CommitHook::PostCommit => "post-commit",
        }
    }
}

/// Outcome of trying to run a hook. We distinguish "hook didn't exist"
/// (a no-op success) from "hook exited non-zero" (which must abort the
/// commit) so the caller can react appropriately.
#[derive(Debug)]
pub enum HookOutcome {
    /// Hook file isn't present, or hooks are globally disabled.
    Skipped,
    /// Hook ran and exited 0.
    Ok,
    /// Hook ran and exited non-zero — caller should abort.
    Failed { exit_code: i32, stderr: String },
}

/// Resolve the directory git would look in for hooks. Honours
/// `core.hooksPath` (absolute or repo-relative).
pub fn hooks_dir(repo: &Repository) -> Option<PathBuf> {
    let cfg = repo.config().ok()?.snapshot().ok()?;
    if let Ok(p) = cfg.get_string("core.hooksPath") {
        if !p.trim().is_empty() {
            let candidate = PathBuf::from(&p);
            if candidate.is_absolute() {
                return Some(candidate);
            }
            if let Some(workdir) = repo.workdir() {
                return Some(workdir.join(p));
            }
        }
    }
    Some(repo.path().join("hooks"))
}

/// Resolve the absolute path to a specific commit hook file, or `None`
/// when the file doesn't exist on disk.
pub fn hook_path(repo: &Repository, hook: CommitHook) -> Option<PathBuf> {
    let dir = hooks_dir(repo)?;
    let p = dir.join(hook.name());
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// True when the OS will actually let us run this file directly. On Unix
/// this means the user-execute bit is set; on Windows it means the file
/// has a runnable extension or a shebang line.
fn is_runnable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            return meta.permissions().mode() & 0o111 != 0;
        }
        false
    }
    #[cfg(not(unix))]
    {
        // Recognised extensions: native Windows executable formats.
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let lower = ext.to_ascii_lowercase();
            if matches!(lower.as_str(), "exe" | "bat" | "cmd" | "ps1") {
                return true;
            }
        }
        // Otherwise check for a shebang — git-for-windows ships bash and
        // this is how husky / pre-commit / lint-staged hooks expect to run.
        if let Ok(bytes) = std::fs::read(path) {
            return bytes.starts_with(b"#!");
        }
        false
    }
}

/// Run `pre-commit`. The hook receives no arguments and no stdin; a
/// non-zero exit code aborts the commit.
pub fn run_pre_commit(repo: &Repository) -> HookOutcome {
    run(repo, CommitHook::PreCommit, &[], None)
}

/// Run `commit-msg <path-to-message>`. The hook is allowed to rewrite the
/// file in place — git would honour the rewrite, and so do we. The actual
/// re-read happens in the caller (workspace.rs) after `Ok` is returned.
pub fn run_commit_msg(repo: &Repository, msg_path: &Path) -> HookOutcome {
    run(
        repo,
        CommitHook::CommitMsg,
        &[msg_path.to_string_lossy().to_string()],
        None,
    )
}

/// Run `post-commit`. Failures here are NON-fatal — git itself only logs a
/// warning; we propagate that policy by ignoring the exit code at the
/// caller, but keep the structured outcome here for observability.
pub fn run_post_commit(repo: &Repository) -> HookOutcome {
    run(repo, CommitHook::PostCommit, &[], None)
}

fn run(
    repo: &Repository,
    hook: CommitHook,
    args: &[String],
    stdin_bytes: Option<&[u8]>,
) -> HookOutcome {
    let Some(path) = hook_path(repo, hook) else {
        return HookOutcome::Skipped;
    };
    if !is_runnable(&path) {
        // Mirror git: an unrunnable hook is treated as "not configured".
        return HookOutcome::Skipped;
    }

    let workdir = repo.workdir().unwrap_or_else(|| repo.path());

    let mut cmd = build_command(&path);
    cmd.args(args);
    cmd.current_dir(workdir);
    // Set GIT_DIR so child tools that re-run libgit2 / git CLI find the
    // repo even when the hook runs outside the workdir. Hooks rely on this.
    cmd.env("GIT_DIR", repo.path());
    cmd.stdin(if stdin_bytes.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return HookOutcome::Failed {
                exit_code: -1,
                stderr: format!("failed to spawn {}: {e}", hook.name()),
            };
        }
    };

    if let (Some(bytes), Some(stdin)) = (stdin_bytes, child.stdin.as_mut()) {
        let _ = stdin.write_all(bytes);
    }

    let output = match child.wait_with_output() {
        Ok(o) => o,
        Err(e) => {
            return HookOutcome::Failed {
                exit_code: -1,
                stderr: format!("waiting on {}: {e}", hook.name()),
            };
        }
    };

    if output.status.success() {
        HookOutcome::Ok
    } else {
        // Surface BOTH stderr and stdout — many hook tools (husky, lefthook)
        // print to stdout, and the user wants every hint of what failed.
        let mut combined = String::new();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stdout.trim().is_empty() {
            combined.push_str(stdout.trim());
        }
        if !stderr.trim().is_empty() {
            if !combined.is_empty() {
                combined.push('\n');
            }
            combined.push_str(stderr.trim());
        }
        if combined.is_empty() {
            combined = format!("{} exited with status {}", hook.name(), output.status);
        }
        HookOutcome::Failed {
            exit_code: output.status.code().unwrap_or(-1),
            stderr: combined,
        }
    }
}

#[cfg(unix)]
fn build_command(path: &Path) -> Command {
    Command::new(path)
}

#[cfg(not(unix))]
fn build_command(path: &Path) -> Command {
    // On Windows, scripts without a `.exe`/`.bat` extension can't be
    // launched via `CreateProcess` directly — but they ALMOST always carry
    // a `#!/usr/bin/env sh` shebang because they were written by husky /
    // pre-commit / lefthook / lint-staged. Dispatch to `sh.exe` (bundled
    // by git-for-windows / WSL / msys) so those run unchanged.
    let ext_runnable = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let l = e.to_ascii_lowercase();
            matches!(l.as_str(), "exe" | "bat" | "cmd")
        })
        .unwrap_or(false);
    if ext_runnable {
        return Command::new(path);
    }
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("ps1"))
        .unwrap_or(false)
    {
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
        cmd.arg(path);
        return cmd;
    }
    // Shebang-style: hand off to sh.
    let mut cmd = Command::new("sh");
    cmd.arg(path);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hooks_dir_falls_back_to_dot_git_hooks() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("init");
        let h = hooks_dir(&repo).expect("hooks dir");
        // Default is <repo>/.git/hooks
        assert!(h.ends_with("hooks"));
        assert!(h.parent().unwrap().ends_with(".git"));
    }

    #[test]
    fn hooks_dir_honours_core_hookspath_absolute() {
        let dir = tempfile::tempdir().expect("tempdir");
        let elsewhere = tempfile::tempdir().expect("elsewhere");
        let repo = Repository::init(dir.path()).expect("init");
        repo.config()
            .unwrap()
            .set_str(
                "core.hooksPath",
                elsewhere.path().to_string_lossy().as_ref(),
            )
            .unwrap();
        let h = hooks_dir(&repo).expect("hooks dir");
        // Canonicalise both sides — Windows tempdirs come back without the
        // \\?\ prefix from one path source and with it from the other,
        // which trips a plain == comparison.
        let got = std::fs::canonicalize(&h).unwrap_or(h);
        let want = std::fs::canonicalize(elsewhere.path())
            .unwrap_or_else(|_| elsewhere.path().to_path_buf());
        assert_eq!(got, want);
    }

    #[test]
    fn hook_path_returns_none_when_file_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("init");
        assert!(hook_path(&repo, CommitHook::PreCommit).is_none());
    }

    #[test]
    fn hook_path_finds_existing_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("init");
        // Default hooks dir = .git/hooks (always created by Repository::init)
        let h = hooks_dir(&repo).unwrap();
        std::fs::create_dir_all(&h).unwrap();
        std::fs::write(h.join("pre-commit"), b"#!/bin/sh\nexit 0\n").unwrap();
        let p = hook_path(&repo, CommitHook::PreCommit).expect("found");
        assert!(p.ends_with("pre-commit"));
    }
}
