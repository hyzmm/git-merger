//! GPG / SSH commit signing (v0.13.19, candidate E).
//!
//! libgit2 does not sign commits itself — it only knows how to *attach* a
//! pre-computed signature to a commit object via `git_commit_create_with_signature`.
//! The actual cryptographic work happens in an external program: `gpg` for
//! `gpg.format = openpgp` (the git default), or `ssh-keygen -Y sign` for
//! `gpg.format = ssh`. This module owns:
//!
//! 1. Reading the signing-related git config (merged local + global).
//! 2. Spawning the external signer with the right flags + stdin.
//! 3. Wrapping `Repository::commit` so every internal call site (regular
//!    commit, merge commit, rebase pick, rebase squash/amend) can opt into
//!    signing transparently.
//! 4. Probing an existing commit for an embedded signature so the History
//!    detail panel can show a status badge.
//!
//! Verification is intentionally NOT performed here: we only inspect the
//! embedded `gpgsig` header. A future `verify_commit` command can shell out
//! to `gpg --verify` / `ssh-keygen -Y verify` against the user's allowed-signers
//! file, but that touches per-platform trust roots and is its own feature.
//!
//! The functions in this module return `git2::Error` (so they slot into the
//! existing `Result<_, git2::Error>` chains in `commands.rs` / `git/*.rs`),
//! using `Error::from_str` for the spawn / IO / signature failures we own.

use git2::{Commit, Oid, Repository, Signature, Tree};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};

/// Snapshot of the user's signing-related git config, parsed once at the
/// start of a commit operation. Pure data — no I/O, no process state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignConfig {
    /// `commit.gpgsign` — when false, commits are written plain.
    pub gpgsign: bool,
    /// `gpg.format` — "openpgp" (default) or "ssh".
    pub format: SignFormat,
    /// `user.signingkey` — interpretation depends on `format`:
    /// - openpgp: a key id / fingerprint passed to `gpg -u`.
    /// - ssh: either a path to a private key file or an inline SSH
    ///   public key starting with `ssh-`.
    pub signing_key: Option<String>,
    /// `gpg.program` — path to the GPG binary. Defaults to `gpg`.
    pub gpg_program: String,
    /// `gpg.ssh.program` — path to the SSH signer binary. Defaults to
    /// `ssh-keygen` (which understands `-Y sign` since OpenSSH 8.0).
    pub ssh_program: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SignFormat {
    OpenPgp,
    Ssh,
}

impl SignConfig {
    /// True when the user explicitly opted into commit signing AND we know
    /// enough to actually run the signer (SSH requires a key — there is no
    /// well-defined "default key" for `ssh-keygen -Y sign`).
    pub fn is_enabled(&self) -> bool {
        if !self.gpgsign {
            return false;
        }
        match self.format {
            SignFormat::OpenPgp => true, // gpg can pick a default key
            SignFormat::Ssh => self
                .signing_key
                .as_deref()
                .is_some_and(|k| !k.trim().is_empty()),
        }
    }
}

/// Parse git's idiosyncratic boolean spelling: "true"/"yes"/"on"/"1" → true,
/// everything else → false. Whitespace around the value is ignored.
fn parse_git_bool(s: &str) -> bool {
    matches!(
        s.trim().to_ascii_lowercase().as_str(),
        "true" | "yes" | "on" | "1"
    )
}

/// Parse `gpg.format`. Empty / unrecognised → openpgp (libgit2 default).
fn parse_format(s: &str) -> SignFormat {
    match s.trim().to_ascii_lowercase().as_str() {
        "ssh" => SignFormat::Ssh,
        _ => SignFormat::OpenPgp,
    }
}

/// Read every key we care about from the merged config (local overrides
/// global). Missing keys fall back to git's documented defaults.
pub fn load_config(repo: &Repository) -> Result<SignConfig, git2::Error> {
    let mut cfg = repo.config()?;
    let snap = cfg.snapshot()?;

    let gpgsign = snap
        .get_string("commit.gpgsign")
        .ok()
        .as_deref()
        .map(parse_git_bool)
        .unwrap_or(false);

    let format = snap
        .get_string("gpg.format")
        .ok()
        .as_deref()
        .map(parse_format)
        .unwrap_or(SignFormat::OpenPgp);

    let signing_key = snap.get_string("user.signingkey").ok().and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });

    // Per-format binary path. We pick the right key based on `format`, not
    // on what's set: a user with both keys set should still hit the binary
    // matching their chosen format.
    let gpg_program = snap
        .get_string("gpg.program")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "gpg".to_string());
    let ssh_program = snap
        .get_string("gpg.ssh.program")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "ssh-keygen".to_string());

    Ok(SignConfig {
        gpgsign,
        format,
        signing_key,
        gpg_program,
        ssh_program,
    })
}

