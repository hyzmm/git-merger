//! Native fetch / pull / push via git2-rs.
//!
//! Credentials are resolved in this order, falling back on each failure:
//!   1. SSH agent (when the URL is SSH)
//!   2. `~/.ssh/id_*` keys (when the URL is SSH)
//!   3. The user's git credential helper (HTTPS)
//!   4. An interactive prompt forwarded to the frontend via Tauri events
//!
//! Progress (objects received / bytes / push status) is forwarded to the
//! frontend on `git://progress`, so the Topbar can show a live indicator.

use git2::build::CheckoutBuilder;
use git2::{
    AnnotatedCommit, AutotagOption, Cred, CredentialType, FetchOptions, MergeAnalysis, PushOptions,
    RemoteCallbacks, Repository,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Result of a high-level remote operation surfaced to the UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteOpResult {
    pub success: bool,
    /// Short human-readable summary (e.g. "fast-forwarded 3 commits", "everything up-to-date").
    pub message: String,
    /// Optional details per remote/branch (push response, fetch refs).
    pub details: Vec<String>,
}

impl RemoteOpResult {
    fn ok(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
            details: vec![],
        }
    }
    fn ok_with(message: impl Into<String>, details: Vec<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
            details,
        }
    }
}

/// Which high-level remote action a progress stream belongs to.
#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteOpKind {
    Fetch,
    Pull,
    Push,
}

/// Progress event payload broadcast to the frontend.
///
/// `op_id` lets the frontend disambiguate concurrent (or rapidly successive)
/// operations and tie a progress / done / cancelled event back to the
/// original `Started` it issued.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum ProgressEvent {
    /// A new remote op is about to begin. Always emitted exactly once per
    /// `fetch`/`pull`/`push` call, before any other event in the stream.
    Started { op_id: u64, op: RemoteOpKind },
    /// Negotiating with the remote / resolving deltas.
    Sideband { op_id: u64, message: String },
    /// Receiving objects (fetch).
    Receiving {
        op_id: u64,
        received: usize,
        total: usize,
        bytes: usize,
    },
    /// Indexing local objects (after receive).
    Indexing {
        op_id: u64,
        indexed: usize,
        total: usize,
    },
    /// Pushing objects.
    Pushing {
        op_id: u64,
        pushed: usize,
        total: usize,
    },
    /// Per-ref push response. status is None on success, Some(reason) on failure.
    PushStatus {
        op_id: u64,
        refname: String,
        status: Option<String>,
    },
    /// Operation finished (success or failure).
    Done {
        op_id: u64,
        ok: bool,
        summary: String,
    },
    /// User cancelled the operation via `cancel_remote_op`.
    Cancelled { op_id: u64 },
}

// ---------------------------------------------------------------------------
// Credential prompt bridge
// ---------------------------------------------------------------------------
//
// libgit2's credential callback is synchronous. We "block" inside it on a
// `Condvar` while a Tauri event asks the user, and the frontend later calls
// `submit_credentials` (or `cancel_credentials`) which signals the condvar.

