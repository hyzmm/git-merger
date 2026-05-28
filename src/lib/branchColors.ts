/**
 * Branch-lane palette (v0.13.23).
 *
 * One source of truth for "what color is this branch" used by both
 * RefsPane (left-side ref list dots) and GraphRow (right-side commit dots
 * + lane lines + curves). Without this shared module the two surfaces
 * drift apart: RefsPane was hashing ref names into a 5-slot CSS-var
 * palette, while GraphRow had its own 6-slot list of hex literals, so a
 * branch could appear in two different colors on the same screen.
 *
 * Color semantics
 * ---------------
 * - Six slots, indexed 0..5, maps directly to `--branch-1..6` defined in
 *   `src/styles/globals.css`. Keep the slot count and the CSS var count in
 *   sync — anything beyond what CSS defines silently falls back to slot 0.
 * - We derive a slot from the *first identifying name* of a lane:
 *     - For a commit at a branch tip, that's the branch short name
 *       (`main`, `feature/foo`, `origin/dev`, …).
 *     - For commits with no ref attached (the 99% case), we hash the oid
 *       so the color is at least stable across re-renders of the same
 *       repo.
 * - The hash is a tiny FNV-style mix; we don't care about cryptographic
 *   distribution, only about (a) identical inputs → identical slot and
 *   (b) common short names spreading across slots reasonably evenly.
 *
 * Why not random / sequential?
 * - Sequential color allocation (the previous behaviour) made `main`
 *   change hue every time a new repo was opened or the History view was
 *   reloaded. Hash-stable colors keep `main` blue from session to
 *   session, which is what Git GUIs like IntelliJ / GitKraken / Sublime
 *   Merge do.
 */

/** Number of palette slots. Keep in sync with `--branch-1..N` in globals.css. */
export const BRANCH_PALETTE_SIZE = 6;

/**
 * CSS color expression for slot `idx`. Always returns a `hsl(var(--branch-N))`
 * string so callers can drop it straight into `style={{ color: ... }}` /
 * `stroke=...` / `fill=...` and have it follow the active light/dark theme.
 */
export function branchColorVar(idx: number): string {
  const n = ((idx % BRANCH_PALETTE_SIZE) + BRANCH_PALETTE_SIZE) % BRANCH_PALETTE_SIZE;
  return `hsl(var(--branch-${n + 1}))`;
}

/**
 * Stable hash of an arbitrary string (ref short name or oid) into a
 * palette slot in [0, BRANCH_PALETTE_SIZE). Identical inputs always
 * yield the same slot, across launches and across the two consumers.
 */
export function branchSlotForName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    // Multiply-by-31 mix, identical to what the JVM uses for String#hashCode
    // — well-trodden + fast + good enough distribution for our handful of
    // ref names. The `| 0` keeps it inside int32 to avoid float drift.
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % BRANCH_PALETTE_SIZE;
}

/**
 * Convenience: hash directly to a color expression. Equivalent to
 * `branchColorVar(branchSlotForName(name))`.
 */
export function branchColorForName(name: string): string {
  return branchColorVar(branchSlotForName(name));
}
