/**
 * Strongly-typed wrappers around Tauri `invoke` for our Git backend.
 * Keep all Rust command names + payload shapes here, never elsewhere.
 *
 * Errors thrown across this boundary are upgraded to `AppErrorThrown`
 * (see `./invoke.ts`). The legacy `catch (e) { String(e) }` pattern keeps
 * working because `AppErrorThrown` extends `Error` with a formatted message.
 * New call sites can branch on `e.appError.kind` for typed handling.
 */
import { invoke } from "./invoke";

// ---------- Re-exports for convenience ----------
export {
  AppErrorThrown,
  isAppErrorThrown,
  invoke,
  toastingInvoke,
  type InvokeOptions,
} from "./invoke";
export type { AppError, AppErrorKind } from "../lib/appError";
export { isAppError, isErrorOfKind, parseAppError, formatAppError } from "../lib/appError";

// ---------- Types (mirror Rust commands.rs) ----------
export interface RepoInfo {
  path: string;
  head: string | null;
  is_bare: boolean;
}

export interface CommitSummary {
  oid: string;
  short_oid: string;
  summary: string;
  author_name: string;
  author_email: string;
  /** unix seconds */
  time: number;
  parents: string[];
  refs: string[];
}

/**
 * Rich, on-demand metadata for one commit (loaded lazily by the
 * CommitDetails pane). Mirrors `git::log::CommitMeta` on the backend.
 *
 * `containing_branches` and `containing_tags` answer "what released
 * this fix?" by walking every ref tip and asking libgit2 whether the
 * commit is reachable from it (`graph_descendant_of`).
 */
export interface CommitMeta {
  oid: string;
  /** Full multi-line commit message (subject + body). */
  message: string;
  /** First line — handy for headers. */
  summary: string;
  author_name: string;
  author_email: string;
  /** Unix seconds. */
  author_time: number;
  committer_name: string;
  committer_email: string;
  /** Unix seconds. Distinct from author_time on cherry-picks / rebases. */
  committer_time: number;
  parents: string[];
  /** Local + remote branches whose tip is this commit or a descendant. */
  containing_branches: string[];
  /** Tag short names (no `refs/tags/` prefix), peeled before comparison. */
  containing_tags: string[];
  /** Embedded GPG / SSH signature status (v0.13.19). Always present —
   *  unsigned commits report `signed: false` rather than null. */
  signature: CommitSignatureInfo;
}

export interface FileChange {
  path: string;
  old_path: string | null;
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "typechange";
  insertions: number;
  deletions: number;
}

export interface FileHistoryEntry {
  commit: CommitSummary;
  /** Path of the tracked file at this commit (may differ on renames). */
  path_at_commit: string;
  status: "added" | "deleted" | "modified" | "renamed" | "copied" | "typechange";
  /** Previous path when this commit is a rename / copy. */
  old_path: string | null;
  insertions: number;
  deletions: number;
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  origin: " " | "+" | "-";
  old_lineno: number | null;
  new_lineno: number | null;
  content: string;
}

export interface FileDiff {
  old_path: string | null;
  new_path: string | null;
  is_binary: boolean;
  hunks: DiffHunk[];
}

/**
 * v0.13.25 — where `apply_patch` should land.
 *   - `work_dir`: working tree only (legacy v0.13.9 behaviour).
 *   - `index`:    index only (= `git apply --cached`); the line-level
 *                 staging path uses this with a synthesised sub-patch.
 *   - `both`:     apply to both, mirroring `git apply --index`.
 *
 * Mirrors `git::patch::PatchLocation` on the backend.
 */
export type PatchLocation = "work_dir" | "index" | "both";

/**
 * v0.13.26 — outcome of a `cherry_pick_sequence` IPC. Tagged union
 * mirroring the backend `CherrySequenceOutcome` enum:
 *   - `done`: every oid landed cleanly and was committed; `applied`
 *      equals the input length.
 *   - `stopped`: cherry-pick of `failed_oid` produced index conflicts.
 *      `applied` commits before this point are already on HEAD; the
 *      repo is in `CHERRY_PICK_HEAD` state and the user should resolve
 *      via the merge view. `pending` lists the oids that were not
 *      attempted (the failing one is the *first* of `pending`).
 */