#[derive(Debug, Clone, Serialize)]
pub struct CredRequest {
    pub id: u64,
    pub url: String,
    pub username_hint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CredReply {
    pub username: String,
    pub password: String,
}

struct PendingCred {
    reply: Option<CredReply>,
    cancelled: bool,
}

type PendingSlot = Arc<(Mutex<PendingCred>, Condvar)>;
type PendingMap = Mutex<HashMap<u64, PendingSlot>>;

static PENDING: OnceLock<PendingMap> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn pending() -> &'static PendingMap {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Called from the credentials callback to ask the UI for a username/password.
/// Blocks the calling thread until the user replies or cancels (or 2 minutes pass).
fn prompt_user(app: &AppHandle, url: &str, username_hint: Option<&str>) -> Option<CredReply> {
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let slot: PendingSlot = Arc::new((
        Mutex::new(PendingCred {
            reply: None,
            cancelled: false,
        }),
        Condvar::new(),
    ));
    pending().lock().unwrap().insert(id, slot.clone());

    let _ = app.emit(
        "git://credentials-needed",
        CredRequest {
            id,
            url: url.to_string(),
            username_hint: username_hint.map(|s| s.to_string()),
        },
    );

    let (lock, cvar) = &*slot;
    let mut guard = lock.lock().unwrap();
    let timeout = Duration::from_secs(120);
    let (g, _) = cvar
        .wait_timeout_while(guard, timeout, |s| s.reply.is_none() && !s.cancelled)
        .unwrap();
    guard = g;

    pending().lock().unwrap().remove(&id);

    if guard.cancelled {
        None
    } else {
        guard.reply.take()
    }
}

/// Frontend → backend: deliver the user's reply.
pub fn submit_credentials(id: u64, reply: CredReply) {
    if let Some(slot) = pending().lock().unwrap().get(&id).cloned() {
        let (lock, cvar) = &*slot;
        let mut s = lock.lock().unwrap();
        s.reply = Some(reply);
        cvar.notify_all();
    }
}

/// Frontend → backend: user cancelled the prompt.
pub fn cancel_credentials(id: u64) {
    if let Some(slot) = pending().lock().unwrap().get(&id).cloned() {
        let (lock, cvar) = &*slot;
        let mut s = lock.lock().unwrap();
        s.cancelled = true;
        cvar.notify_all();
    }
}

// ---------------------------------------------------------------------------
// Cancel-token registry for in-flight remote ops
// ---------------------------------------------------------------------------
//
// Every `fetch` / `pull` / `push` call allocates a fresh u64 op_id and
// inserts an `Arc<AtomicBool>` into `CANCEL_TOKENS`. The remote callbacks
// (transfer / sideband / push) check the token; once it's been set to
// true via `cancel_remote_op`, they return `false` so libgit2 aborts the
// operation, which surfaces to the caller as a `git2::Error` we then
// classify as `UserCancelled`.

static CANCEL_TOKENS: OnceLock<Mutex<HashMap<u64, Arc<AtomicBool>>>> = OnceLock::new();
static NEXT_OP_ID: AtomicU64 = AtomicU64::new(1);

fn cancel_tokens() -> &'static Mutex<HashMap<u64, Arc<AtomicBool>>> {
    CANCEL_TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Set up tracking for a new remote op. Returns the op id and a token that
/// the callbacks should check on every progress tick. The caller should
/// keep this `OpHandle` until the op finishes; on drop, the token is
/// removed from the registry so a stale `cancel_remote_op` no-ops.
pub struct OpHandle {
    pub op_id: u64,
    pub token: Arc<AtomicBool>,
}

impl OpHandle {
    pub fn is_cancelled(&self) -> bool {
        self.token.load(Ordering::Relaxed)
    }
}

impl Drop for OpHandle {
    fn drop(&mut self) {
        cancel_tokens().lock().unwrap().remove(&self.op_id);
    }
}

fn start_op(app: &AppHandle, op: RemoteOpKind) -> OpHandle {
    let op_id = NEXT_OP_ID.fetch_add(1, Ordering::SeqCst);
    let token = Arc::new(AtomicBool::new(false));
    cancel_tokens().lock().unwrap().insert(op_id, token.clone());
    let _ = app.emit("git://progress", ProgressEvent::Started { op_id, op });
    OpHandle { op_id, token }
}

/// Frontend → backend: flip an op's cancel flag. The libgit2 callbacks
/// pick it up on their next tick (sub-second granularity in practice).
/// Idempotent — cancelling an unknown / already-finished op is a no-op.
pub fn cancel_remote_op(op_id: u64) {
    if let Some(token) = cancel_tokens().lock().unwrap().get(&op_id) {
        token.store(true, Ordering::Relaxed);
    }
}

// ---------------------------------------------------------------------------
// Callback construction
// ---------------------------------------------------------------------------

fn make_callbacks<'a>(
    app: AppHandle,
    op_id: u64,
    cancel: Arc<AtomicBool>,
    total_pack_bytes: bool,
) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();

    // -------- credentials --------
    // Track what we've already tried so we don't loop forever inside libgit2.
    let mut tried_agent = false;
    let mut tried_default = false;
    let mut tried_helper = false;
    let mut prompted_count = 0usize;
    let app_for_creds = app.clone();
    cb.credentials(move |url, username_from_url, allowed| {
        // SSH agent first.
        if allowed.contains(CredentialType::SSH_KEY) && !tried_agent {
            tried_agent = true;
            if let Some(user) = username_from_url {
                if let Ok(c) = Cred::ssh_key_from_agent(user) {
                    return Ok(c);
                }
            }
        }
        // Default ~/.ssh keys.
        if allowed.contains(CredentialType::SSH_KEY) && !tried_default {
            tried_default = true;
            if let Some(user) = username_from_url {
                if let Some(home) = dirs::home_dir() {
                    for key in ["id_ed25519", "id_rsa", "id_ecdsa"] {
                        let priv_key = home.join(".ssh").join(key);
                        if priv_key.exists() {
                            if let Ok(c) = Cred::ssh_key(user, None, &priv_key, None) {
                                return Ok(c);
                            }
                        }
                    }
                }
            }
        }
        // git credential helper (https).
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) && !tried_helper {
            tried_helper = true;
            if let Ok(cfg) = git2::Config::open_default() {
                if let Ok(c) = Cred::credential_helper(&cfg, url, username_from_url) {
                    return Ok(c);
                }
            }
        }
        // SSH wants only a username (not actually credentials).
        if allowed.contains(CredentialType::USERNAME) {
            if let Some(user) = username_from_url {
                return Cred::username(user);
            }
        }
        // Fallback: ask the user.
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) && prompted_count < 3 {
            prompted_count += 1;
            if let Some(reply) = prompt_user(&app_for_creds, url, username_from_url) {
                return Cred::userpass_plaintext(&reply.username, &reply.password);
            }
        }
        Err(git2::Error::from_str(
            "authentication required (no usable credentials)",
        ))
    });

    // -------- progress: receive (fetch) --------
    let app_progress = app.clone();
    let cancel_recv = cancel.clone();
    cb.transfer_progress(move |stats| {
        // Returning `false` from this callback signals libgit2 to abort the
        // transfer. We use it to honour the user-cancel flag.
        if cancel_recv.load(Ordering::Relaxed) {
            return false;
        }
        let received = stats.received_objects();
        let total = stats.total_objects();
        let bytes = stats.received_bytes();
        let _ = app_progress.emit(
            "git://progress",
            ProgressEvent::Receiving {
                op_id,
                received,
                total,
                bytes,
            },
        );
        if stats.indexed_objects() > 0 && total > 0 {
            let _ = app_progress.emit(
                "git://progress",
                ProgressEvent::Indexing {
                    op_id,
                    indexed: stats.indexed_objects(),
                    total,
                },
            );
        }
        true
    });

    // -------- sideband (server messages) --------
    let app_sb = app.clone();
    cb.sideband_progress(move |data| {
        if let Ok(s) = std::str::from_utf8(data) {
            let _ = app_sb.emit(
                "git://progress",
                ProgressEvent::Sideband {
                    op_id,
                    message: s.trim().to_string(),
                },
            );
        }
        true
    });

    // -------- progress: push --------
    let app_push = app.clone();
    let cancel_push = cancel.clone();
    cb.push_transfer_progress(move |current, total, _bytes| {
        // push_transfer_progress's callback signature can't return a value
        // to abort, so we only fire the event if not cancelled — the next
        // pack-builder tick (or the credentials callback re-fire) will
        // surface the cancel through the transfer hook.
        if cancel_push.load(Ordering::Relaxed) {
            return;
        }
        let _ = app_push.emit(
            "git://progress",
            ProgressEvent::Pushing {
                op_id,
                pushed: current,
                total,
            },
        );
    });

    // -------- per-ref push response --------
    let app_ref = app.clone();
    cb.push_update_reference(move |refname, status| {
        let _ = app_ref.emit(
            "git://progress",
            ProgressEvent::PushStatus {
                op_id,
                refname: refname.to_string(),
                status: status.map(|s| s.to_string()),
            },
        );
        Ok(())
    });

    // (silence unused arg in callback signature)
    let _ = total_pack_bytes;
    cb
}

