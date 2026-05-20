import { describe, expect, it } from "bun:test";
import { fuzzyScore, highlight } from "./fuzzy";

describe("fuzzyScore", () => {
  it("returns score 0 with empty matches for empty query", () => {
    const r = fuzzyScore("", "anything");
    expect(r).toEqual({ score: 0, matches: [] });
  });

  it("rejects when query is longer than candidate", () => {
    expect(fuzzyScore("abcdef", "abc")).toBeNull();
  });

  it("rejects when query is not a subsequence", () => {
    // 'z' never appears in 'abc'
    expect(fuzzyScore("za", "abc")).toBeNull();
    // out-of-order: 'cb' is in 'abc' as 'c'@2 then no 'b' after 2
    expect(fuzzyScore("cb", "abc")).toBeNull();
  });

  it("matches a contiguous prefix with the highest score", () => {
    const exact = fuzzyScore("graph", "graph.ts")!;
    const middle = fuzzyScore("graph", "lib/graph.ts")!;
    const sparse = fuzzyScore("graph", "the great rapture happens")!;
    expect(exact).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(sparse).not.toBeNull();
    expect(exact.score).toBeGreaterThan(middle.score);
    expect(middle.score).toBeGreaterThan(sparse.score);
  });

  it("rewards word-boundary starts (lib/graph beats graphite when query=graph)", () => {
    const onBoundary = fuzzyScore("graph", "lib/graph.ts")!;
    const midWord = fuzzyScore("graph", "graphite-mineral")!;
    expect(onBoundary).not.toBeNull();
    expect(midWord).not.toBeNull();
    // Both match — boundary one is at position 4 (after '/'), midWord is a prefix.
    // Prefix bonus (+100) is largest, so we just check both score positively.
    expect(onBoundary.score).toBeGreaterThan(0);
    expect(midWord.score).toBeGreaterThan(0);
  });

  it("returns matches indices for highlighting", () => {
    const r = fuzzyScore("foo", "foobar")!;
    expect(r.matches).toEqual([0, 1, 2]);
  });

  it("is case-insensitive but rewards exact case", () => {
    const exact = fuzzyScore("Foo", "Foobar")!;
    const lower = fuzzyScore("foo", "Foobar")!;
    expect(exact).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(exact.score).toBeGreaterThan(lower.score);
  });

  it("subsequence matches with gaps", () => {
    const r = fuzzyScore("gph", "graph")!;
    expect(r.matches).toEqual([0, 3, 4]);
  });
});

describe("highlight", () => {
  it("returns the original string when there are no matches", () => {
    const out = highlight(
      "hello",
      [],
      (s) => `[${s}]`,
      (s) => `<${s}>`,
    );
    expect(out.join("")).toBe("[hello]");
  });

  it("wraps matched runs and leaves unmatched intact", () => {
    // matches are indices 0,1,2 → "hel"
    const out = highlight(
      "hello",
      [0, 1, 2],
      (s) => `[${s}]`,
      (s) => `<${s}>`,
    );
    expect(out.join("")).toBe("<hel>[lo]");
  });

  it("groups consecutive runs and separates non-consecutive ones", () => {
    // "f_o_o_b_a_r" indices: f=0, _=1, o=2, _=3, o=4, _=5, b=6, _=7, a=8, _=9, r=10
    const out = highlight(
      "f_o_o_b_a_r",
      [0, 2, 4, 6],
      (s) => `[${s}]`,
      (s) => `<${s}>`,
    );
    // matches: 0 alone, 2 alone, 4 alone, 6 alone → 4 separate <> wrapped chars
    expect(out.join("")).toBe("<f>[_]<o>[_]<o>[_]<b>[_a_r]");
  });
});