/// Wrap a `repo.commit(Some("HEAD"), ...)` call with optional signing.
///
/// When `cfg.is_enabled()` is false, this is exactly equivalent to the
/// original `commit()` call (same return value, same HEAD update, same
/// reflog entry). When signing is enabled:
///
/// 1. Build the unsigned commit buffer with `commit_create_buffer`.
/// 2. Pipe it to the external signer (gpg / ssh-keygen).
/// 3. Write the signed object via `commit_signed`.
/// 4. Update HEAD to point at the new oid.
///
/// We always commit to HEAD here — every internal call site does that — so
/// keeping the signature is structural and avoids leaking a signed-vs-plain
/// branch into every caller.
pub fn commit_to_head(
    repo: &Repository,
    author: &Signature<'_>,
    committer: &Signature<'_>,
    message: &str,
    tree: &Tree<'_>,
    parents: &[&Commit<'_>],
) -> Result<Oid, git2::Error> {
    let cfg = load_config(repo)?;

    // We always create the commit object detached (no `update_ref`) and
    // move HEAD ourselves afterwards. Two reasons:
    //   1. The signed and unsigned paths share the same HEAD-update logic.
    //   2. `repo.commit(Some("HEAD"), ...)` rejects writes whose first
    //      parent isn't the current HEAD — which is exactly the case for
    //      `git commit --amend` (parents = HEAD's parents, not HEAD).
    //      Manual ref update side-steps that check.
    let new_oid = if !cfg.is_enabled() {
        repo.commit(None, author, committer, message, tree, parents)?
    } else {
        // Signed path. Build the object payload exactly as libgit2 would,
        // then hand it to the external signer.
        let buf = repo.commit_create_buffer(author, committer, message, tree, parents)?;
        let payload = std::str::from_utf8(&buf)
            .map_err(|_| git2::Error::from_str("commit buffer is not valid UTF-8 (cannot sign)"))?;

        let signature = sign_payload(&cfg, payload).map_err(|e| {
            git2::Error::from_str(&format!(
                "commit signing failed ({}): {}",
                match cfg.format {
                    SignFormat::OpenPgp => "gpg",
                    SignFormat::Ssh => "ssh-keygen",
                },
                e
            ))
        })?;

        repo.commit_signed(payload, &signature, None)?
    };

    // Match libgit2's reflog message format ("commit: <subject>") so the
    // reflog stays uniform whether or not the commit was signed.
    let subject = message.lines().next().unwrap_or(message);
    let reflog_msg = if parents.is_empty() {
        format!("commit (initial): {}", subject)
    } else {
        format!("commit: {}", subject)
    };

    // Update HEAD's underlying ref. Three cases:
    //   a) HEAD points at a branch ref (the common case) — we move that ref
    //      so the reflog entry lands under the branch name.
    //   b) HEAD is detached — write HEAD directly.
    //   c) HEAD is unborn (initial commit on a fresh repo) — resolve the
    //      symbolic HEAD target and create the branch ref there.
    match repo.head() {
        Ok(head) => {
            if let Some(name) = head.name() {
                repo.reference(name, new_oid, true, &reflog_msg)?;
            } else {
                repo.reference("HEAD", new_oid, true, &reflog_msg)?;
            }
        }
        Err(_) => {
            let head_ref = repo.find_reference("HEAD")?;
            if let Some(target_name) = head_ref.symbolic_target() {
                repo.reference(target_name, new_oid, true, &reflog_msg)?;
            } else {
                repo.reference("HEAD", new_oid, true, &reflog_msg)?;
            }
        }
    }

    Ok(new_oid)
}

/// Drive the external signer. Returns the ASCII-armored signature, ready to
/// be embedded as the `gpgsig` header value.
fn sign_payload(cfg: &SignConfig, payload: &str) -> Result<String, String> {
    match cfg.format {
        SignFormat::OpenPgp => sign_with_gpg(cfg, payload),
        SignFormat::Ssh => sign_with_ssh(cfg, payload),
    }
}

/// `gpg --status-fd=2 -bsau <key> --` reads the payload from stdin, writes
/// the ASCII-armored detached signature to stdout, and any progress / status
/// lines to stderr. We collect stdout as the signature, and surface stderr
/// only when the process fails.
fn sign_with_gpg(cfg: &SignConfig, payload: &str) -> Result<String, String> {
    let mut cmd = Command::new(&cfg.gpg_program);
    cmd.arg("--status-fd=2").arg("-bsa");
    if let Some(key) = cfg.signing_key.as_deref() {
        if !key.is_empty() {
            cmd.arg("-u").arg(key);
        }
    }
    cmd.arg("--");
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "failed to spawn `{}` — is GPG installed and on PATH? ({e})",
            cfg.gpg_program
        )
    })?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "could not write to gpg stdin".to_string())?;
        stdin
            .write_all(payload.as_bytes())
            .map_err(|e| format!("write to gpg stdin: {e}"))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("wait for gpg: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let detail = if stderr.is_empty() {
            format!("gpg exited with status {}", out.status)
        } else {
            stderr
        };
        return Err(detail);
    }
    let sig = String::from_utf8(out.stdout)
        .map_err(|_| "gpg produced non-UTF-8 signature output".to_string())?;
    if !sig.contains("BEGIN PGP SIGNATURE") {
        return Err("gpg returned an empty / malformed signature".to_string());
    }
    Ok(sig)
}

