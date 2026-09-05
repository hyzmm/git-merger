//! Minimal `git` CLI runner (v0.13.35).
//!
//! The Changes-panel backend (workspace status / staging / commit / patch
//! apply) shells out to the user's installed `git` binary instead of going
//! through libgit2, so the app behaves exactly like the terminal the user
//! is used to: hooks run, filters (`clean` / `smudge`, autocrlf, LFS) apply,
//! and `core.hooksPath` / `commit.gpgsign` are honoured natively.
//!
//! Everything here runs with `git -C <path>`, which discovers the enclosing
//! repository by walking up from `<path>` — the same semantics libgit2's
//! `Repository::discover` had.

use std::fmt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

/// Error type for the CLI-backed git layer. `crate::error::AppError`
/// implements `From<GitError>` so commands can keep using `?` unchanged.
#[derive(Debug)]
pub struct GitError {
    pub message: String,
}

impl GitError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// Accessor mirroring `git2::Error::message` — keeps existing call
    /// sites / tests that used the old libgit2 error API compiling.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Build from a failed `Command::output()` — the stderr text is git's
    /// own human-readable error (e.g. `fatal: pathspec 'x' did not match …`).
    fn from_output(args: &[String], out: &Output) -> Self {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stderr = stderr.trim();
        if !stderr.is_empty() {
            Self::new(stderr.to_string())
        } else {
            Self::new(format!(
                "git {} exited with status {}",
                args.join(" "),
                out.status
            ))
        }
    }
}

impl fmt::Display for GitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for GitError {}

fn exec(path: &str, args: &[String], stdin_bytes: Option<&[u8]>) -> Result<Output, GitError> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path).args(args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin_bytes.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| GitError::new(format!("failed to spawn git: {e}")))?;

    use std::io::Write;
    if let Some(bytes) = stdin_bytes {
        if let Some(mut stdin) = child.stdin.take() {
            // Broken pipe here just means git already exited (its stderr
            // carries the real reason) — don't mask that with a write error.
            let _ = stdin.write_all(bytes);
        }
    }

    child
        .wait_with_output()
        .map_err(|e| GitError::new(format!("waiting on git: {e}")))
}

/// Run `git -C <path> <args>` and require a zero exit code.
pub fn run(path: &str, args: &[String]) -> Result<Output, GitError> {
    let out = exec(path, args, None)?;
    if out.status.success() {
        Ok(out)
    } else {
        Err(GitError::from_output(args, &out))
    }
}

/// Run `git -C <path> <args>` and return the output regardless of the exit
/// code. For probes (`ls-files --error-unmatch`, `cat-file -t`, …) where a
/// non-zero exit *is* the answer, not an error.
pub fn run_status(path: &str, args: &[String]) -> Result<Output, GitError> {
    exec(path, args, None)
}

/// Like [`run`], but exit codes 0 **and** 1 are both success. `git diff`
/// exits 1 whenever differences were found, which is a normal result for us.
pub fn run_diff(path: &str, args: &[String]) -> Result<Output, GitError> {
    let out = exec(path, args, None)?;
    match out.status.code() {
        Some(0) | Some(1) => Ok(out),
        _ => Err(GitError::from_output(args, &out)),
    }
}

/// Like [`run`], but feeds `stdin_bytes` to the child (for `git apply`).
pub fn run_in(path: &str, args: &[String], stdin_bytes: &[u8]) -> Result<Output, GitError> {
    let out = exec(path, args, Some(stdin_bytes))?;
    if out.status.success() {
        Ok(out)
    } else {
        Err(GitError::from_output(args, &out))
    }
}

/// Run a command and return its stdout as lossy UTF-8 (trailing newline kept).
pub fn stdout_utf8(path: &str, args: &[String]) -> Result<String, GitError> {
    let out = run(path, args)?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Absolute path of the repository's working directory
/// (`git rev-parse --show-toplevel`).
pub fn workdir(path: &str) -> Result<PathBuf, GitError> {
    let out = run(path, &[s("rev-parse"), s("--show-toplevel")])?;
    let raw = String::from_utf8_lossy(&out.stdout);
    Ok(PathBuf::from(raw.trim()))
}

/// Wrap a path in `:(literal)` pathspec magic so `*`, `?`, `[`, `:` etc. in
/// file names can never be interpreted as wildcards by git.
pub fn literal(path: &str) -> String {
    format!(":(literal){path}")
}

/// Split NUL-separated path output (`-z`) into an owned set.
pub fn nul_set(bytes: &[u8]) -> std::collections::HashSet<String> {
    bytes
        .split(|&b| b == 0)
        .filter(|t| !t.is_empty())
        .map(|t| String::from_utf8_lossy(t).into_owned())
        .collect()
}

/// Small helper so call sites can build `Vec<String>` args tersely.
pub fn s(v: &str) -> String {
    v.to_string()
}
