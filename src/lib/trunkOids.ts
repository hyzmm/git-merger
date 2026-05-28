/**
 * v0.13.29 B-4 — derive an ordered "trunk hint" list of commit oids
 * from the repo's `RefEntry` list, suitable for feeding to
 * {@link import("./graph").extendLayout} via its `trunkOids` option.
 *
 * Rationale: the lane allocator wants to anchor a small handful of
 * "structurally important" commits to low column indices (HEAD, main,
 * develop, …). Picking which oids count as trunk is a UI / repo
 * convention question that has no business living inside the layout
 * algorithm itself, so we keep it here, behind a pure function that's
 * trivial to unit-test.
 *
 * Priority order (first wins col 0, second wins col 1, …):
 *   1. HEAD's oid (always — the user's current focus belongs leftmost)
 *   2. main / master  (only one survives if both exist; main wins)
 *   3. develop / dev
 *   4. trunk
 *
 * De-duplicated by oid: when HEAD points at `main` (very common), we
 * don't double-list the same oid; HEAD stays at index 0 and `main` is
 * dropped because the first occurrence already claims col 0.
 *
 * IMPORTANT: this is best-effort guidance. The allocator (graph.ts)
 * never evicts a lane to honour a hint, so passing a longer list than
 * the layout can satisfy is harmless — extra hints simply don't fire.
 * See `graph.ts` "Trunk lane anchoring" for the no-eviction rule.
 */

import type { RefEntry } from "@/ipc/git";

/**
 * Local-branch short names that should be anchored as trunks, in
 * decreasing priority. Lower-cased for case-insensitive matching.
 * Listed here (and not in i18n) because these names are git
 * conventions, not user-facing copy.
 */
const TRUNK_NAMES_BY_PRIORITY = ["main", "master", "develop", "dev", "trunk"] as const;

export function computeTrunkOids(refs: readonly RefEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (oid: string | null | undefined): void => {
    if (!oid) return;
    if (seen.has(oid)) return;
    seen.add(oid);
    out.push(oid);
  };

  // 1) HEAD first — covers detached HEAD too (whichever local ref has
  //    is_head=true, or a commit oid the backend surfaces another way).
  for (const r of refs) {
    if (r.is_head && r.target) {
      push(r.target);
      break; // exactly one HEAD
    }
  }

  // 2..N) Trunk-name candidates, in convention order. We only consider
  // *local* branches — a remote-only main (origin/main without a local
  // tracking branch) shouldn't anchor a column because it doesn't
  // typically appear in the visible history walk anyway.
  for (const wanted of TRUNK_NAMES_BY_PRIORITY) {
    for (const r of refs) {
      if (r.kind !== "local_branch") continue;
      if (r.name.toLowerCase() !== wanted) continue;
      push(r.target);
      break; // at most one local branch per name
    }
  }

  return out;
}