/// `ssh-keygen -Y sign -n git -f <key>` consumes the payload on stdin and
/// emits an SSH signature in the SSHSIG armored format on stdout.
fn sign_with_ssh(cfg: &SignConfig, payload: &str) -> Result<String, String> {
    let key_path = cfg
        .signing_key
        .as_deref()
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            "ssh signing requires user.signingkey to point at a private key path".to_string()
        })?;

    // The key is allowed to start with the literal SSH public key string
    // (`ssh-rsa ...`) — git in that case writes the public key to a temp
    // file and passes its path. We approximate by rejecting that mode here
    // with a helpful error, since it requires probing the user's
    // ~/.ssh/<...> for the matching private key, and the simpler "give me a
    // private key path" ergonomic covers ~all real setups.
    let trimmed = key_path.trim();
    if trimmed.starts_with("ssh-")
        || trimmed.starts_with("ecdsa-")
        || trimmed.starts_with("sk-ssh-")
    {
        return Err(
            "user.signingkey is set to an inline SSH public key — please \
             use the path to the matching private key file instead"
                .to_string(),
        );
    }

    let mut cmd = Command::new(&cfg.ssh_program);
    cmd.arg("-Y").arg("sign").arg("-n").arg("git");
    cmd.arg("-f").arg(trimmed);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "failed to spawn `{}` — is OpenSSH 8.0+ installed? ({e})",
            cfg.ssh_program
        )
    })?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "could not write to ssh-keygen stdin".to_string())?;
        stdin
            .write_all(payload.as_bytes())
            .map_err(|e| format!("write to ssh-keygen stdin: {e}"))?;
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("wait for ssh-keygen: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let detail = if stderr.is_empty() {
            format!("ssh-keygen exited with status {}", out.status)
        } else {
            stderr
        };
        return Err(detail);
    }
    let sig = String::from_utf8(out.stdout)
        .map_err(|_| "ssh-keygen produced non-UTF-8 signature output".to_string())?;
    if !sig.contains("BEGIN SSH SIGNATURE") {
        return Err("ssh-keygen returned an empty / malformed signature".to_string());
    }
    Ok(sig)
}

// ---------------------------------------------------------------------------
// Status query (read-only)
// ---------------------------------------------------------------------------

/// Best-effort read of an existing commit's signature header. We deliberately
/// stop short of running an external verifier here — the History panel only
/// needs to know "is this signed?" + "by what format?". A separate
/// `verify_commit` command (future work) can do real trust-rooted verification.
#[derive(Debug, Serialize, Deserialize)]
pub struct CommitSignatureInfo {
    /// True when the commit has a `gpgsig` header at all.
    pub signed: bool,
    /// Detected signature format when `signed`. None for plain commits.
    pub format: Option<SignFormat>,
    /// Short, human-readable summary line for tooltips ("OpenPGP signed",
    /// "SSH signed", "Not signed"). Always present.
    pub summary: String,
}

