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

// ---------- Commands ----------
export const git = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  log: (path: string, limit = 200, skip = 0) =>
    invoke<CommitSummary[]>("git_log", { path, limit, skip }),
  commitFiles: (path: string, oid: string) => invoke<FileChange[]>("commit_files", { path, oid }),
  fileDiff: (path: string, oid: string, file: string) =>
    invoke<FileDiff>("file_diff", { path, oid, file }),
  workingDiff: (path: string, file: string) => invoke<FileDiff>("working_diff", { path, file }),
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
  workingChanges: (path: string) => invoke<WorkingFile[]>("working_changes", { path }),
  stageFiles: (path: string, paths: string[]) => invoke<void>("stage_files", { path, paths }),
  unstageFiles: (path: string, paths: string[]) => invoke<void>("unstage_files", { path, paths }),
  discardFiles: (path: string, paths: string[]) => invoke<void>("discard_files", { path, paths }),
  commitChanges: (path: string, message: string) =>
    invoke<string>("commit_changes", { path, message }),
};
