/**
 * Tiny fuzzy matcher used by the Command Palette to rank commits / refs /
 * files / actions. The algorithm is a subsequence match (every char in the
 * query must appear in order in the candidate, case-insensitively) plus a
 * heuristic score:
 *
 *   +100 prefix match
 *   +60  match starts at a word boundary
 *   +40  consecutive run with the previous match
 *   +20  case-sensitive char match
 *   -2   per skipped char between matches
 *   -<i> small penalty proportional to where the match starts
 *
 * This is fast enough to score 100k items per keystroke without a worker,
 * and gives results that "feel right" for command-palette UX.
 */

export interface FuzzyResult {
  score: number;
  /** Indices (in the candidate) of every matched query character — for highlighting. */
  matches: number[];
}

const WORD_BOUNDARY = /[/\-_. ]/;

export function fuzzyScore(query: string, candidate: string): FuzzyResult | null {
  if (!query) return { score: 0, matches: [] };
  if (query.length > candidate.length) return null;

  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  const matches: number[] = [];
  let qi = 0;
  let prevIdx = -1;
  let score = 0;

  for (let i = 0; i < c.length && qi < q.length; i++) {
    if (c[i] !== q[qi]) continue;

    // Match found.
    if (i === 0 || prevIdx === -1) {
      score += i === 0 ? 100 : 0;
    }
    if (i > 0 && WORD_BOUNDARY.test(c[i - 1]!)) {
      score += 60;
    }
    if (prevIdx === i - 1) {
      score += 40;
    }
    if (candidate[i] === query[qi]) {
      score += 20; // case-sensitive bonus
    }
    if (prevIdx !== -1) {
      score -= 2 * (i - prevIdx - 1);
    }

    matches.push(i);
    prevIdx = i;
    qi++;
  }

  if (qi !== q.length) return null;

  // Slight penalty for matches starting deep into a long candidate.
  score -= Math.min(matches[0]!, 30);

  return { score, matches };
}

/**
 * Highlight matched characters in `text` with the given `marker` callback,
 * concatenating the result. Used to render <mark> spans in JSX.
 */
export function highlight<T>(
  text: string,
  matches: number[],
  plain: (s: string) => T,
  match: (s: string) => T,
): T[] {
  if (matches.length === 0) return [plain(text)];
  const out: T[] = [];
  let cursor = 0;
  let runStart = matches[0]!;
  let runEnd = runStart;
  for (let i = 1; i <= matches.length; i++) {
    const next = matches[i];
    if (next === runEnd + 1) {
      runEnd = next;
      continue;
    }
    if (cursor < runStart) out.push(plain(text.slice(cursor, runStart)));
    out.push(match(text.slice(runStart, runEnd + 1)));
    cursor = runEnd + 1;
    if (next !== undefined) {
      runStart = next;
      runEnd = next;
    }
  }
  if (cursor < text.length) out.push(plain(text.slice(cursor)));
  return out;
}
