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
  listRefs: (path: string) => invoke<RefEntry[]>("list_refs", { path }),
};
