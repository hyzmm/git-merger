/**
 * v0.13.34 — Tests for the diff content search engine.
 */

import { describe, expect, test } from "bun:test";
import { searchDiff, matchesForSide, matchesForLine, diffLineKey } from "./diffSearch";
import type { DiffHunk, DiffLine, FileDiff } from "@/ipc/git";

function line(origin: " " | "+" | "-", content: string): DiffLine {
  return { origin, old_lineno: null, new_lineno: null, content };
}

function hunk(...lines: DiffLine[]): DiffHunk {
  return {
    old_start: 0,
    old_lines: 0,
    new_start: 0,
    new_lines: 0,
    header: "@@ test @@",
    lines,
  };
}

function makeDiff(...hunks: DiffHunk[]): FileDiff {
  return { old_path: "a.txt", new_path: "a.txt", is_binary: false, hunks };
}

describe("searchDiff", () => {
  test("returns no matches for empty query", () => {
    const fd = makeDiff(hunk(line(" ", "hello world\n")));
    expect(searchDiff(fd, "")).toEqual([]);
  });

  test("returns no matches for null fileDiff", () => {
    expect(searchDiff(null, "x")).toEqual([]);
  });

  test("finds a single literal hit (case-insensitive by default)", () => {
    const fd = makeDiff(hunk(line(" ", "Hello World\n")));
    const r = searchDiff(fd, "hello");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ hunkIdx: 0, lineIdx: 0, start: 0, end: 5, side: "B" });
  });

  test("respects caseSensitive option", () => {
    const fd = makeDiff(hunk(line(" ", "Hello hello HELLO\n")));
    expect(searchDiff(fd, "hello", { caseSensitive: false })).toHaveLength(3);
    expect(searchDiff(fd, "hello", { caseSensitive: true })).toHaveLength(1);
  });

  test("multiple hits on one line are all returned in order", () => {
    const fd = makeDiff(hunk(line(" ", "ababa\n")));
    const r = searchDiff(fd, "ab");
    expect(r.map((m) => m.start)).toEqual([0, 2]);
  });

  test("origin maps to side correctly", () => {
    const fd = makeDiff(
      hunk(line("+", "added Z\n"), line("-", "removed Z\n"), line(" ", "context Z\n")),
    );
    const r = searchDiff(fd, "Z");
    expect(r).toHaveLength(3);
    expect(r[0].side).toBe("R");
    expect(r[1].side).toBe("L");
    expect(r[2].side).toBe("B");
  });

  test("trailing newline does not create a phantom hit", () => {
    // Hits past `len(content) - 1` would be wrong — stripNL must run first.
    const fd = makeDiff(hunk(line(" ", "abc\n")));
    const r = searchDiff(fd, "c");
    expect(r).toHaveLength(1);
    expect(r[0].end).toBe(3);
  });

  test("regex mode honours metacharacters", () => {
    const fd = makeDiff(hunk(line(" ", "foo123 bar456\n")));
    const r = searchDiff(fd, "\\d+", { regex: true });
    expect(r.map((m) => [m.start, m.end])).toEqual([
      [3, 6],
      [10, 13],
    ]);
  });

  test("regex mode silently returns [] on invalid pattern (no throw)", () => {
    const fd = makeDiff(hunk(line(" ", "anything\n")));
    expect(() => searchDiff(fd, "[", { regex: true })).not.toThrow();
    expect(searchDiff(fd, "[", { regex: true })).toEqual([]);
  });

  test("literal-mode metacharacters are escaped (no regex behaviour leaks)", () => {
    const fd = makeDiff(hunk(line(" ", "a.b a*b axb\n")));
    // Literal "a.b" should match only "a.b", not "a*b" or "axb".
    const r = searchDiff(fd, "a.b");
    expect(r).toHaveLength(1);
    expect(r[0].start).toBe(0);
  });

  test("zero-width regex doesn't infinite-loop", () => {
    const fd = makeDiff(hunk(line(" ", "abc\n")));
    // /(?=)/g would loop forever without the lastIndex++ guard.
    const r = searchDiff(fd, "(?=)", { regex: true });
    // Should produce one match per char position (4 = 3 chars + end).
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(10);
  });

  test("results are ordered by (hunk, line, start)", () => {
    const fd = makeDiff(
      hunk(line(" ", "x\n"), line(" ", "x x\n")),
      hunk(line(" ", "x x x\n")),
    );
    const r = searchDiff(fd, "x");
    expect(r.map((m) => [m.hunkIdx, m.lineIdx, m.start])).toEqual([
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 2],
      [1, 0, 0],
      [1, 0, 2],
      [1, 0, 4],
    ]);
  });
});

describe("matchesForSide", () => {
  test("left pane gets L + B, drops R", () => {
    const m = [
      { hunkIdx: 0, lineIdx: 0, side: "L" as const, start: 0, end: 1 },
      { hunkIdx: 0, lineIdx: 1, side: "R" as const, start: 0, end: 1 },
      { hunkIdx: 0, lineIdx: 2, side: "B" as const, start: 0, end: 1 },
    ];
    expect(matchesForSide(m, "L").map((x) => x.lineIdx)).toEqual([0, 2]);
    expect(matchesForSide(m, "R").map((x) => x.lineIdx)).toEqual([1, 2]);
  });
});

describe("matchesForLine", () => {
  test("filters to one row only", () => {
    const m = [
      { hunkIdx: 0, lineIdx: 0, side: "B" as const, start: 0, end: 1 },
      { hunkIdx: 0, lineIdx: 1, side: "B" as const, start: 0, end: 1 },
      { hunkIdx: 0, lineIdx: 0, side: "B" as const, start: 5, end: 6 },
      { hunkIdx: 1, lineIdx: 0, side: "B" as const, start: 0, end: 1 },
    ];
    expect(matchesForLine(m, 0, 0)).toHaveLength(2);
    expect(matchesForLine(m, 0, 1)).toHaveLength(1);
    expect(matchesForLine(m, 2, 0)).toHaveLength(0);
  });
});

describe("diffLineKey", () => {
  test("matches selectionKey format from subsetPatch", () => {
    expect(diffLineKey(0, 0)).toBe("0:0");
    expect(diffLineKey(3, 47)).toBe("3:47");
  });
});
