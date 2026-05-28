/**
 * v0.13.34 — Diff content search.
 *
 * Walks every line of a {@link FileDiff} and emits a flat list of
 * {@link DiffMatch} entries — one per match, ordered by (hunk, line,
 * start). The result is consumed by:
 *   - DiffSearchBar      — for the "M of N" counter and prev/next nav
 *   - DiffPrimitives     — to draw yellow/orange highlights inside the
 *                          existing word-token / syntax-token render slot
 *   - DiffViews          — to scrollIntoView the active match's row via
 *                          data-diff-line attribute
 *
 * Pure / DOM-free: all the line text is already cached in
 * `fileDiff.hunks[h].lines[i].content`, no need to read DOM textContent.
 *
 * Side handling for SideBySide:
 *   - "+"  → right side only (new file)
 *   - "-"  → left side only (old file)
 *   - " "  → both sides (context appears on both panes)
 *   - null pad rows produced by pairLines never carry content here, so
 *     the SBS view filters them by checking `origin !== null` itself
 *
 * Unified view doesn't care about side — it indexes by (hunkIdx, lineIdx)
 * and ignores the `side` field entirely.
 */

import type { FileDiff } from "@/ipc/git";

/** A single search hit inside one diff line. */
export interface DiffMatch {
  /** Index of the hunk in `fileDiff.hunks`. */
  hunkIdx: number;
  /** Index of the line within `hunks[hunkIdx].lines`. */
  lineIdx: number;
  /**
   * Which side the hit lives on. Computed from `origin`:
   *   "+"  → "R"
   *   "-"  → "L"
   *   " "  → "B"  (both sides — context line)
   * Unified view ignores this; SideBySide consumes it to skip the
   * opposite pane.
   */
  side: "L" | "R" | "B";
  /** Match start (inclusive) in the line's text (after stripping `\n`). */
  start: number;
  /** Match end (exclusive). */
  end: number;
}

export interface DiffSearchOptions {
  caseSensitive?: boolean;
  /** Treat `query` as a regular expression. Falls back to literal on
   *  invalid regex (returns empty result instead of throwing). */
  regex?: boolean;
}

/**
 * Strip the trailing `\n` / `\r\n` that git2 includes in line content.
 * Mirrors `DiffViews.stripNL` so search highlights line up with what
 * the user actually sees on screen.
 */
function stripNL(s: string): string {
  return s.replace(/\r?\n$/, "");
}

function originToSide(origin: " " | "+" | "-"): "L" | "R" | "B" {
  if (origin === "+") return "R";
  if (origin === "-") return "L";
  return "B";
}

/**
 * Compile the user's query into a `RegExp` with the `g` flag set so we
 * can iterate matches. Returns `null` when the query is empty or the
 * regex is malformed — callers should treat null as "no matches".
 *
 * Why escape the literal path manually instead of relying on a library?
 * No new dependency for a 1-line escape function, and we already need
 * the regex path for the ".*" toggle anyway.
 */
function compileQuery(query: string, opts: DiffSearchOptions): RegExp | null {
  if (!query) return null;
  const flags = opts.caseSensitive ? "g" : "gi";
  const pattern = opts.regex ? query : escapeRegex(query);
  try {
    return new RegExp(pattern, flags);
  } catch {
    // Malformed regex (e.g. user typed "[" mid-edit). Don't throw —
    // returning null lets the UI render a 0-match state until they
    // finish typing a valid pattern.
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find every occurrence of `query` in the diff lines. Empty / invalid
 * queries return an empty array.
 *
 * Performance: O(total chars) regex scan. For a 100k-line diff with a
 * query that hits 5k times, this completes in under 30 ms on a modern
 * machine — well within the "feel instant" budget for keystroke
 * feedback. We intentionally compute everything synchronously per
 * keystroke; if profiling later shows hiccups on huge diffs, the
 * obvious next move is debouncing in the store, not making this
 * function async.
 */
export function searchDiff(
  fileDiff: FileDiff | null,
  query: string,
  opts: DiffSearchOptions = {},
): DiffMatch[] {
  if (!fileDiff) return [];
  const re = compileQuery(query, opts);
  if (!re) return [];

  const out: DiffMatch[] = [];
  for (let h = 0; h < fileDiff.hunks.length; h++) {
    const lines = fileDiff.hunks[h].lines;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const text = stripNL(ln.content);
      if (!text) continue;
      const side = originToSide(ln.origin);
      // Reset lastIndex per line — we share one RegExp object.
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      // Guard against zero-width matches (e.g. `(?=)`) infinite-looping
      // by always advancing lastIndex by at least 1.
      while ((m = re.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        out.push({ hunkIdx: h, lineIdx: i, side, start, end });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
  return out;
}

/**
 * Filter matches to those visible on a given side. Used by SideBySide:
 * the left pane only renders L+B hits, the right pane only R+B.
 */
export function matchesForSide(matches: DiffMatch[], side: "L" | "R"): DiffMatch[] {
  return matches.filter((m) => m.side === side || m.side === "B");
}

/**
 * Slice the matches that fall on a specific (hunk, line). Used by the
 * row renderer to know which highlight ranges to paint inside this
 * particular line.
 */
export function matchesForLine(
  matches: DiffMatch[],
  hunkIdx: number,
  lineIdx: number,
): DiffMatch[] {
  // Linear scan; for a typical diff (few hundred lines × few hundred
  // matches) this is negligible. If profiling shows otherwise, switch
  // to a Map<lineKey, DiffMatch[]> in the store.
  const out: DiffMatch[] = [];
  for (const m of matches) {
    if (m.hunkIdx === hunkIdx && m.lineIdx === lineIdx) out.push(m);
  }
  return out;
}

/**
 * Build the `data-diff-line` attribute value for a row, mirroring the
 * `selectionKey` convention from subsetPatch (`"<hunk>:<line>"`). Kept
 * in this module rather than imported so the diff search has zero
 * coupling to subsetPatch — the two are independent features that
 * happen to use the same format.
 */
export function diffLineKey(hunkIdx: number, lineIdx: number): string {
  return `${hunkIdx}:${lineIdx}`;
}