export type CherrySequenceOutcome =
  | { kind: "done"; applied: number }
  | { kind: "stopped"; applied: number; failed_oid: string; pending: string[] };

/**
 * Raw-bytes payload for binary / image previews (v0.13.14).
 * Mirrors `git::blob::BlobPayload` on the backend.
 */
export interface BlobPayload {
  /** True when the file doesn't exist on this side (e.g. just-added). */
  missing: boolean;
  /** True when size > 8 MB; `data_b64` is empty in that case. */
  oversized: boolean;
  /** Total uncompressed byte count (always reported, even when oversized). */
  size: number;
  /** Standard base64 (no `data:` prefix). Empty when missing or oversized. */
  data_b64: string;
}

export interface ConflictFile {
  path: string;
  ancestor: string | null;
  ours: string | null;
  theirs: string | null;
}

export type RefKind = "local_branch" | "remote_branch" | "tag";

export interface RefEntry {
  kind: RefKind;
  name: string;
  target: string | null;
  is_head: boolean;
  /**
   * v0.13.34 — Upstream tracking branch name without the
   * `refs/remotes/` prefix (e.g. `origin/main`). Only present for local
   * branches that have a configured upstream.
   */
  upstream?: string;
  /**
   * v0.13.34 — Number of commits the local branch is ahead of its
   * upstream. 0 when in sync. Absent when there is no upstream.
   */
  ahead?: number;
  /**
   * v0.13.34 — Number of commits the local branch is behind its
   * upstream. 0 when in sync. Absent when there is no upstream.
   */
  behind?: number;
}

/**
 * Detailed view of a single tag, surfaced by `list_tags` for the Tags page.
 * Mirrors `git::refs::TagInfo` on the backend.
 */
export interface TagInfo {
  name: string;
  /** True when stored as a `git tag -a` annotated object (has its own oid + message + tagger). */
  is_annotated: boolean;
  /** Annotated tag's own oid; equals target_oid for lightweight tags. */
  tag_oid: string | null;
  target_oid: string;
  target_short_oid: string;
  commit_summary: string;
  message: string | null;
  tagger_name: string | null;
  tagger_email: string | null;
  /** Unix seconds. Annotated time when available, otherwise commit time. */
  time: number;
}

export type MergeState =
  | "clean"
  | "merge"
  | "revert"
  | "cherry_pick"
  | "bisect"
  | "rebase"
  | "rebase_interactive"
  | "rebase_merge"
  | "apply_mailbox"
  | "apply_mailbox_or_rebase";

export interface ConflictContent {
  path: string;
  ancestor: string | null;
  ours: string | null;
  theirs: string | null;
  /** working-tree content with conflict markers, if not yet resolved */
  working: string | null;
}

export interface BlameLine {
  line: number;
  oid: string;
  short_oid: string;
  summary: string;
  author_name: string;
  author_email: string;
  /** unix seconds */
  time: number;
  content: string;
}

export interface PrevFile {
  /** Old path (before the rename / when the file was last edited). */
  path: string;
  /** Commit that produced this old version. */
  oid: string;
  short_oid: string;
}

export type WorkingFlag = "unstaged" | "staged" | "both" | "untracked" | "conflict" | "ignored";
export type WorkingStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "typechange"
  | "untracked"
  | "conflict";

export interface WorkingFile {
  path: string;
  flag: WorkingFlag;
  status: WorkingStatus;
}

/** Returned by `read_working_file` / `read_head_file`. */
export interface WorkingFileText {
  /** Full UTF-8 contents of the file (with original line endings). */
  content: string;
  /** True when the file does not exist on disk / at HEAD. */
  missing: boolean;
}

export interface RemoteOpResult {
  success: boolean;
  /** Short human-readable summary (e.g. "fast-forwarded 3 commits"). */
  message: string;
  /** Optional details per remote/branch (push response, fetch refs). */
  details: string[];
}

/** Backwards-compat alias for older call sites. */
export type GitCmdResult = RemoteOpResult;

/** Frontend payload of `git://credentials-needed`. */
export interface CredRequest {
  id: number;
  url: string;
  username_hint: string | null;
}

