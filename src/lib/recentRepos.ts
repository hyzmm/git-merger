/**
 * Persist & retrieve the list of recently opened repositories.
 * Keep at most MAX entries, most-recent first, deduped by path.
 */
const KEY = "gittools.recent-repos";
const MAX = 8;

export interface RecentRepo {
  path: string;
  /** unix ms */
  openedAt: number;
}

export function loadRecent(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is RecentRepo =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as RecentRepo).path === "string" &&
        typeof (x as RecentRepo).openedAt === "number",
    );
  } catch {
    return [];
  }
}

export function pushRecent(path: string): RecentRepo[] {
  const list = loadRecent().filter((r) => r.path !== path);
  list.unshift({ path, openedAt: Date.now() });
  const trimmed = list.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota errors */
  }
  return trimmed;
}

export function removeRecent(path: string): RecentRepo[] {
  const list = loadRecent().filter((r) => r.path !== path);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
