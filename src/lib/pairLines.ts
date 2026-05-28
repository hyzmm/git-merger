import type { DiffLine } from "@/ipc/git";
import { wordDiff, type WordToken } from "@/lib/wordDiff";

/** A side-by-side aligned line pair. */
export interface PairedLine {
  oldLineno: number | null;
  oldOrigin: " " | "-" | null;
  oldContent: string;
  newLineno: number | null;
  newOrigin: " " | "+" | null;
  newContent: string;
  /** word-level tokens (computed for replace pairs) */
  leftTokens?: WordToken[];
  rightTokens?: WordToken[];
  /**
   * v0.13.34 — Index of the original `DiffLine` (in the source `hunk.lines`
   * array) that this row's left/right side came from. `null` when the
   * side is a blank pad cell. Needed by features that key off the
   * unfiltered hunk-line index (e.g. content search highlight lookup
   * uses `(hunkIdx, originalLineIdx)` to identify a match's row).
   */
  oldIdx: number | null;
  newIdx: number | null;
}

function stripNL(s: string): string {
  return s.replace(/\r?\n$/, "");
}

/** Pair up DiffLines into aligned PairedLines for side-by-side rendering.
 *
 * Strategy: walk through hunk lines in order. Buffer consecutive '-' (oldRun)
 * and '+' (newRun) groups. When the run ends (hit a context line or end of
 * hunk), zip them by index — overlapping pairs become "replace" rows (and we
 * compute word-diff on them); leftovers become single-side rows. */
export function pairLines(lines: DiffLine[]): PairedLine[] {
  const out: PairedLine[] = [];
  // Each run carries the (line, origIdx) tuple so we can backreference
  // the original hunk-line index from PairedLine.
  let oldRun: { ln: DiffLine; idx: number }[] = [];
  let newRun: { ln: DiffLine; idx: number }[] = [];

  function flush() {
    const min = Math.min(oldRun.length, newRun.length);
    for (let i = 0; i < min; i++) {
      const a = oldRun[i];
      const b = newRun[i];
      const wd = wordDiff(stripNL(a.ln.content), stripNL(b.ln.content));
      out.push({
        oldLineno: a.ln.old_lineno,
        oldOrigin: "-",
        oldContent: a.ln.content,
        oldIdx: a.idx,
        newLineno: b.ln.new_lineno,
        newOrigin: "+",
        newContent: b.ln.content,
        newIdx: b.idx,
        leftTokens: wd.left,
        rightTokens: wd.right,
      });
    }
    for (let i = min; i < oldRun.length; i++) {
      const a = oldRun[i];
      out.push({
        oldLineno: a.ln.old_lineno,
        oldOrigin: "-",
        oldContent: a.ln.content,
        oldIdx: a.idx,
        newLineno: null,
        newOrigin: null,
        newContent: "",
        newIdx: null,
      });
    }
    for (let i = min; i < newRun.length; i++) {
      const b = newRun[i];
      out.push({
        oldLineno: null,
        oldOrigin: null,
        oldContent: "",
        oldIdx: null,
        newLineno: b.ln.new_lineno,
        newOrigin: "+",
        newContent: b.ln.content,
        newIdx: b.idx,
      });
    }
    oldRun = [];
    newRun = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.origin === "-") oldRun.push({ ln, idx: i });
    else if (ln.origin === "+") newRun.push({ ln, idx: i });
    else {
      flush();
      // Context line shows on both sides — record the same idx for
      // both old and new index, since the search engine indexes by
      // hunk-line index regardless of side.
      out.push({
        oldLineno: ln.old_lineno,
        oldOrigin: " ",
        oldContent: ln.content,
        oldIdx: i,
        newLineno: ln.new_lineno,
        newOrigin: " ",
        newContent: ln.content,
        newIdx: i,
      });
    }
  }
  flush();
  return out;
}
