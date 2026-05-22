import { describe, expect, test } from "bun:test";
import { unifiedWordTokens } from "./unifiedWordTokens";
import type { DiffLine } from "@/ipc/git";

function ctx(lineno: number, content: string): DiffLine {
  return { origin: " ", old_lineno: lineno, new_lineno: lineno, content };
}
function del(lineno: number, content: string): DiffLine {
  return { origin: "-", old_lineno: lineno, new_lineno: null, content };
}
function add(lineno: number, content: string): DiffLine {
  return { origin: "+", old_lineno: null, new_lineno: lineno, content };
}

describe("unifiedWordTokens", () => {
  test("returns nothing for context-only hunks", () => {
    const got = unifiedWordTokens([ctx(1, "alpha\n"), ctx(2, "beta\n")]);
    expect(got).toEqual({});
  });

  test("pairs adjacent del/add runs by index and emits del/add tokens", () => {
    const lines: DiffLine[] = [
      ctx(1, "context\n"),
      del(2, "let x = 1;\n"),
      add(2, "let x = 2;\n"),
      ctx(3, "tail\n"),
    ];
    const got = unifiedWordTokens(lines);
    // Indices 1 (del) and 2 (add) should each have a tokens array.
    expect(Object.keys(got).sort()).toEqual(["1", "2"]);
    // Left side carries `same` + `del` only (no `add`).
    expect(got[1].some((t) => t.kind === "del")).toBe(true);
    expect(got[1].every((t) => t.kind !== "add")).toBe(true);
    // Right side carries `same` + `add` only (no `del`).
    expect(got[2].some((t) => t.kind === "add")).toBe(true);
    expect(got[2].every((t) => t.kind !== "del")).toBe(true);
    // Reconstructing each side's plain text matches the original line
    // content (minus trailing newline).
    const leftText = got[1].map((t) => t.text).join("");
    const rightText = got[2].map((t) => t.text).join("");
    expect(leftText).toBe("let x = 1;");
    expect(rightText).toBe("let x = 2;");
  });

  test("pure additions get no overlay", () => {
    const lines: DiffLine[] = [add(1, "new line\n"), add(2, "another\n")];
    const got = unifiedWordTokens(lines);
    expect(got).toEqual({});
  });

  test("pure deletions get no overlay", () => {
    const lines: DiffLine[] = [del(1, "dead\n"), del(2, "code\n")];
    const got = unifiedWordTokens(lines);
    expect(got).toEqual({});
  });

  test("uneven runs only pair the first min(del,add) lines", () => {
    const lines: DiffLine[] = [
      del(1, "one\n"),
      del(2, "two\n"),
      del(3, "three\n"),
      add(1, "ONE\n"),
      // only one add line — so only del[0]+add[0] paired.
      ctx(4, "tail\n"),
    ];
    const got = unifiedWordTokens(lines);
    // Indices 0 (first del) and 3 (the only add) get tokens; surplus dels
    // 1, 2 stay un-overlayed.
    expect(Object.keys(got).sort()).toEqual(["0", "3"]);
  });

  test("two independent replace blocks each pair separately", () => {
    const lines: DiffLine[] = [
      del(1, "a1\n"),
      add(1, "A1\n"),
      ctx(2, "mid\n"),
      del(3, "b1\n"),
      add(3, "B1\n"),
    ];
    const got = unifiedWordTokens(lines);
    // Each replace block contributes 2 entries. Indices 0/1 and 3/4.
    expect(Object.keys(got).sort()).toEqual(["0", "1", "3", "4"]);
  });

  test("strips trailing newline before computing the diff", () => {
    const lines: DiffLine[] = [del(1, "x\n"), add(1, "x\n")];
    // Identical content (just the newline differs from raw); after strip
    // both sides are "x" — so the only token on each side is a `same`.
    const got = unifiedWordTokens(lines);
    expect(got[0].length).toBe(1);
    expect(got[0][0].kind).toBe("same");
    expect(got[1][0].kind).toBe("same");
  });
});