fn fetch_options<'a>(app: AppHandle, op_id: u64, cancel: Arc<AtomicBool>) -> FetchOptions<'a> {
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(make_callbacks(app, op_id, cancel, false));
    opts.download_tags(AutotagOption::Auto);
    opts.prune(git2::FetchPrune::On);
    opts
}

fn push_options<'a>(app: AppHandle, op_id: u64, cancel: Arc<AtomicBool>) -> PushOptions<'a> {
    let mut opts = PushOptions::new();
    opts.remote_callbacks(make_callbacks(app, op_id, cancel, true));
    opts
}

// ---------------------------------------------------------------------------
// Public ops
// ---------------------------------------------------------------------------

/// Fetch one remote (or all of them when `remote` is `None`).
pub fn fetch(
    app: AppHandle,
    path: &str,
    remote: Option<&str>,
) -> Result<RemoteOpResult, git2::Error> {
    let handle = start_op(&app, RemoteOpKind::Fetch);
    let result = fetch_inner(&app, path, remote, &handle);
    finish_op(&app, &handle, &result);
    result
}

fn fetch_inner(
    app: &AppHandle,
    path: &str,
    remote: Option<&str>,
    handle: &OpHandle,
) -> Result<RemoteOpResult, git2::Error> {
    let repo = Repository::discover(path)?;
    let remotes: Vec<String> = match remote {
        Some(r) => vec![r.to_string()],
        None => repo
            .remotes()?
            .iter()
            .filter_map(|r| r.map(|s| s.to_string()))
            .collect(),
    };
    if remotes.is_empty() {
        return Err(git2::Error::from_str("no remote configured"));
    }

    let mut details = Vec::new();
    for name in &remotes {
        let mut r = repo.find_remote(name)?;
        let mut opts = fetch_options(app.clone(), handle.op_id, handle.token.clone());
        // Use the remote's configured refspecs (None = default).
        let refspecs: [&str; 0] = [];
        r.fetch(&refspecs, Some(&mut opts), None)?;
        let stats = r.stats();
        details.push(format!(
            "{}: {} objects ({} bytes)",
            name,
            stats.received_objects(),
            stats.received_bytes()
        ));
    }

    let summary = if remotes.len() == 1 {
        format!("fetched {}", remotes[0])
    } else {
        format!("fetched {} remotes", remotes.len())
    };
    Ok(RemoteOpResult::ok_with(summary, details))
}

