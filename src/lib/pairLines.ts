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
  let oldRun: DiffLine[] = [];
  let newRun: DiffLine[] = [];

  function flush() {
    const min = Math.min(oldRun.length, newRun.length);
    for (let i = 0; i < min; i++) {
      const a = oldRun[i];
      const b = newRun[i];
      const wd = wordDiff(stripNL(a.content), stripNL(b.content));
      out.push({
        oldLineno: a.old_lineno,
        oldOrigin: "-",
        oldContent: a.content,
        newLineno: b.new_lineno,
        newOrigin: "+",
        newContent: b.content,
        leftTokens: wd.left,
        rightTokens: wd.right,
      });
    }
    for (let i = min; i < oldRun.length; i++) {
      const a = oldRun[i];
      out.push({
        oldLineno: a.old_lineno,
        oldOrigin: "-",
        oldContent: a.content,
        newLineno: null,
        newOrigin: null,
        newContent: "",
      });
    }
    for (let i = min; i < newRun.length; i++) {
      const b = newRun[i];
      out.push({
        oldLineno: null,
        oldOrigin: null,
        oldContent: "",
        newLineno: b.new_lineno,
        newOrigin: "+",
        newContent: b.content,
      });
    }
    oldRun = [];
    newRun = [];
  }

  for (const ln of lines) {
    if (ln.origin === "-") oldRun.push(ln);
    else if (ln.origin === "+") newRun.push(ln);
    else {
      flush();
      out.push({
        oldLineno: ln.old_lineno,
        oldOrigin: " ",
        oldContent: ln.content,
        newLineno: ln.new_lineno,
        newOrigin: " ",
        newContent: ln.content,
      });
    }
  }
  flush();
  return out;
}
