/**
 * Persistence layer for Search v2's "recent queries" and "saved searches".
 *
 * Both lists live in `localStorage` so they survive app restarts. The store
 * is the single source of truth at runtime; this module is just a typed
 * read/write wrapper plus the small amount of insertion logic that's worth
 * unit-testing in isolation.
 *
 * Design choices:
 * - Recents are deduped on a **structural key** (mode + kind + case + path
 *   + query). Re-running an identical search bumps it back to the top
 *   instead of creating a duplicate row.
 * - Saved searches are user-named so they can survive minor query edits;
 *   they're stored as a list, indexed by name, with later entries winning
 *   on conflict so `upsertSaved` is idempotent.
 * - `MAX_RECENTS` caps the recent list so the dropdown stays scannable;
 *   older entries silently fall off the tail.
 */

import type { PatternKind, SearchMode } from "@/ipc/git";

/** Structural snapshot of a search the user actually ran. */
export interface SearchSnapshot {
  query: string;
  mode: SearchMode;
  patternKind: PatternKind;
  caseSensitive: boolean;
  pathspec: string;
}

/** Snapshot + a user-given label, for the saved-searches drawer. */
export interface SavedSearch extends SearchSnapshot {
  /** Free-form user label. Required and trimmed. */
  name: string;
  /** Unix milliseconds at last upsert; lets the UI show "saved 3 days ago". */
  savedAt: number;
}

export const RECENTS_KEY = "gittools.search.recents";
export const SAVED_KEY = "gittools.search.saved";
export const MAX_RECENTS = 12;
export const MAX_SAVED = 50;

/**
 * Canonical structural identity of a snapshot — two snapshots are
 * "the same search" iff this string matches.
 */
export function snapshotKey(s: SearchSnapshot): string {
  return [s.query, s.mode, s.patternKind, s.caseSensitive ? "1" : "0", s.pathspec].join("\u0000");
}

/**
 * Insert (or bump) a snapshot at the head of `recents`. Anything matching
 * the snapshot's structural key is removed first, so re-running an
 * identical search just bumps it back to the top instead of duplicating.
 * The result is capped at `MAX_RECENTS`.
 */
export function pushRecent(
  recents: readonly SearchSnapshot[],
  snap: SearchSnapshot,
): SearchSnapshot[] {
  if (snap.query.trim().length === 0) return [...recents];
  const key = snapshotKey(snap);
  const next: SearchSnapshot[] = [snap];
  for (const r of recents) {
    if (snapshotKey(r) === key) continue;
    next.push(r);
    if (next.length >= MAX_RECENTS) break;
  }
  return next;
}

/**
 * Insert or replace a saved search by name. Trims the name; throws on
 * empty input. The list is capped at `MAX_SAVED` (oldest entries lose).
 */
export function upsertSaved(saved: readonly SavedSearch[], entry: SavedSearch): SavedSearch[] {
  const trimmedName = entry.name.trim();
  if (trimmedName.length === 0) {
    throw new Error("saved search name cannot be empty");
  }
  const incoming: SavedSearch = { ...entry, name: trimmedName };
  const filtered = saved.filter((s) => s.name !== trimmedName);
  filtered.unshift(incoming);
  return filtered.slice(0, MAX_SAVED);
}

/** Remove the saved entry with the given name (no-op when absent). */
export function removeSaved(saved: readonly SavedSearch[], name: string): SavedSearch[] {
  return saved.filter((s) => s.name !== name);
}

// ---------- localStorage glue (skipped during unit tests) ----------

function safeReadJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / SecurityError / private mode — drop silently.
  }
}

/** Validate at-rest data. Anything malformed is dropped. */
function isValidSnapshot(x: unknown): x is SearchSnapshot {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.query === "string" &&
    (o.mode === "both" || o.mode === "message" || o.mode === "diff") &&
    (o.patternKind === "literal" || o.patternKind === "regex") &&
    typeof o.caseSensitive === "boolean" &&
    typeof o.pathspec === "string"
  );
}

function isValidSaved(x: unknown): x is SavedSearch {
  return (
    isValidSnapshot(x) &&
    typeof (x as { name?: unknown }).name === "string" &&
    typeof (x as { savedAt?: unknown }).savedAt === "number"
  );
}

export function loadRecents(): SearchSnapshot[] {
  const raw = safeReadJson<unknown[]>(RECENTS_KEY, []);
  return raw.filter(isValidSnapshot).slice(0, MAX_RECENTS);
}

export function saveRecents(recents: readonly SearchSnapshot[]): void {
  safeWriteJson(RECENTS_KEY, recents.slice(0, MAX_RECENTS));
}

export function loadSaved(): SavedSearch[] {
  const raw = safeReadJson<unknown[]>(SAVED_KEY, []);
  return raw.filter(isValidSaved).slice(0, MAX_SAVED);
}

export function saveSaved(saved: readonly SavedSearch[]): void {
  safeWriteJson(SAVED_KEY, saved.slice(0, MAX_SAVED));
}