/**
 * Backend → frontend progress events on `git://progress`.
 *
 * Every `fetch` / `pull` / `push` call begins with exactly one `started`
 * event carrying a fresh `op_id`, then streams a sequence of
 * `sideband` / `receiving` / `indexing` / `pushing` / `push-status`
 * events tagged with the same `op_id`, and ends with either `done` or
 * `cancelled`. The frontend uses `op_id` to associate progress with
 * the originating call (and to scope the Cancel button).
 */
export type RemoteOpKind = "fetch" | "pull" | "push";

export type ProgressEvent =
  | { phase: "started"; op_id: number; op: RemoteOpKind }
  | { phase: "sideband"; op_id: number; message: string }
  | { phase: "receiving"; op_id: number; received: number; total: number; bytes: number }
  | { phase: "indexing"; op_id: number; indexed: number; total: number }
  | { phase: "pushing"; op_id: number; pushed: number; total: number }
  | { phase: "push-status"; op_id: number; refname: string; status: string | null }
  | { phase: "done"; op_id: number; ok: boolean; summary: string }
  | { phase: "cancelled"; op_id: number };

export interface StashEntry {
  /** Stack index (0 = most recent). */
  index: number;
  oid: string;
  short_oid: string;
  message: string;
  /** Unix seconds. */
  time: number;
}

export interface ReflogEntry {
  index: number;
  new_oid: string;
  short_new_oid: string;
  old_oid: string;
  short_old_oid: string;
  message: string;
  committer_name: string;
  committer_email: string;
  /** Unix seconds. */
  time: number;
}

export interface SubmoduleInfo {
  name: string;
  path: string;
  url: string | null;
  head_oid: string | null;
  workdir_oid: string | null;
  initialized: boolean;
  workdir_present: boolean;
  commit_changed: boolean;
  wd_dirty: boolean;
}

export interface WorktreeInfo {
  /** Folder name of the worktree (or registered name under .git/worktrees/<name>). */
  name: string;
  /** Absolute path of the working directory. */
  path: string;
  /** Short branch name when on a branch; null when detached. */
  branch: string | null;
  /** HEAD commit oid (full hash). */
  head_oid: string | null;
  /** True for the main checkout. */
  is_main: boolean;
  /** True when the worktree has been locked via `git worktree lock`. */
  is_locked: boolean;
  /** True when libgit2 considers it pruneable (working dir gone). */
  is_prunable: boolean;
}

export interface GitignoreTemplate {
  id: string;
  label: string;
  content: string;
}

export interface IgnorePreview {
  /** Total tracked + untracked + ignored paths scanned. */
  scanned: number;
  /** Paths that the candidate text starts ignoring (not previously ignored). */
  newly_ignored: string[];
  /** Paths that switch from ignored → not ignored under the candidate text. */
  no_longer_ignored: string[];
}

export interface LogPage {
  commits: CommitSummary[];
  /** True when the walker hit the requested limit before exhausting the DAG. */
  has_more: boolean;
  /** OID of the last commit on this page; pass back as `after` to load more. */
  next_cursor: string | null;
}

export type SearchMode = "message" | "diff" | "both";
export type PatternKind = "literal" | "regex";

export interface DiffHit {
  file: string;
  line_no: number;
  /** "+" for added lines, "-" for removed. */
  side: string;
  text: string;
}

export interface SearchHit {
  oid: string;
  short_oid: string;
  summary: string;
  author_name: string;
  time: number;
  message_match: boolean;
  diff_hits: DiffHit[];
}

export interface SearchSummary {
  hits: SearchHit[];
  scanned: number;
  truncated: boolean;
}

// ---------- Repository statistics (split into 3 parallel calls) ----------

