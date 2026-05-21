import { describe, expect, test } from "bun:test";
import {
  pushRecent,
  removeSaved,
  snapshotKey,
  upsertSaved,
  type SavedSearch,
  type SearchSnapshot,
  MAX_RECENTS,
} from "./searchPersist";

function snap(over: Partial<SearchSnapshot> = {}): SearchSnapshot {
  return {
    query: over.query ?? "TODO",
    mode: over.mode ?? "both",
    patternKind: over.patternKind ?? "literal",
    caseSensitive: over.caseSensitive ?? false,
    pathspec: over.pathspec ?? "",
  };
}

describe("snapshotKey", () => {
  test("two structurally identical snapshots collapse to the same key", () => {
    expect(snapshotKey(snap({ query: "x" }))).toBe(snapshotKey(snap({ query: "x" })));
  });
  test("any axis change produces a different key", () => {
    const base = snap({ query: "x" });
    expect(snapshotKey(base)).not.toBe(snapshotKey({ ...base, query: "y" }));
    expect(snapshotKey(base)).not.toBe(snapshotKey({ ...base, mode: "diff" }));
    expect(snapshotKey(base)).not.toBe(snapshotKey({ ...base, patternKind: "regex" }));
    expect(snapshotKey(base)).not.toBe(snapshotKey({ ...base, caseSensitive: true }));
    expect(snapshotKey(base)).not.toBe(snapshotKey({ ...base, pathspec: "src/" }));
  });
});

describe("pushRecent", () => {
  test("adds a fresh snapshot at the head", () => {
    const out = pushRecent([], snap({ query: "x" }));
    expect(out.length).toBe(1);
    expect(out[0]!.query).toBe("x");
  });

  test("re-running an identical snapshot bumps it back to the head (no duplicate)", () => {
    const a = snap({ query: "a" });
    const b = snap({ query: "b" });
    let recents: SearchSnapshot[] = pushRecent([], a);
    recents = pushRecent(recents, b);
    recents = pushRecent(recents, a);
    expect(recents.map((r) => r.query)).toEqual(["a", "b"]);
  });

  test("ignores empty queries", () => {
    expect(pushRecent([], snap({ query: "" }))).toEqual([]);
    expect(pushRecent([], snap({ query: "   " }))).toEqual([]);
  });

  test("caps at MAX_RECENTS, oldest entries fall off", () => {
    let recents: SearchSnapshot[] = [];
    for (let i = 0; i < MAX_RECENTS + 5; i++) {
      recents = pushRecent(recents, snap({ query: `q${i}` }));
    }
    expect(recents.length).toBe(MAX_RECENTS);
    // Most recent push wins the head slot.
    expect(recents[0]!.query).toBe(`q${MAX_RECENTS + 4}`);
    // The earliest queries (q0..q4) should have been evicted.
    expect(recents.map((r) => r.query)).not.toContain("q0");
  });

  test("queries differing only by mode are kept separately", () => {
    let recents: SearchSnapshot[] = [];
    recents = pushRecent(recents, snap({ query: "x", mode: "both" }));
    recents = pushRecent(recents, snap({ query: "x", mode: "diff" }));
    expect(recents.length).toBe(2);
  });
});

describe("upsertSaved", () => {
  test("inserts a new entry at the head", () => {
    const out = upsertSaved([], { ...snap(), name: "first", savedAt: 1 });
    expect(out.length).toBe(1);
    expect(out[0]!.name).toBe("first");
  });

  test("replaces an entry with the same name (idempotent updates)", () => {
    let saved: SavedSearch[] = [];
    saved = upsertSaved(saved, { ...snap({ query: "old" }), name: "TODOs", savedAt: 1 });
    saved = upsertSaved(saved, { ...snap({ query: "new" }), name: "TODOs", savedAt: 2 });
    expect(saved.length).toBe(1);
    expect(saved[0]!.query).toBe("new");
    expect(saved[0]!.savedAt).toBe(2);
  });

  test("trims whitespace from the name", () => {
    const out = upsertSaved([], { ...snap(), name: "   spaced   ", savedAt: 1 });
    expect(out[0]!.name).toBe("spaced");
  });

  test("rejects empty / whitespace-only names", () => {
    expect(() => upsertSaved([], { ...snap(), name: "", savedAt: 1 })).toThrow(
      /name cannot be empty/,
    );
    expect(() => upsertSaved([], { ...snap(), name: "   ", savedAt: 1 })).toThrow(
      /name cannot be empty/,
    );
  });

  test("most-recently-saved entry sits at the head", () => {
    let saved: SavedSearch[] = [];
    saved = upsertSaved(saved, { ...snap(), name: "first", savedAt: 1 });
    saved = upsertSaved(saved, { ...snap(), name: "second", savedAt: 2 });
    expect(saved.map((s) => s.name)).toEqual(["second", "first"]);
  });
});

describe("removeSaved", () => {
  test("drops the entry with the given name", () => {
    const saved: SavedSearch[] = [
      { ...snap(), name: "a", savedAt: 1 },
      { ...snap(), name: "b", savedAt: 2 },
    ];
    expect(removeSaved(saved, "a").map((s) => s.name)).toEqual(["b"]);
  });

  test("is a no-op when the name is unknown", () => {
    const saved: SavedSearch[] = [{ ...snap(), name: "a", savedAt: 1 }];
    expect(removeSaved(saved, "missing")).toEqual(saved);
  });
});