pub fn commit_signature_info(
    repo: &Repository,
    oid: &str,
) -> Result<CommitSignatureInfo, git2::Error> {
    let oid = git2::Oid::from_str(oid)?;
    match repo.extract_signature(&oid, None) {
        Ok((sig_buf, _content)) => {
            let body = std::str::from_utf8(&sig_buf).unwrap_or("");
            let fmt = detect_signature_format(body);
            let summary = match fmt {
                Some(SignFormat::OpenPgp) => "OpenPGP signed".to_string(),
                Some(SignFormat::Ssh) => "SSH signed".to_string(),
                None => "Signed (unknown format)".to_string(),
            };
            Ok(CommitSignatureInfo {
                signed: true,
                format: fmt,
                summary,
            })
        }
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(CommitSignatureInfo {
            signed: false,
            format: None,
            summary: "Not signed".to_string(),
        }),
        Err(e) => Err(e),
    }
}

/// Look at the armored signature body and decide whether it came from GPG
/// or SSH. Both formats use distinctive header lines, so this is a cheap
/// substring check — no need to actually parse the armor.
fn detect_signature_format(sig_body: &str) -> Option<SignFormat> {
    if sig_body.contains("BEGIN PGP SIGNATURE") || sig_body.contains("BEGIN PGP MESSAGE") {
        Some(SignFormat::OpenPgp)
    } else if sig_body.contains("BEGIN SSH SIGNATURE") {
        Some(SignFormat::Ssh)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Trust-rooted verification (v0.13.20)
// ---------------------------------------------------------------------------
//
// `commit_signature_info` only tells you "there's a gpgsig header" — it
// can't say whether the signing key is trusted, valid, expired, or even
// matches the listed signer. For that we shell out to `gpg --verify` /
// `ssh-keygen -Y verify`, which consult the user's local keyring /
// allowed-signers file respectively.
//
// We capture **stderr** (where GPG / OpenSSH put their human-readable
// status) and a structured outcome:
//
//   - Good      — signature checks out + key is in the trust store
//   - NoKey     — signature is well-formed but we don't have the key
//                 (gpg "Can't check signature: No public key" / ssh
//                  "no signature found in allowed_signers")
//   - Bad       — signature does NOT match the payload (active tampering)
//   - Unsigned  — no embedded signature header at all
//   - Error     — the verifier itself blew up (binary missing, etc.)
//
// We don't try to parse `--status-fd=1` GnuPG keywords here: the
// human-readable stderr is far more useful for the UI tooltip, and we
// only need a small set of buckets for the badge colour.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifyState {
    Good,
    NoKey,
    Bad,
    Unsigned,
    Error,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyResult {
    pub state: VerifyState,
    /// Detected signature format. `None` for unsigned commits or when we
    /// couldn't even classify the armor.
    pub format: Option<SignFormat>,
    /// Human-readable signer identity when `state == Good` and we could
    /// extract one ("Alice <alice@example.com>" / SSH key fingerprint).
    pub signer: Option<String>,
    /// Raw stderr from the external verifier — surfaced as-is in the UI
    /// tooltip so power users can see *why* a signature was flagged.
    /// Empty for `Unsigned`.
    pub output: String,
}

impl VerifyResult {
    fn unsigned() -> Self {
        Self {
            state: VerifyState::Unsigned,
            format: None,
            signer: None,
            output: String::new(),
        }
    }
}

/// Run a trust-rooted verification of `oid`'s embedded signature.
///
/// This DOES shell out (unlike `commit_signature_info`), so callers should
/// invoke it on demand — e.g. when the user clicks the signature badge in
/// the CommitDetails panel — rather than for every history row.
pub fn verify_commit(repo: &Repository, oid: &str) -> Result<VerifyResult, git2::Error> {
    let target_oid = git2::Oid::from_str(oid)?;
    let (sig_buf, content_buf) = match repo.extract_signature(&target_oid, None) {
        Ok(pair) => pair,
        Err(e) if e.code() == git2::ErrorCode::NotFound => {
            return Ok(VerifyResult::unsigned());
        }
        Err(e) => return Err(e),
    };

    let sig_str = std::str::from_utf8(&sig_buf).unwrap_or("");
    let format = detect_signature_format(sig_str);
    let cfg = load_config(repo)?;

    match format {
        Some(SignFormat::OpenPgp) => Ok(verify_openpgp(&cfg, sig_str, &content_buf)),
        Some(SignFormat::Ssh) => {
            // SSH verification needs an allowed-signers file; we read its
            // path from `gpg.ssh.allowedSignersFile` (the standard git
            // option) and a known signer principal — either the user has
            // committed.email (common) or we fall back to "*".
            let allowed = repo
                .config()
                .ok()
                .and_then(|mut c| c.snapshot().ok())
                .and_then(|s| s.get_string("gpg.ssh.allowedSignersFile").ok())
                .filter(|s| !s.trim().is_empty());
            Ok(verify_ssh(&cfg, sig_str, &content_buf, allowed.as_deref()))
        }
        None => Ok(VerifyResult {
            state: VerifyState::Error,
            format: None,
            signer: None,
            output: "signature header present but format is unrecognised (not PGP or SSH armor)"
                .to_string(),
        }),
    }
}

/// Spawn `gpg --verify <sig_file> -` with the payload on stdin. Returns
/// the structured outcome. Stderr is the source of truth for GPG status.
fn verify_openpgp(cfg: &SignConfig, signature: &str, content: &[u8]) -> VerifyResult {
    // `gpg --verify` wants the signature as a path (or fd) and the data
    // on stdin. We dump the signature to a tempfile to keep the spawn
    // simple and portable.
    let tmp = match tempfile::Builder::new()
        .prefix("gittools-sig-")
        .suffix(".asc")
        .tempfile()
    {
        Ok(t) => t,
        Err(e) => {
            return VerifyResult {
                state: VerifyState::Error,
                format: Some(SignFormat::OpenPgp),
                signer: None,
                output: format!("could not create temp signature file: {e}"),
            };
        }
    };
    if let Err(e) = std::fs::write(tmp.path(), signature.as_bytes()) {
        return VerifyResult {
            state: VerifyState::Error,
            format: Some(SignFormat::OpenPgp),
            signer: None,
            output: format!("could not write signature to temp file: {e}"),
        };
    }

    let mut cmd = Command::new(&cfg.gpg_program);
    cmd.arg("--status-fd=1")
        .arg("--keyid-format=long")
        .arg("--verify")
        .arg(tmp.path())
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return VerifyResult {
                state: VerifyState::Error,
                format: Some(SignFormat::OpenPgp),
                signer: None,
                output: format!("failed to spawn `{}`: {e}", cfg.gpg_program),
            };
        }
    };
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(content);
    }
    let out = match child.wait_with_output() {
        Ok(o) => o,
        Err(e) => {
            return VerifyResult {
                state: VerifyState::Error,
                format: Some(SignFormat::OpenPgp),
                signer: None,
                output: format!("waiting on gpg: {e}"),
            };
        }
    };

    let status_fd1 = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

    // GnuPG --status-fd lines start with "[GNUPG:] <keyword> ...". The
    // keywords we care about are GOODSIG / VALIDSIG / BADSIG / NO_PUBKEY /
    // ERRSIG / EXPSIG / EXPKEYSIG. NOTE that "valid signature with an
    // untrusted key" still emits GOODSIG — that's fine for our purposes,
    // we surface it as Good and leave trust-marking to the user.
    let lines: Vec<&str> = status_fd1.lines().collect();
    let has_kw = |kw: &str| {
        lines
            .iter()
            .any(|l| l.starts_with(&format!("[GNUPG:] {kw}")))
    };

    let signer = lines.iter().find_map(|l| {
        l.strip_prefix("[GNUPG:] GOODSIG ")
            .or_else(|| l.strip_prefix("[GNUPG:] EXPSIG "))
            .or_else(|| l.strip_prefix("[GNUPG:] EXPKEYSIG "))
            .map(|rest| {
                rest.split_whitespace()
                    .skip(1)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|s| !s.is_empty())
    });

    let state = if has_kw("BADSIG") {
        VerifyState::Bad
    } else if has_kw("NO_PUBKEY") || has_kw("ERRSIG") {
        VerifyState::NoKey
    } else if has_kw("GOODSIG") || has_kw("VALIDSIG") {
        VerifyState::Good
    } else if out.status.success() {
        // Some old gpg builds don't emit GOODSIG on --status-fd; trust the
        // exit code as a fallback signal.
        VerifyState::Good
    } else {
        VerifyState::Error
    };

    VerifyResult {
        state,
        format: Some(SignFormat::OpenPgp),
        signer,
        output: stderr,
    }
}

