/**
 * Pure aggregation helpers for the Search v2 view.
 *
 * The backend already returns per-commit results (`SearchHit[]`) with
 * per-line diff matches inside each. v1's UI rendered that 1:1, but for
 * IDEA-style "find in path" workflows users want a **file-rollup** instead:
 * "show me each file once, with the commits that touched it underneath".
 *
 * `aggregateByFile` is that rollup. It walks every hit's `diff_hits`,
 * groups them by `file`, and orders files by total hit count (descending).
 * Within each file we keep the per-commit nesting so the right pane can
 * still show "commit X added line N, commit Y removed line M".
 *
 * The helper is a pure function so it's trivial to unit-test and cheap to
 * memoise inside the React view via `useMemo`.
 */

import type { DiffHit, SearchHit } from "@/ipc/git";

export interface FileGroupCommit {
  oid: string;
  short_oid: string;
  summary: string;
  author_name: string;
  /** unix seconds */
  time: number;
  /** Lines from this commit that touched the file. */
  lines: DiffHit[];
}

export interface FileGroup {
  file: string;
  /** Commits that touched this file, newest first (matches backend walk order). */
  commits: FileGroupCommit[];
  /** Total `+`/`-` line hits across all commits — drives the badge + sort key. */
  totalLines: number;
}

/**
 * Group all `+`/`-` diff hits across `searchHits` by file path. Order:
 *
 * 1. Files with more total hits first (most "interesting" by volume).
 * 2. Within each file, commits in the original walk order (newest first).
 *
 * Commits that ONLY have a message-match (no diff hits) are intentionally
 * dropped from the rollup — file view is about content, not metadata.
 */
export function aggregateByFile(searchHits: readonly SearchHit[]): FileGroup[] {
  const byFile = new Map<string, FileGroup>();

  for (const commit of searchHits) {
    if (commit.diff_hits.length === 0) continue;

    // Sub-bucket by file *within this commit* so the same commit doesn't
    // appear twice under the same file (every line goes into one entry).
    const perFile = new Map<string, DiffHit[]>();
    for (const line of commit.diff_hits) {
      const arr = perFile.get(line.file);
      if (arr) arr.push(line);
      else perFile.set(line.file, [line]);
    }

    for (const [file, lines] of perFile) {
      let group = byFile.get(file);
      if (!group) {
        group = { file, commits: [], totalLines: 0 };
        byFile.set(file, group);
      }
      group.commits.push({
        oid: commit.oid,
        short_oid: commit.short_oid,
        summary: commit.summary,
        author_name: commit.author_name,
        time: commit.time,
        lines,
      });
      group.totalLines += lines.length;
    }
  }

  return Array.from(byFile.values()).sort((a, b) => {
    // Sort: total hits desc, then file path asc for stable display.
    if (b.totalLines !== a.totalLines) return b.totalLines - a.totalLines;
    return a.file.localeCompare(b.file);
  });
}

/** Total commits referenced across all groups (deduped by oid). */
export function uniqueCommitCount(groups: readonly FileGroup[]): number {
  const seen = new Set<string>();
  for (const g of groups) {
    for (const c of g.commits) seen.add(c.oid);
  }
  return seen.size;
}
