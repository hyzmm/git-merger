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

export interface GitCmdResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

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

// ---------- Commands ----------
export const git = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
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
    invoke<GitCmdResult>("git_fetch", { path, remote: remote ?? null }),
  pull: (path: string) => invoke<GitCmdResult>("git_pull", { path }),
  push: (path: string, opts?: { remote?: string; branch?: string; setUpstream?: boolean }) =>
    invoke<GitCmdResult>("git_push", {
      path,
      remote: opts?.remote ?? null,
      branch: opts?.branch ?? null,
      setUpstream: opts?.setUpstream ?? false,
    }),
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
};