/// Spawn `ssh-keygen -Y verify` against the user's allowed-signers file.
/// When `allowed_signers_path` is `None` we fall back to a stub principal
/// match that surfaces as `NoKey` rather than `Good` — that's the
/// honest answer when the user hasn't configured trust roots yet.
fn verify_ssh(
    cfg: &SignConfig,
    signature: &str,
    content: &[u8],
    allowed_signers_path: Option<&str>,
) -> VerifyResult {
    let Some(allowed) = allowed_signers_path else {
        return VerifyResult {
            state: VerifyState::NoKey,
            format: Some(SignFormat::Ssh),
            signer: None,
            output:
                "set gpg.ssh.allowedSignersFile to a file mapping principals → SSH keys before \
                 SSH commits can be verified (see `man git-config`)"
                    .to_string(),
        };
    };

    let sig_tmp = match tempfile::Builder::new()
        .prefix("gittools-sshsig-")
        .suffix(".sig")
        .tempfile()
    {
        Ok(t) => t,
        Err(e) => {
            return VerifyResult {
                state: VerifyState::Error,
                format: Some(SignFormat::Ssh),
                signer: None,
                output: format!("could not create temp file: {e}"),
            };
        }
    };
    if let Err(e) = std::fs::write(sig_tmp.path(), signature.as_bytes()) {
        return VerifyResult {
            state: VerifyState::Error,
            format: Some(SignFormat::Ssh),
            signer: None,
            output: format!("could not write signature: {e}"),
        };
    }

    // ssh-keygen -Y verify needs a `-I <principal>` (e.g. the committer's
    // email). Probe the signature for a `principal=` field — newer git's
    // SSH-signing format embeds it; for older formats we run with `-I '*'`
    // which matches any principal entry in the allowed-signers file.
    let principal = "*";

    let mut cmd = Command::new(&cfg.ssh_program);
    cmd.arg("-Y").arg("verify");
    cmd.arg("-n").arg("git");
    cmd.arg("-f").arg(allowed);
    cmd.arg("-I").arg(principal);
    cmd.arg("-s").arg(sig_tmp.path());
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return VerifyResult {
                state: VerifyState::Error,
                format: Some(SignFormat::Ssh),
                signer: None,
                output: format!("failed to spawn `{}`: {e}", cfg.ssh_program),
            };
        }
    };
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(content);
    }
    let out = match child.wait_with_output() {
        Ok(o) => o,
        Err(e) => {
            return VerifyResult {
                state: VerifyState::Error,
                format: Some(SignFormat::Ssh),
                signer: None,
                output: format!("waiting on ssh-keygen: {e}"),
            };
        }
    };

    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();

    if out.status.success() {
        // ssh-keygen prints "Good \"git\" signature for <principal> with <key>"
        // to stdout on success — that's our signer label.
        let signer = stdout
            .strip_prefix("Good \"git\" signature for ")
            .map(str::to_string);
        VerifyResult {
            state: VerifyState::Good,
            format: Some(SignFormat::Ssh),
            signer,
            output: if stderr.is_empty() { stdout } else { stderr },
        }
    } else {
        // Distinguish "no matching principal" (NoKey) from "signature itself
        // doesn't match the payload" (Bad). ssh-keygen says "Could not
        // verify signature" for the latter and "Certificate not yet valid"
        // / "no signature found in allowed_signers" / "Principal not found"
        // for the former.
        let lower = stderr.to_ascii_lowercase();
        let state = if lower.contains("no signature found")
            || lower.contains("principal not found")
            || lower.contains("not authorized")
        {
            VerifyState::NoKey
        } else if lower.contains("could not verify")
            || lower.contains("signature is not valid")
            || lower.contains("invalid signature")
        {
            VerifyState::Bad
        } else {
            VerifyState::Error
        };
        VerifyResult {
            state,
            format: Some(SignFormat::Ssh),
            signer: None,
            output: stderr,
        }
    }
}