/// Pull = fetch + fast-forward (only). Returns an error on a non-FF situation;
/// the user can resolve via merge UI separately.
pub fn pull(app: AppHandle, path: &str) -> Result<RemoteOpResult, git2::Error> {
    let handle = start_op(&app, RemoteOpKind::Pull);
    let result = pull_inner(&app, path, &handle);
    finish_op(&app, &handle, &result);
    result
}

fn pull_inner(
    app: &AppHandle,
    path: &str,
    handle: &OpHandle,
) -> Result<RemoteOpResult, git2::Error> {
    let repo = Repository::discover(path)?;

    // Determine the upstream of the current branch.
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(git2::Error::from_str("HEAD is detached; cannot pull"));
    }
    let local_branch_name = head
        .shorthand()
        .ok_or_else(|| git2::Error::from_str("invalid HEAD"))?
        .to_string();
    let local_branch = repo.find_branch(&local_branch_name, git2::BranchType::Local)?;
    let upstream = local_branch.upstream().map_err(|_| {
        git2::Error::from_str(&format!(
            "branch '{}' has no upstream configured",
            local_branch_name
        ))
    })?;
    let upstream_ref = upstream.get();
    let upstream_name = upstream_ref
        .name()
        .ok_or_else(|| git2::Error::from_str("invalid upstream ref"))?
        .to_string();

    // Parse "refs/remotes/<remote>/<branch>".
    let stripped = upstream_name
        .strip_prefix("refs/remotes/")
        .ok_or_else(|| git2::Error::from_str("upstream is not a remote-tracking branch"))?;
    let (remote_name, _remote_branch) = stripped
        .split_once('/')
        .ok_or_else(|| git2::Error::from_str("malformed upstream name"))?;

    // Fetch the upstream's remote.
    let mut remote = repo.find_remote(remote_name)?;
    {
        let mut opts = fetch_options(app.clone(), handle.op_id, handle.token.clone());
        let refspecs: [&str; 0] = [];
        remote.fetch(&refspecs, Some(&mut opts), None)?;
    }

    // Fast-forward analysis.
    let upstream_oid = upstream_ref
        .target()
        .ok_or_else(|| git2::Error::from_str("upstream has no target"))?;
    let fetch_commit: AnnotatedCommit = repo.find_annotated_commit(upstream_oid)?;
    let (analysis, _) = repo.merge_analysis(&[&fetch_commit])?;

    let result = if analysis.contains(MergeAnalysis::ANALYSIS_UP_TO_DATE) {
        RemoteOpResult::ok("already up to date")
    } else if analysis.contains(MergeAnalysis::ANALYSIS_FASTFORWARD) {
        // Fast-forward the local branch.
        let refname = format!("refs/heads/{}", local_branch_name);
        let mut local_ref = repo.find_reference(&refname)?;
        local_ref.set_target(upstream_oid, "pull: fast-forward")?;
        repo.set_head(&refname)?;
        repo.checkout_head(Some(CheckoutBuilder::default().force()))?;
        RemoteOpResult::ok(format!(
            "fast-forwarded to {}",
            &upstream_oid.to_string()[..7]
        ))
    } else if analysis.contains(MergeAnalysis::ANALYSIS_NORMAL) {
        return Err(git2::Error::from_str(
            "non-fast-forward — use the merge UI to integrate the upstream",
        ));
    } else {
        return Err(git2::Error::from_str("nothing to merge"));
    };

    Ok(result)
}

