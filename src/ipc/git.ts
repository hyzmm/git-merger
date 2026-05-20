/**
 * Strongly-typed wrappers around Tauri `invoke` for our Git backend.
 * Keep all Rust command names + payload shapes here, never elsewhere.
 */
import { invoke } from "@tauri-apps/api/core";

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

/** Backend → frontend progress events on `git://progress`. */
export type ProgressEvent =
  | { phase: "sideband"; message: string }
  | { phase: "receiving"; received: number; total: number; bytes: number }
  | { phase: "indexing"; indexed: number; total: number }
  | { phase: "pushing"; pushed: number; total: number }
  | { phase: "push-status"; refname: string; status: string | null }
  | { phase: "done"; ok: boolean; summary: string };

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
  commitFiles: (path: string, oid: string) => invoke<FileChange[]>("commit_files", { path, oid }),
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
  commitChanges: (path: string, message: string) =>
    invoke<string>("commit_changes", { path, message }),
  fetch: (path: string, remote?: string) =>
    invoke<RemoteOpResult>("git_fetch", { path, remote: remote ?? null }),
  pull: (path: string) => invoke<RemoteOpResult>("git_pull", { path }),
  push: (path: string, opts?: { remote?: string; branch?: string; setUpstream?: boolean }) =>
    invoke<RemoteOpResult>("git_push", {
      path,
      remote: opts?.remote ?? null,
      branch: opts?.branch ?? null,
      setUpstream: opts?.setUpstream ?? false,
    }),
  submitCredentials: (id: number, username: string, password: string) =>
    invoke<void>("submit_credentials", { id, reply: { username, password } }),
  cancelCredentials: (id: number) => invoke<void>("cancel_credentials", { id }),
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
  cherryPick: (path: string, oid: string) => invoke<void>("cherry_pick", { path, oid }),
  revertCommit: (path: string, oid: string) => invoke<void>("revert_commit", { path, oid }),
  resetTo: (path: string, oid: string, mode: "soft" | "mixed" | "hard") =>
    invoke<void>("reset_to", { path, oid, mode }),
  reflogList: (path: string, refname?: string) =>
    invoke<ReflogEntry[]>("reflog_list", { path, refname: refname ?? null }),
  submoduleList: (path: string) => invoke<SubmoduleInfo[]>("submodule_list", { path }),
  submoduleInit: (path: string, name: string) => invoke<void>("submodule_init", { path, name }),
  submoduleUpdate: (path: string, name: string, initFirst = true) =>
    invoke<void>("submodule_update", { path, name, initFirst }),
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
};
