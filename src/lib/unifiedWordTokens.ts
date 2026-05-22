/**
 * Word-level diff projection for the **unified** view.
 *
 * `pairLines.ts` already produces aligned add/del pairs for side-by-side.
 * Unified mode keeps lines in their original order, so we re-walk the
 * hunk: every consecutive run of `-` lines followed by a run of `+`
 * lines is treated as a "replace block". Lines inside such a block, up
 * to `min(delCount, addCount)`, get a word-level overlay (the deleted
 * line gets `del`-flavoured tokens; the corresponding added line gets
 * `add`-flavoured tokens). Surplus lines on either side stay plain so
 * pure additions or pure removals don't render misleading "all-add" /
 * "all-del" highlights.
 *
 * Returned object: `tokensByIdx[i] = WordToken[]` indexed by the
 * line's position in `hunkLines`. Lines without an entry render the
 * normal syntax-highlighted content.
 */
import type { DiffLine } from "@/ipc/git";
import { wordDiff, type WordToken } from "@/lib/wordDiff";

function stripNL(s: string): string {
  return s.replace(/\r?\n$/, "");
}

export function unifiedWordTokens(hunkLines: DiffLine[]): Record<number, WordToken[]> {
  const out: Record<number, WordToken[]> = {};

  // Walk runs:  ... `-`* `+`* (interleaved by `+/-` only). A context line
  // (` `) terminates the current replace block.
  let i = 0;
  const n = hunkLines.length;
  while (i < n) {
    if (hunkLines[i].origin !== "-") {
      i++;
      continue;
    }
    // Collect the `-` run.
    const delStart = i;
    while (i < n && hunkLines[i].origin === "-") i++;
    const delEnd = i; // exclusive
    // Collect the immediately-following `+` run.
    const addStart = i;
    while (i < n && hunkLines[i].origin === "+") i++;
    const addEnd = i; // exclusive

    const delCount = delEnd - delStart;
    const addCount = addEnd - addStart;
    const pairCount = Math.min(delCount, addCount);

    // Pair up the first `pairCount` lines of each run by index.
    for (let k = 0; k < pairCount; k++) {
      const delIdx = delStart + k;
      const addIdx = addStart + k;
      const wd = wordDiff(stripNL(hunkLines[delIdx].content), stripNL(hunkLines[addIdx].content));
      out[delIdx] = wd.left;
      out[addIdx] = wd.right;
    }
    // Surplus `-`/`+` lines (no counterpart) intentionally left blank.
  }

  return out;
}
