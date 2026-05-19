/**
 * Word-level diff: produce two arrays of tokens with classification.
 *
 * Tokens are split on word boundaries: \w+ chunks vs single non-word chars.
 * The algorithm is a classic LCS via dynamic programming. For typical diff
 * line sizes (a few hundred chars) this is fast enough.
 */

export type WordKind = "same" | "del" | "add";

export interface WordToken {
  text: string;
  kind: WordKind;
}

export interface WordDiffResult {
  /** tokens to render on the OLD/left side ("same" + "del") */
  left: WordToken[];
  /** tokens to render on the NEW/right side ("same" + "add") */
  right: WordToken[];
}

function tokenize(s: string): string[] {
  // Match: word runs, whitespace runs, or single non-word char.
  // This keeps word identity while still highlighting punctuation changes.
  const out: string[] = [];
  const re = /[A-Za-z0-9_]+|[ \t]+|./g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[0]);
  return out;
}

export function wordDiff(oldStr: string, newStr: string): WordDiffResult {
  const a = tokenize(oldStr);
  const b = tokenize(newStr);

  // LCS DP table.
  const m = a.length;
  const n = b.length;
  // Use Uint16Array for compactness; lengths in practice are small.
  const dp = new Uint16Array((m + 1) * (n + 1));
  const w = n + 1;
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i * w + j] = dp[(i + 1) * w + (j + 1)] + 1;
      } else {
        const down = dp[(i + 1) * w + j];
        const right = dp[i * w + (j + 1)];
        dp[i * w + j] = down > right ? down : right;
      }
    }
  }

  // Backtrack to produce ops.
  type Op = { kind: "same" | "del" | "add"; text: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      ops.push({ kind: "del", text: a[i] });
      i++;
    } else {
      ops.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) ops.push({ kind: "del", text: a[i++] });
  while (j < n) ops.push({ kind: "add", text: b[j++] });

  // Coalesce adjacent ops of the same kind for fewer DOM nodes.
  const merged: Op[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.kind === op.kind) last.text += op.text;
    else merged.push({ ...op });
  }

  const left: WordToken[] = merged
    .filter((o) => o.kind !== "add")
    .map((o) => ({ text: o.text, kind: o.kind === "del" ? "del" : "same" }));
  const right: WordToken[] = merged
    .filter((o) => o.kind !== "del")
    .map((o) => ({ text: o.text, kind: o.kind === "add" ? "add" : "same" }));
  return { left, right };
}