/// Push the current branch (or `branch` on `remote`) to its upstream.
pub fn push(
    app: AppHandle,
    path: &str,
    remote: Option<&str>,
    branch: Option<&str>,
    set_upstream: bool,
) -> Result<RemoteOpResult, git2::Error> {
    let handle = start_op(&app, RemoteOpKind::Push);
    let result = push_inner(&app, path, remote, branch, set_upstream, &handle);
    finish_op(&app, &handle, &result);
    result
}

fn push_inner(
    app: &AppHandle,
    path: &str,
    remote: Option<&str>,
    branch: Option<&str>,
    set_upstream: bool,
    handle: &OpHandle,
) -> Result<RemoteOpResult, git2::Error> {
    let repo = Repository::discover(path)?;

    // Resolve the local branch name.
    let local_branch_name = match branch {
        Some(b) => b.to_string(),
        None => {
            let head = repo.head()?;
            if !head.is_branch() {
                return Err(git2::Error::from_str(
                    "HEAD is detached; specify a branch to push",
                ));
            }
            head.shorthand()
                .ok_or_else(|| git2::Error::from_str("invalid HEAD"))?
                .to_string()
        }
    };

    // Resolve the remote: explicit > upstream remote > "origin".
    let remote_name = match remote {
        Some(r) => r.to_string(),
        None => {
            let local_branch = repo.find_branch(&local_branch_name, git2::BranchType::Local)?;
            match local_branch.upstream() {
                Ok(up) => {
                    let n = up
                        .get()
                        .name()
                        .and_then(|n| n.strip_prefix("refs/remotes/"))
                        .and_then(|n| n.split_once('/').map(|(r, _)| r.to_string()));
                    n.unwrap_or_else(|| "origin".to_string())
                }
                Err(_) => "origin".to_string(),
            }
        }
    };

    let mut remote = repo.find_remote(&remote_name)?;
    let refspec = format!(
        "refs/heads/{name}:refs/heads/{name}",
        name = local_branch_name
    );
    {
        let mut opts = push_options(app.clone(), handle.op_id, handle.token.clone());
        remote.push(&[&refspec], Some(&mut opts))?;
    }

    if set_upstream {
        let upstream_name = format!("{}/{}", remote_name, local_branch_name);
        let mut local_branch = repo.find_branch(&local_branch_name, git2::BranchType::Local)?;
        local_branch.set_upstream(Some(&upstream_name))?;
    }

    let summary = format!("pushed {} → {}", local_branch_name, remote_name);
    Ok(RemoteOpResult::ok(summary))
}

/// Push a single tag to a remote. Uses `+refs/tags/<name>:refs/tags/<name>`
/// when `force` is true so a moved/recreated tag overwrites the remote
/// copy; otherwise plain non-forced refspec.
pub fn push_tag(
    app: AppHandle,
    path: &str,
    remote: Option<&str>,
    tag_name: &str,
    force: bool,
) -> Result<RemoteOpResult, git2::Error> {
    let handle = start_op(&app, RemoteOpKind::Push);
    let result = push_tag_inner(&app, path, remote, tag_name, force, &handle);
    finish_op(&app, &handle, &result);
    result
}