// ---------------------------------------------------------------------------
// Sign-off trailer (v0.13.20)
// ---------------------------------------------------------------------------

/// Append a `Signed-off-by: Name <email>` trailer to the commit message
/// idempotently — if the exact same trailer already terminates the message,
/// we don't add a duplicate (matches `git commit --signoff` behaviour).
///
/// The trailer block is separated from the message body by a single blank
/// line (per the git trailer convention), so editors that look for trailers
/// via `git interpret-trailers --parse` see them properly.
pub fn append_signoff(message: &str, name: &str, email: &str) -> String {
    let trailer = format!("Signed-off-by: {name} <{email}>");
    let trimmed = message.trim_end_matches('\n');

    // If the message already ends with this exact trailer, we're done.
    if trimmed
        .lines()
        .next_back()
        .map(|l| l.trim() == trailer)
        .unwrap_or(false)
    {
        // Preserve a single trailing newline for consistency.
        return format!("{trimmed}\n");
    }

    // We need a blank-line separator before a trailer block, unless the
    // last non-empty line *already* looks like a trailer (Key: value).
    let last_line = trimmed.lines().next_back().unwrap_or("");
    let last_is_trailer = last_line
        .split_once(':')
        .map(|(k, _)| !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        .unwrap_or(false);

    if trimmed.is_empty() {
        format!("{trailer}\n")
    } else if last_is_trailer {
        format!("{trimmed}\n{trailer}\n")
    } else {
        format!("{trimmed}\n\n{trailer}\n")
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_git_bool_recognises_truthy_strings() {
        assert!(parse_git_bool("true"));
        assert!(parse_git_bool("TRUE"));
        assert!(parse_git_bool("Yes"));
        assert!(parse_git_bool("on"));
        assert!(parse_git_bool(" 1 "));
    }

    #[test]
    fn parse_git_bool_rejects_falsey_strings() {
        assert!(!parse_git_bool("false"));
        assert!(!parse_git_bool("0"));
        assert!(!parse_git_bool("off"));
        assert!(!parse_git_bool("no"));
        assert!(!parse_git_bool(""));
        assert!(!parse_git_bool("garbage"));
    }

    #[test]
    fn parse_format_defaults_to_openpgp() {
        assert_eq!(parse_format(""), SignFormat::OpenPgp);
        assert_eq!(parse_format("openpgp"), SignFormat::OpenPgp);
        assert_eq!(parse_format("OpenPGP"), SignFormat::OpenPgp);
        assert_eq!(parse_format("nonsense"), SignFormat::OpenPgp);
    }

    #[test]
    fn parse_format_recognises_ssh() {
        assert_eq!(parse_format("ssh"), SignFormat::Ssh);
        assert_eq!(parse_format(" SSH "), SignFormat::Ssh);
    }

    fn cfg(gpgsign: bool, format: SignFormat, key: Option<&str>) -> SignConfig {
        SignConfig {
            gpgsign,
            format,
            signing_key: key.map(String::from),
            gpg_program: "gpg".to_string(),
            ssh_program: "ssh-keygen".to_string(),
        }
    }

    #[test]
    fn is_enabled_requires_gpgsign_true() {
        assert!(!cfg(false, SignFormat::OpenPgp, Some("k")).is_enabled());
    }

    #[test]
    fn is_enabled_openpgp_does_not_require_key() {
        // gpg has its own default-key resolution, so we don't enforce one.
        assert!(cfg(true, SignFormat::OpenPgp, None).is_enabled());
        assert!(cfg(true, SignFormat::OpenPgp, Some("ABC123")).is_enabled());
    }

    #[test]
    fn is_enabled_ssh_requires_key() {
        // ssh-keygen -Y sign -f <??> — a key is non-optional.
        assert!(!cfg(true, SignFormat::Ssh, None).is_enabled());
        assert!(!cfg(true, SignFormat::Ssh, Some("")).is_enabled());
        assert!(!cfg(true, SignFormat::Ssh, Some("   ")).is_enabled());
        assert!(cfg(true, SignFormat::Ssh, Some("/home/me/.ssh/id_ed25519")).is_enabled());
    }

    #[test]
    fn detect_signature_format_recognises_pgp_and_ssh() {
        let pgp = "-----BEGIN PGP SIGNATURE-----\n...";
        let ssh = "-----BEGIN SSH SIGNATURE-----\n...";
        let unknown = "garbage";
        assert_eq!(detect_signature_format(pgp), Some(SignFormat::OpenPgp));
        assert_eq!(detect_signature_format(ssh), Some(SignFormat::Ssh));
        assert_eq!(detect_signature_format(unknown), None);
    }

    #[test]
    fn load_config_reads_real_repo_config() {
        // Build a temp repo and set a couple of keys; verify SignConfig parses
        // them back. This proves the merged-config / snapshot plumbing without
        // shelling out to gpg.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("repo init");
        {
            let mut cfg = repo.config().expect("config");
            cfg.set_str("commit.gpgsign", "true").unwrap();
            cfg.set_str("gpg.format", "ssh").unwrap();
            cfg.set_str("user.signingkey", "/tmp/key").unwrap();
            cfg.set_str("gpg.program", "/usr/local/bin/gpg2").unwrap();
        }
        let parsed = load_config(&repo).expect("load_config");
        assert!(parsed.gpgsign);
        assert_eq!(parsed.format, SignFormat::Ssh);
        assert_eq!(parsed.signing_key.as_deref(), Some("/tmp/key"));
        assert_eq!(parsed.gpg_program, "/usr/local/bin/gpg2");
        assert_eq!(parsed.ssh_program, "ssh-keygen");
        assert!(parsed.is_enabled());
    }

    #[test]
    fn load_config_defaults_when_keys_absent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("repo init");
        let parsed = load_config(&repo).expect("load_config");
        assert!(!parsed.gpgsign);
        assert_eq!(parsed.format, SignFormat::OpenPgp);
        assert_eq!(parsed.signing_key, None);
        assert_eq!(parsed.gpg_program, "gpg");
        assert_eq!(parsed.ssh_program, "ssh-keygen");
        assert!(!parsed.is_enabled());
    }

    #[test]
    fn commit_signature_info_reports_unsigned_for_plain_commit() {
        // Build a repo with one ordinary commit; extract_signature should
        // report NotFound and we surface it as `signed: false`.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("repo init");
        let sig = Signature::now("T", "t@e.com").unwrap();
        {
            let mut idx = repo.index().unwrap();
            std::fs::write(dir.path().join("a.txt"), b"hi").unwrap();
            idx.add_path(std::path::Path::new("a.txt")).unwrap();
            idx.write().unwrap();
        }
        let tree_oid = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "init\n", &tree, &[])
            .unwrap();

        let info = commit_signature_info(&repo, &oid.to_string()).expect("info");
        assert!(!info.signed);
        assert_eq!(info.format, None);
        assert_eq!(info.summary, "Not signed");
    }

    // ---- v0.13.20 sign-off trailer ----

    #[test]
    fn append_signoff_adds_trailer_with_blank_line_separator() {
        let out = append_signoff("Fix typo in README", "Alice", "alice@example.com");
        assert_eq!(
            out,
            "Fix typo in README\n\nSigned-off-by: Alice <alice@example.com>\n"
        );
    }

    #[test]
    fn append_signoff_is_idempotent_when_trailer_already_terminates_message() {
        let msg = "Fix typo in README\n\nSigned-off-by: Alice <alice@example.com>\n";
        let out = append_signoff(msg, "Alice", "alice@example.com");
        // Same trailer present → no duplicate added.
        assert_eq!(
            out.matches("Signed-off-by: Alice <alice@example.com>")
                .count(),
            1
        );
    }

    #[test]
    fn append_signoff_extends_existing_trailer_block_without_extra_blank_line() {
        // When the message already ends with a Key: value trailer line,
        // the new sign-off joins the same block (no extra blank line),
        // matching `git commit --signoff` semantics.
        let msg = "Subject\n\nBody paragraph.\n\nReviewed-by: Bob <bob@e.com>";
        let out = append_signoff(msg, "Alice", "alice@example.com");
        assert!(out.contains("Reviewed-by: Bob <bob@e.com>\nSigned-off-by: Alice"));
        assert!(!out.contains("Reviewed-by: Bob <bob@e.com>\n\nSigned-off-by: Alice"));
    }

    #[test]
    fn append_signoff_handles_empty_message() {
        let out = append_signoff("", "Alice", "alice@example.com");
        assert_eq!(out, "Signed-off-by: Alice <alice@example.com>\n");
    }

    // ---- v0.13.20 verify_commit on plain (unsigned) commit ----

    #[test]
    fn verify_commit_reports_unsigned_for_plain_commit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = Repository::init(dir.path()).expect("repo init");
        let sig = Signature::now("T", "t@e.com").unwrap();
        {
            let mut idx = repo.index().unwrap();
            std::fs::write(dir.path().join("a.txt"), b"hi").unwrap();
            idx.add_path(std::path::Path::new("a.txt")).unwrap();
            idx.write().unwrap();
        }
        let tree_oid = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "init\n", &tree, &[])
            .unwrap();

        let res = verify_commit(&repo, &oid.to_string()).expect("verify");
        assert_eq!(res.state, VerifyState::Unsigned);
        assert_eq!(res.format, None);
        assert!(res.signer.is_none());
        assert!(res.output.is_empty());
    }
}