export interface TimelinePoint {
  period: string;
  commits: number;
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface AuthorOverview {
  name: string;
  email: string;
  commits: number;
  first_commit: number;
  last_commit: number;
}

/** Fast metadata-only stats (no tree diffs). */
export interface StatsOverview {
  total_commits: number;
  total_authors: number;
  active_branches: number;
  timeline: TimelinePoint[];
  heatmap: HeatmapDay[];
  authors: AuthorOverview[];
  hour_distribution: number[];
  weekday_distribution: number[];
}

export interface BranchStats {
  name: string;
  commits: number;
}

export interface BranchLifecycle {
  name: string;
  created_at: number | null;
  last_commit: number;
  commit_count: number;
  merged: boolean;
  ahead_of_main: number;
}

/** Branch stats + lifecycle (no per-commit diffs). */
export interface StatsBranches {
  branches: BranchStats[];
  branch_lifecycle: BranchLifecycle[];
}

export interface ChurnPoint {
  period: string;
  insertions: number;
  deletions: number;
}

export interface FileHotspot {
  path: string;
  change_count: number;
  total_churn: number;
}

export interface AuthorChurn {
  name: string;
  email: string;
  insertions: number;
  deletions: number;
}

/** Diff-based stats (the expensive part, loaded separately). */
export interface StatsChurn {
  total_insertions: number;
  total_deletions: number;
  churn: ChurnPoint[];
  file_hotspots: FileHotspot[];
  author_churn: AuthorChurn[];
}

// ---------- Commit signing (v0.13.19) ----------

/**
 * Format detected on a signed commit. Mirrors `signing::SignFormat` on
 * the backend. `null` means we found a `gpgsig` header but couldn't
 * recognise the armor (rare).
 */
export type SignFormat = "openpgp" | "ssh";

/**
 * Signature status for one commit, as reported by `commit_signature_status`.
 * The backend only inspects the embedded header — it does NOT run an
 * external verifier — so this answers "is it signed?" + "what format?",
 * not "is the signature valid?". Trust-rooted verification is a future
 * follow-up that needs platform-specific keyrings.
 */
export interface CommitSignatureInfo {
  signed: boolean;
  format: SignFormat | null;
  /** Short single-line label suitable for tooltips ("OpenPGP signed", "Not signed", …). */
  summary: string;
}

// ---------- Verify commit signature (v0.13.20) ----------

/**
 * Outcome bucket from `verify_commit_signature`. Mirrors `signing::VerifyState`.
 * - good      — signature checked out + key in trust store
 * - no_key    — signature is well-formed but trust root has no matching key
 * - bad       — signature does NOT match payload (tampering / corruption)
 * - unsigned  — no embedded `gpgsig` header at all
 * - error     — verifier itself failed (binary missing, IO, …)
 */
export type VerifyState = "good" | "no_key" | "bad" | "unsigned" | "error";

export interface VerifyResult {
  state: VerifyState;
  format: SignFormat | null;
  /** "Alice <alice@example.com>" / SSH fingerprint, when verifier could extract it. */
  signer: string | null;
  /** Raw stderr / stdout from the verifier. Empty for `unsigned`. */
  output: string;
}

// ---------- Commit options (v0.13.20) ----------

/**
 * Knobs for `commitChanges`. Mirrors `workspace::CommitOptions`.
 * Defaults match `git commit` with no flags (no amend, no signoff,
 * hooks ON).
 */
export interface CommitOptions {
  /** `git commit --amend` */
  amend?: boolean;
  /** Append `Signed-off-by:` trailer using `user.{name,email}` */
  signoff?: boolean;
  /** With amend: also reset the author identity + timestamp to current user. */
  reset_author?: boolean;
  /** Run pre-commit / commit-msg / post-commit hooks. Default true. */
  run_hooks?: boolean;
  /** Override commit author in "Name <email>" format. */
  author?: string;
}

/** Result of a successful `commitChanges` invocation. */
export interface CommitOutcome {
  oid: string;
  amended: boolean;
  post_commit_ran: boolean;
}

// ---------- Interactive Rebase ----------

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop";

export interface RebaseStep {
  action: RebaseAction;
  oid: string;
  short_oid: string;
  summary: string;
  /** New / combined message for `reword` & `squash` (optional). */
  new_message: string;
}

export interface RebaseStateInfo {
  /** Branch ref being rewritten, or null if started from detached HEAD. */
  branch_ref: string | null;
  original_head: string;
  base: string;
  remaining: RebaseStep[];
  done: number;
  total: number;
}

export type RebaseStatus =
  | { kind: "idle" }
  | { kind: "running"; state: RebaseStateInfo }
  | { kind: "conflicted"; state: RebaseStateInfo }
  | { kind: "done"; rewritten: number };

// ---------- Commands ----------
export const git = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  trackedFiles: (path: string) => invoke<string[]>("tracked_files", { path }),
  fileHistory: (path: string, file: string, limit?: number) =>
    invoke<FileHistoryEntry[]>("file_history", { path, file, limit: limit ?? null }),
  log: (path: string, opts?: { limit?: number; skip?: number; pathspec?: string }) =>
    invoke<CommitSummary[]>("git_log", {
      path,
      limit: opts?.limit ?? 5000,
      skip: opts?.skip ?? 0,
      pathspec: opts?.pathspec ?? null,
    }),
  logPage: (path: string, opts?: { after?: string; limit?: number; pathspec?: string }) =>
    invoke<LogPage>("git_log_page", {
      path,
      after: opts?.after ?? null,
      limit: opts?.limit ?? 1000,
      pathspec: opts?.pathspec ?? null,
    }),
  /**
   * v0.13.21 — incremental "top-up" walk. Returns commits strictly newer
   * than `knownOid`, in newest-first order. Returns `null` when `knownOid`
   * is no longer reachable from HEAD (force-push / hard-reset rewrote the
   * branch out from under us); callers should fall back to a full
   * `logPage` reload in that case.
   */
  logSince: (path: string, knownOid: string, cap?: number) =>
    invoke<CommitSummary[] | null>("git_log_since", {
      path,
      knownOid,
      cap: cap ?? null,
    }),
  commitFiles: (path: string, oid: string) => invoke<FileChange[]>("commit_files", { path, oid }),
  /** Rich metadata for one commit: full message, author + committer, parents, containing branches & tags. */
  commitMeta: (path: string, oid: string) => invoke<CommitMeta>("commit_meta", { path, oid }),
  /** v0.13.16 — flat list of OIDs reachable from `oid` walking *backwards* through parents (inclusive). */
  commitAncestors: (path: string, oid: string, limit?: number) =>
    invoke<string[]>("commit_ancestors", { path, oid, limit: limit ?? null }),
  /** v0.13.16 — flat list of OIDs reachable from `oid` walking *forwards* through children (inclusive). */
  commitDescendants: (path: string, oid: string, limit?: number, scanLimit?: number) =>
    invoke<string[]>("commit_descendants", {
      path,
      oid,
      limit: limit ?? null,
      scanLimit: scanLimit ?? null,
    }),
  /** v0.13.19 — does this commit carry a GPG / SSH signature header? Read-only probe. */
  commitSignatureStatus: (path: string, oid: string) =>
    invoke<CommitSignatureInfo>("commit_signature_status", { path, oid }),
  /** v0.13.20 — trust-rooted verification: shells out to gpg --verify or
   *  ssh-keygen -Y verify. Call on demand (e.g. user clicks the Signature
   *  badge), not for every history row. */
  verifyCommitSignature: (path: string, oid: string) =>
    invoke<VerifyResult>("verify_commit_signature", { path, oid }),
  fileDiff: (path: string, oid: string, file: string, ignoreWhitespace = false) =>
    invoke<FileDiff>("file_diff", { path, oid, file, ignoreWhitespace }),
  workingDiff: (path: string, file: string, ignoreWhitespace = false) =>
    invoke<FileDiff>("working_diff", { path, file, ignoreWhitespace }),
  conflicts: (path: string) => invoke<ConflictFile[]>("conflicts", { path }),
  mergeState: (path: string) => invoke<MergeState>("merge_state", { path }),
  conflictContent: (path: string, file: string) =>
    invoke<ConflictContent>("conflict_content", { path, file }),
  resolveConflict: (path: string, file: string, content: string) =>
    invoke<void>("resolve_conflict", { path, file, content }),
  abortMerge: (path: string) => invoke<void>("abort_merge", { path }),
  commitMerge: (path: string, message?: string) =>
    invoke<string>("commit_merge", { path, message: message ?? null }),
  listRefs: (path: string) => invoke<RefEntry[]>("list_refs", { path }),
  blameFile: (path: string, file: string) => invoke<BlameLine[]>("blame_file", { path, file }),
  blameAtRevision: (path: string, file: string, revision: string) =>
    invoke<BlameLine[]>("blame_at_revision", { path, file, revision }),
  previousFilename: (path: string, file: string, atRevision: string) =>
    invoke<PrevFile | null>("previous_filename", { path, file, atRevision }),
  workingChanges: (path: string) => invoke<WorkingFile[]>("working_changes", { path }),
  stageFiles: (path: string, paths: string[]) => invoke<void>("stage_files", { path, paths }),
  unstageFiles: (path: string, paths: string[]) => invoke<void>("unstage_files", { path, paths }),
  discardFiles: (path: string, paths: string[]) => invoke<void>("discard_files", { path, paths }),
  commitChanges: (path: string, message: string, options?: CommitOptions) =>
    invoke<CommitOutcome>("commit_changes", { path, message, options: options ?? null }),
  /** Read a working-tree file's full text. Returns `missing: true` when the file doesn't exist on disk. */
  readWorkingFile: (path: string, file: string) =>
    invoke<WorkingFileText>("read_working_file", { path, file }),
  /** Read a file's HEAD blob. Returns `missing: true` when not tracked at HEAD. */
  readHeadFile: (path: string, file: string) =>
    invoke<WorkingFileText>("read_head_file", { path, file }),
  /** Atomically overwrite a working-tree file. */
  writeWorkingFile: (path: string, file: string, content: string) =>
    invoke<void>("write_working_file", { path, file, content }),
  /** v0.13.9 — format a single file in a historical commit as a unified-patch
   *  string (the `git format-patch` / `*.patch` text format). */
  formatCommitFilePatch: (path: string, oid: string, file: string) =>
    invoke<string>("format_commit_file_patch", { path, oid, file }),
  /** v0.13.9 — format a single working-tree file (HEAD → workdir) as a
   *  unified-patch string. */
  formatWorkingFilePatch: (path: string, file: string) =>
    invoke<string>("format_working_file_patch", { path, file }),
  /** v0.13.9 — dry-run: would `patch_text` apply cleanly?
   *  v0.13.25 added `location` so callers can dry-run an Index apply
   *  (line-level staging path) instead of just the working tree. */
  applyPatchCheck: (path: string, patchText: string, opts?: { location?: PatchLocation }) =>
    invoke<void>("apply_patch_check", {
      path,
      patchText,
      location: opts?.location ?? null,
    }),
  /** v0.13.9 — apply `patch_text`. Default location is `work_dir` (just
   *  like the original v0.13.9 behaviour); v0.13.25 added `index` /
   *  `both` for line-level staging. Pair with `reversePatch` from
   *  `@/lib/subsetPatch` to un-apply. */
  applyPatch: (path: string, patchText: string, opts?: { location?: PatchLocation }) =>
    invoke<void>("apply_patch", {
      path,
      patchText,
      location: opts?.location ?? null,
    }),
  /** v0.13.14 — raw bytes of a file at a commit, base64-encoded for image previews. */
  readBlobAtCommit: (path: string, oid: string, file: string) =>
    invoke<BlobPayload>("read_blob_at_commit", { path, oid, file }),
  /** v0.13.14 — raw bytes of a file in the working tree, base64-encoded for image previews. */
  readWorkingBlob: (path: string, file: string) =>
    invoke<BlobPayload>("read_working_blob", { path, file }),
  fetch: (path: string, remote?: string) =>
    invoke<RemoteOpResult>("git_fetch", { path, remote: remote ?? null }),
  pull: (path: string) => invoke<RemoteOpResult>("git_pull", { path }),
  push: (
    path: string,
    opts?: {
      remote?: string;
      branch?: string;
      setUpstream?: boolean;
      /** v0.13.21 — unconditional `git push --force`. Skips the lease check. */
      force?: boolean;
      /**
       * v0.13.21 — `force-with-lease`: caller-known oid of the remote ref. If
       * the server-side ref still matches, the push is promoted to a forced
       * refspec; otherwise the backend returns an `AppError` of kind
       * `StaleLease` and the caller should fetch + retry.
       *
       * Pass `null` (or omit) for a plain non-forced push; pass an oid string
       * for the safer "force only if nothing changed since I last saw it"
       * semantics. Mutually-exclusive with `force: true`.
       */
      expectedRemoteOid?: string | null;
    },
  ) =>
    invoke<RemoteOpResult>("git_push", {
      path,
      remote: opts?.remote ?? null,
      branch: opts?.branch ?? null,
      setUpstream: opts?.setUpstream ?? false,
      force: opts?.force ?? false,
      expectedRemoteOid: opts?.expectedRemoteOid ?? null,
    }),
  submitCredentials: (id: number, username: string, password: string) =>
    invoke<void>("submit_credentials", { id, reply: { username, password } }),
  cancelCredentials: (id: number) => invoke<void>("cancel_credentials", { id }),
  /** v0.13.7 — request a graceful cancel of an in-flight fetch/pull/push.
   *  Idempotent; cancelling a finished op silently no-ops. */
  cancelRemoteOp: (opId: number) => invoke<void>("cancel_remote_op", { opId }),
  stashList: (path: string) => invoke<StashEntry[]>("stash_list", { path }),
  stashSave: (
    path: string,
    opts?: { message?: string; includeUntracked?: boolean; keepIndex?: boolean },
  ) =>
    invoke<string>("stash_save", {
      path,
      message: opts?.message ?? null,
      includeUntracked: opts?.includeUntracked ?? false,
      keepIndex: opts?.keepIndex ?? false,
    }),
  stashApply: (path: string, index: number) => invoke<void>("stash_apply", { path, index }),
  stashPop: (path: string, index: number) => invoke<void>("stash_pop", { path, index }),
  stashDrop: (path: string, index: number) => invoke<void>("stash_drop", { path, index }),
  createBranch: (path: string, name: string, startPoint: string, checkout = false) =>
    invoke<void>("create_branch", { path, name, startPoint, checkout }),
  checkoutBranch: (path: string, name: string) => invoke<void>("checkout_branch", { path, name }),
  checkoutCommit: (path: string, oid: string) => invoke<void>("checkout_commit", { path, oid }),
  deleteBranch: (path: string, name: string) => invoke<void>("delete_branch", { path, name }),
  renameBranch: (path: string, oldName: string, newName: string) =>
    invoke<void>("rename_branch", { path, oldName, newName }),
  createTag: (path: string, name: string, target: string, message?: string) =>
    invoke<void>("create_tag", { path, name, target, message: message ?? null }),
  deleteTag: (path: string, name: string) => invoke<void>("delete_tag", { path, name }),
  /** Detailed list of every tag (annotated + lightweight) sorted newest-first. */
  listTags: (path: string) => invoke<TagInfo[]>("list_tags", { path }),
  /** Push a single tag. `force` uses `+refs/tags/<name>` so an updated/recreated tag overwrites the remote copy. */
  pushTag: (path: string, tagName: string, opts?: { remote?: string; force?: boolean }) =>
    invoke<RemoteOpResult>("git_push_tag", {
      path,
      remote: opts?.remote ?? null,
      tagName,
      force: opts?.force ?? false,
    }),
  /** Push every local tag to a remote (`refs/tags/*:refs/tags/*`, equiv. `git push --tags`). */
  pushAllTags: (path: string, opts?: { remote?: string; force?: boolean }) =>
    invoke<RemoteOpResult>("git_push_all_tags", {
      path,
      remote: opts?.remote ?? null,
      force: opts?.force ?? false,
    }),
  /** Delete a tag on the remote without touching the local one. */
  deleteRemoteTag: (path: string, tagName: string, opts?: { remote?: string }) =>
    invoke<RemoteOpResult>("git_delete_remote_tag", {
      path,
      remote: opts?.remote ?? null,
      tagName,
    }),
  cherryPick: (path: string, oid: string) => invoke<void>("cherry_pick", { path, oid }),
  /** v0.13.26 — batch cherry-pick. Applies `oids` in order, stops on the
   *  first conflict and returns `Stopped { applied, failed_oid, pending }`
   *  so the caller can switch to the merge view + remember the queue tail. */
  cherryPickSequence: (path: string, oids: string[]) =>
    invoke<CherrySequenceOutcome>("cherry_pick_sequence", { path, oids }),
  revertCommit: (path: string, oid: string) => invoke<void>("revert_commit", { path, oid }),
  resetTo: (path: string, oid: string, mode: "soft" | "mixed" | "hard") =>
    invoke<void>("reset_to", { path, oid, mode }),
  reflogList: (path: string, refname?: string) =>
    invoke<ReflogEntry[]>("reflog_list", { path, refname: refname ?? null }),
  submoduleList: (path: string) => invoke<SubmoduleInfo[]>("submodule_list", { path }),
  submoduleInit: (path: string, name: string) => invoke<void>("submodule_init", { path, name }),
  submoduleUpdate: (path: string, name: string, initFirst = true) =>
    invoke<void>("submodule_update", { path, name, initFirst }),
  /** v0.13.11 — like `submoduleUpdate` but recurses into the just-updated
   *  submodule's own `.gitmodules`, mirroring `git submodule update --recursive`. */
  submoduleUpdateRecursive: (path: string, name: string, initFirst = true) =>
    invoke<void>("submodule_update_recursive", { path, name, initFirst }),
  submoduleSync: (path: string, name: string) => invoke<void>("submodule_sync", { path, name }),
  configGet: (path: string, key: string) => invoke<string | null>("config_get", { path, key }),
  configSet: (path: string, key: string, value: string, scope: "local" | "global" = "local") =>
    invoke<void>("config_set", { path, key, value, scope }),
  rebasePlan: (path: string, baseOid: string) =>
    invoke<RebaseStep[]>("rebase_plan", { path, baseOid }),
  rebaseStart: (path: string, baseOid: string, steps: RebaseStep[]) =>
    invoke<RebaseStatus>("rebase_start", { path, baseOid, steps }),
  rebaseNext: (path: string) => invoke<RebaseStatus>("rebase_next", { path }),
  rebaseContinue: (path: string) => invoke<RebaseStatus>("rebase_continue", { path }),
  rebaseAbort: (path: string) => invoke<RebaseStatus>("rebase_abort", { path }),
  rebaseStatus: (path: string) => invoke<RebaseStatus>("rebase_status", { path }),
  worktreeList: (path: string) => invoke<WorktreeInfo[]>("worktree_list", { path }),
  worktreeAdd: (path: string, name: string, targetPath: string, branch?: string) =>
    invoke<WorktreeInfo>("worktree_add", {
      path,
      name,
      targetPath,
      branch: branch ?? null,
    }),
  worktreeRemove: (path: string, name: string, force = false) =>
    invoke<void>("worktree_remove", { path, name, force }),
  worktreePrune: (path: string) => invoke<string[]>("worktree_prune", { path }),
  gitignoreRead: (path: string) => invoke<string>("gitignore_read", { path }),
  gitignoreWrite: (path: string, contents: string) =>
    invoke<void>("gitignore_write", { path, contents }),
  gitignorePreview: (path: string, candidate: string) =>
    invoke<IgnorePreview>("gitignore_preview", { path, candidate }),
  gitignoreTemplates: () => invoke<GitignoreTemplate[]>("gitignore_templates"),
  searchCommits: (
    path: string,
    pattern: string,
    opts?: {
      mode?: SearchMode;
      patternKind?: PatternKind;
      caseSensitive?: boolean;
      pathspec?: string;
      maxCommits?: number;
      maxHits?: number;
    },
  ) =>
    invoke<SearchSummary>("search_commits", {
      path,
      pattern,
      mode: opts?.mode ?? "both",
      patternKind: opts?.patternKind ?? "literal",
      caseSensitive: opts?.caseSensitive ?? false,
      pathspec: opts?.pathspec ?? null,
      maxCommits: opts?.maxCommits ?? null,
      maxHits: opts?.maxHits ?? null,
    }),
  statsOverview: (
    path: string,
    since?: number | null,
    until?: number | null,
    branch?: string | null,
    author?: string | null,
    mergeByName?: boolean,
  ) =>
    invoke<StatsOverview>("git_stats_overview", {
      path,
      since: since ?? null,
      until: until ?? null,
      branch: branch ?? null,
      author: author ?? null,
      mergeByName: mergeByName ?? null,
    }),
  statsBranches: (path: string, since?: number | null, until?: number | null) =>
    invoke<StatsBranches>("git_stats_branches", {
      path,
      since: since ?? null,
      until: until ?? null,
    }),
  statsChurn: (
    path: string,
    since?: number | null,
    until?: number | null,
    branch?: string | null,
    author?: string | null,
    mergeByName?: boolean,
  ) =>
    invoke<StatsChurn>("git_stats_churn", {
      path,
      since: since ?? null,
      until: until ?? null,
      branch: branch ?? null,
      author: author ?? null,
      mergeByName: mergeByName ?? null,
    }),
};
