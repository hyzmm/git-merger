/**
 * Persistence layer for v0.13.5's "Tabs v2".
 *
 * What we persist:
 *  - The ordered list of open tabs (id + repoPath + label + pinned).
 *  - Which tab was active at the time of the last write.
 *
 * What we **don't** persist:
 *  - Per-tab session snapshots (history, diff, search… all the heavy
 *    `SessionSnapshot` data). Those cost too much to serialize and are
 *    cheaply rebuilt by re-`openRepo`-ing the path on demand.
 *
 * So a restored tab starts in the "lazy" state — its repoPath is set,
 * but its session is empty until the user actually switches to it,
 * matching the existing behaviour for tabs created via `addTab(path)`.
 *
 * Validation is deliberately strict: anything malformed in localStorage
 * is dropped silently rather than blowing up app start.
 */

export interface PersistedTab {
  id: string;
  /** Empty string for a brand-new blank tab — those are dropped on restore. */
  repoPath: string;
  /** Display label — last segment of repoPath by default. */
  label: string;
  /** When true, the tab is rendered before any non-pinned tab and refuses Ctrl+W. */
  pinned: boolean;
}

export interface PersistedTabs {
  tabs: PersistedTab[];
  activeTabId: string | null;
}

export const TABS_KEY = "gittools.tabs.v1";
export const MAX_TABS = 32;

function isValidTab(x: unknown): x is PersistedTab {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.repoPath === "string" &&
    typeof o.label === "string" &&
    typeof o.pinned === "boolean"
  );
}

/**
 * Load + validate the persisted tab session. Blank tabs (empty repoPath)
 * are excluded — there's no point in restoring "(new)" tabs the user
 * never bound to a repo.
 */
export function loadTabs(): PersistedTabs {
  if (typeof localStorage === "undefined") return { tabs: [], activeTabId: null };
  const raw = localStorage.getItem(TABS_KEY);
  if (!raw) return { tabs: [], activeTabId: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { tabs: [], activeTabId: null };
  }
  if (!parsed || typeof parsed !== "object") return { tabs: [], activeTabId: null };
  const o = parsed as Record<string, unknown>;
  const rawTabs = Array.isArray(o.tabs) ? (o.tabs as unknown[]) : [];
  const tabs = rawTabs
    .filter(isValidTab)
    .filter((t) => t.repoPath.length > 0)
    .slice(0, MAX_TABS);
  // Dedup by repoPath — two tabs to the same repo on disk would just
  // confuse the multi-tab routing. Keep the first occurrence (which is
  // also the leftmost in the bar).
  const seen = new Set<string>();
  const deduped: PersistedTab[] = [];
  for (const t of tabs) {
    if (seen.has(t.repoPath)) continue;
    seen.add(t.repoPath);
    deduped.push(t);
  }
  const activeRaw = typeof o.activeTabId === "string" ? o.activeTabId : null;
  const activeTabId = deduped.some((t) => t.id === activeRaw)
    ? activeRaw
    : (deduped[0]?.id ?? null);
  return { tabs: deduped, activeTabId };
}

export function saveTabs(state: PersistedTabs): void {
  if (typeof localStorage === "undefined") return;
  try {
    const tabs = state.tabs.slice(0, MAX_TABS).map((t) => ({
      id: t.id,
      repoPath: t.repoPath,
      label: t.label,
      pinned: t.pinned,
    }));
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeTabId: state.activeTabId }));
  } catch {
    // Quota / SecurityError / private mode — drop silently.
  }
}

// ---------- pure reorder helpers (unit-tested in isolation) ----------

/**
 * Reorder a tab list by moving the tab at `fromIdx` so it lands at `toIdx`.
 * Pinned tabs always stay before non-pinned ones; if a move would cross
 * the boundary, the affected tab's `pinned` flag flips to match the
 * destination region. This makes drag-into-pinned-zone == "pin", and
 * drag-out-of-pinned-zone == "unpin", which is what most editors do.
 */
export function reorderTabs<T extends { pinned: boolean }>(
  tabs: readonly T[],
  fromIdx: number,
  toIdx: number,
): T[] {
  // `toIdx` semantics: "drop before original index `toIdx`". So toIdx ===
  // tabs.length means "drop at the very end". We always re-partition at
  // the end in case the input list itself violated the invariant.
  if (fromIdx < 0 || fromIdx >= tabs.length) return stablePartitionPinned(tabs);
  if (toIdx < 0 || toIdx > tabs.length) return stablePartitionPinned(tabs);
  if (fromIdx === toIdx || fromIdx + 1 === toIdx) return stablePartitionPinned(tabs);
  const next = tabs.slice();
  const [moved] = next.splice(fromIdx, 1);
  // `toIdx` was indexed against the original list; once we've removed
  // `fromIdx`, indices to its right shift left by one.
  const adjusted = toIdx > fromIdx ? toIdx - 1 : toIdx;
  next.splice(adjusted, 0, moved);

  // Now enforce "all pinned before all non-pinned" by flipping the moved
  // entry to match its new neighbourhood. We look at the entry currently
  // at `adjusted - 1` (left neighbour) and `adjusted + 1` (right) and
  // pick a `pinned` value consistent with both. If the move ended up
  // inside a homogenous run, that run wins; if the move straddles the
  // boundary, we honour the dominant side.
  const left = adjusted > 0 ? next[adjusted - 1] : null;
  const right = adjusted + 1 < next.length ? next[adjusted + 1] : null;
  let newPinned = moved.pinned;
  if (left && right) {
    // Inside a run — both neighbours agree, follow them.
    if (left.pinned === right.pinned) newPinned = left.pinned;
    // Straddling: the user dropped between pinned (left) and non-pinned
    // (right). Inserting *into* the pinned zone means pin; inserting
    // *into* the non-pinned zone means unpin. Treat "between" as joining
    // whichever side the cursor felt closest to — we use the left side
    // (i.e. drop-after-the-last-pinned == still pinned).
    else newPinned = left.pinned;
  } else if (left) {
    newPinned = left.pinned;
  } else if (right) {
    newPinned = right.pinned;
  }
  next[adjusted] = { ...moved, pinned: newPinned };

  // Final defensive sort: stable partition with all pinned first. This
  // also rescues weird input where the persisted list violated the
  // invariant (e.g. older v0.13.4 data didn't have `pinned` at all).
  return stablePartitionPinned(next);
}

/** Stable partition: pinned tabs first, then non-pinned, otherwise preserve order. */
export function stablePartitionPinned<T extends { pinned: boolean }>(tabs: readonly T[]): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const t of tabs) (t.pinned ? pinned : rest).push(t);
  return [...pinned, ...rest];
}

/**
 * Toggle a tab's pinned state, then re-partition so the pinned region
 * stays contiguous on the left.
 */
export function togglePin<T extends { id: string; pinned: boolean }>(
  tabs: readonly T[],
  id: string,
): T[] {
  const next = tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
  return stablePartitionPinned(next);
}

/**
 * Compute the next index when cycling through tabs. Wraps. `dir = +1`
 * is "next" (Ctrl+PageDown / Ctrl+Tab); `dir = -1` is "prev".
 */
export function nextTabId<T extends { id: string }>(
  tabs: readonly T[],
  current: string | null,
  dir: 1 | -1,
): string | null {
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return tabs[0].id;
  const idx = current ? tabs.findIndex((t) => t.id === current) : -1;
  if (idx < 0) return tabs[0].id;
  const len = tabs.length;
  return tabs[(idx + dir + len) % len].id;
}
