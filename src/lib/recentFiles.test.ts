import { describe, expect, test } from "bun:test";
import {
  MAX_RECENT_FILES,
  pushRecent,
  removeRecent,
  repoKey,
  type RecentFile,
} from "./recentFiles";

function entry(path: string, action: RecentFile["action"] = "diff", t = 0): RecentFile {
  return { path, action, openedAt: t };
}

describe("repoKey", () => {
  test("identical paths produce identical keys", () => {
    expect(repoKey("G:\\GitTools")).toBe(repoKey("G:\\GitTools"));
  });

  test("different paths produce different keys", () => {
    expect(repoKey("G:\\GitTools")).not.toBe(repoKey("G:\\Other"));
  });

  test("normalises slashes and trailing separator", () => {
    // Backslash → forward slash, trailing slash stripped, case-insensitive
    expect(repoKey("G:\\GitTools")).toBe(repoKey("g:/gittools/"));
    expect(repoKey("G:\\GitTools\\")).toBe(repoKey("G:\\GitTools"));
  });

  test("returns 8 hex chars (zero-padded if short)", () => {
    const k = repoKey("/repo");
    expect(k).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("pushRecent", () => {
  test("empty list seeds with the new entry", () => {
    const out = pushRecent([], entry("a.ts"));
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("a.ts");
  });

  test("re-pushing the same path moves it to the head with the new action", () => {
    const list = [entry("a.ts", "blame", 1), entry("b.ts", "diff", 2)];
    const out = pushRecent(list, entry("a.ts", "working", 9));
    expect(out.map((r) => r.path)).toEqual(["a.ts", "b.ts"]);
    expect(out[0].action).toBe("working");
    expect(out[0].openedAt).toBe(9);
  });

  test("blank path is rejected (returns a copy)", () => {
    const list = [entry("a.ts")];
    expect(pushRecent(list, entry("   "))).toEqual(list);
    expect(pushRecent(list, entry(""))).toEqual(list);
  });

  test("caps at MAX_RECENT_FILES, oldest tail entries are evicted", () => {
    let list: RecentFile[] = [];
    // Push MAX+5 distinct files, newest first remains the head.
    for (let i = 0; i < MAX_RECENT_FILES + 5; i++) {
      list = pushRecent(list, entry(`f${i}.ts`, "diff", i));
    }
    expect(list).toHaveLength(MAX_RECENT_FILES);
    // The most recent push should be the head.
    expect(list[0].path).toBe(`f${MAX_RECENT_FILES + 5 - 1}.ts`);
    // The oldest 5 entries should have fallen off the tail.
    const surviving = new Set(list.map((r) => r.path));
    for (let i = 0; i < 5; i++) {
      expect(surviving.has(`f${i}.ts`)).toBe(false);
    }
  });

  test("does not mutate the input list", () => {
    const list = [entry("a.ts")];
    const snapshot = JSON.stringify(list);
    pushRecent(list, entry("b.ts"));
    expect(JSON.stringify(list)).toBe(snapshot);
  });
});

describe("removeRecent", () => {
  test("removes a matching entry", () => {
    const list = [entry("a.ts"), entry("b.ts"), entry("c.ts")];
    expect(removeRecent(list, "b.ts").map((r) => r.path)).toEqual(["a.ts", "c.ts"]);
  });

  test("unknown path is a no-op (returns a copy)", () => {
    const list = [entry("a.ts")];
    const out = removeRecent(list, "zzz");
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
  });
});
