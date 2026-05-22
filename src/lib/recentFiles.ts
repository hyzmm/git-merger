/**
 * Recent files MRU per-repository (v0.13.8 — backlog #2).
 *
 * Design notes
 * ------------
 * - **Per-repo, not global.** Recent file `src/foo.ts` in repo A is
 *   irrelevant in repo B and would just be noise. We key by a hash
 *   of the repo's absolute workdir so different paths to the same
 *   repo (eg. on/off the symlink) collide cleanly.
 * - **Action-tagged.** Each entry remembers HOW the user opened the
 *   file (`diff` / `working` / `blame` / `history`). Re-opening the
 *   same path with the same action just bumps the timestamp instead
 *   of duplicating; opening with a *different* action keeps the
 *   newer one (the most recent action wins). This matches IntelliJ
 *   Recent Files which lists "Foo.java (Edit)" / "Foo.java (Diff)"
 *   as separate rows.
 *
 * Wait — actually no. For our 4 entry points, the file *is* the
 * unit of interest, and the action-on-Enter is configurable from
 * the palette. So we dedup purely on `path`; the `action` field
 * just records what the user last did with it for display.
 *
 * - **Cap** at MAX (12) entries. Older ones silently drop.
 * - **Validation strict on read**, lossy on write (we only persist
 *   the fields we know about).
 *
 * Pure helpers (`pushRecent`, `loadFor`, `saveFor`) are unit-tested
 * in isolation; the store glue lives in `stores/app.ts`.
 */

/** How the file was last opened. Drives the icon shown in the palette
 *  and is used as the default "Enter" action when re-opening. */
export type RecentAction = "diff" | "working" | "blame" | "history";

export interface RecentFile {
  /** Repo-relative file path. */
  path: string;
  /** What the user did with the file most recently. */
  action: RecentAction;
  /** Unix milliseconds when the entry was last bumped. */
  openedAt: number;
}

export const MAX_RECENT_FILES = 12;
const KEY_PREFIX = "gittools.recent-files.v1.";

/**
 * Stable repo key for the localStorage namespace. We hash so the key
 * doesn't expose a long absolute path (cosmetic) and to dedupe paths
 * that differ only by trailing slash / backslash. djb2 is fine here —
 * we just need a stable bucket, not crypto.
 */
export function repoKey(repoPath: string): string {
  const normalized = repoPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h + normalized.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function storageKey(repoPath: string): string {
  return KEY_PREFIX + repoKey(repoPath);
}

/**
 * Insert or bump a recent-file entry. Entries match by `path`; matching
 * entries are removed (so the bumped one ends up at the head with the
 * incoming `action` and `openedAt`). Result is capped at MAX.
 */
export function pushRecent(list: readonly RecentFile[], entry: RecentFile): RecentFile[] {
  if (!entry.path.trim()) return [...list];
  const out: RecentFile[] = [{ ...entry }];
  for (const r of list) {
    if (r.path === entry.path) continue;
    out.push(r);
    if (out.length >= MAX_RECENT_FILES) break;
  }
  return out;
}

/**
 * Remove an entry by path. Returns a new list — the original is
 * untouched. No-op if `path` is not in the list.
 */
export function removeRecent(list: readonly RecentFile[], path: string): RecentFile[] {
  return list.filter((r) => r.path !== path);
}

// ---------- localStorage glue ----------

function isValidEntry(x: unknown): x is RecentFile {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.path === "string" &&
    o.path.length > 0 &&
    (o.action === "diff" ||
      o.action === "working" ||
      o.action === "blame" ||
      o.action === "history") &&
    typeof o.openedAt === "number"
  );
}

export function loadFor(repoPath: string): RecentFile[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(storageKey(repoPath));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry).slice(0, MAX_RECENT_FILES);
  } catch {
    return [];
  }
}

export function saveFor(repoPath: string, list: readonly RecentFile[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(repoPath), JSON.stringify(list.slice(0, MAX_RECENT_FILES)));
  } catch {
    // quota / private mode — drop silently
  }
}

/** Clear the MRU for a single repo (used by tests + a future Settings action). */
export function clearFor(repoPath: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey(repoPath));
  } catch {
    /* ignore */
  }
}