fn push_tag_inner(
    app: &AppHandle,
    path: &str,
    remote: Option<&str>,
    tag_name: &str,
    force: bool,
    handle: &OpHandle,
) -> Result<RemoteOpResult, git2::Error> {
    let repo = Repository::discover(path)?;
    let remote_name = remote
        .map(str::to_string)
        .unwrap_or_else(|| "origin".into());
    let mut remote = repo.find_remote(&remote_name)?;
    let lead = if force { "+" } else { "" };
    let refspec = format!("{lead}refs/tags/{tag_name}:refs/tags/{tag_name}");
    {
        let mut opts = push_options(app.clone(), handle.op_id, handle.token.clone());
        remote.push(&[&refspec], Some(&mut opts))?;
    }
    Ok(RemoteOpResult::ok(format!(
        "pushed tag {tag_name} → {remote_name}"
    )))
}

/// Mirror every local tag to a remote (`refs/tags/*:refs/tags/*`,
/// equivalent to `git push <remote> --tags`).
pub fn push_all_tags(
    app: AppHandle,
    path: &str,
    remote: Option<&str>,
    force: bool,
) -> Result<RemoteOpResult, git2::Error> {
    let handle = start_op(&app, RemoteOpKind::Push);
    let result = push_all_tags_inner(&app, path, remote, force, &handle);
    finish_op(&app, &handle, &result);
    result
}

fn push_all_tags_inner(
    app: &AppHandle,
    path: &str,
    remote: Option<&str>,
    force: bool,
    handle: &OpHandle,
) -> Result<RemoteOpResult, git2::Error> {
    let repo = Repository::discover(path)?;
    let remote_name = remote
        .map(str::to_string)
        .unwrap_or_else(|| "origin".into());
    let mut remote = repo.find_remote(&remote_name)?;
    let refspec = if force {
        "+refs/tags/*:refs/tags/*"
    } else {
        "refs/tags/*:refs/tags/*"
    };
    {
        let mut opts = push_options(app.clone(), handle.op_id, handle.token.clone());
        remote.push(&[refspec], Some(&mut opts))?;
    }
    Ok(RemoteOpResult::ok(format!(
        "pushed all tags → {remote_name}"
    )))
}

/// Delete a tag on the remote (`:refs/tags/<name>` refspec, equivalent
/// to `git push <remote> --delete <tag>`). The local tag is left
/// untouched; use `delete_tag` in `refs_ops` separately if needed.
pub fn delete_remote_tag(
    app: AppHandle,
    path: &str,
    remote: Option<&str>,
    tag_name: &str,
) -> Result<RemoteOpResult, git2::Error> {
    let handle = start_op(&app, RemoteOpKind::Push);
    let result = delete_remote_tag_inner(&app, path, remote, tag_name, &handle);
    finish_op(&app, &handle, &result);
    result
}

fn delete_remote_tag_inner(
    app: &AppHandle,
    path: &str,
    remote: Option<&str>,
    tag_name: &str,
    handle: &OpHandle,
) -> Result<RemoteOpResult, git2::Error> {
    let repo = Repository::discover(path)?;
    let remote_name = remote
        .map(str::to_string)
        .unwrap_or_else(|| "origin".into());
    let mut remote = repo.find_remote(&remote_name)?;
    let refspec = format!(":refs/tags/{tag_name}");
    {
        let mut opts = push_options(app.clone(), handle.op_id, handle.token.clone());
        remote.push(&[&refspec], Some(&mut opts))?;
    }
    Ok(RemoteOpResult::ok(format!(
        "deleted remote tag {tag_name} on {remote_name}"
    )))
}

/// Emit a `Done` or `Cancelled` event reflecting the inner result. We
/// distinguish between the two by inspecting the cancel flag and the
/// shape of the error: cancelled libgit2 transfers usually surface as a
/// `User` error code (because our callback returned `false`).
fn finish_op(app: &AppHandle, handle: &OpHandle, result: &Result<RemoteOpResult, git2::Error>) {
    let cancelled = handle.is_cancelled();
    let event = match result {
        Ok(r) => ProgressEvent::Done {
            op_id: handle.op_id,
            ok: true,
            summary: r.message.clone(),
        },
        Err(_) if cancelled => ProgressEvent::Cancelled {
            op_id: handle.op_id,
        },
        Err(e) => ProgressEvent::Done {
            op_id: handle.op_id,
            ok: false,
            summary: e.message().to_string(),
        },
    };
    let _ = app.emit("git://progress", event);
}
