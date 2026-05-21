import { describe, expect, test } from "bun:test";
import { aggregateByFile, uniqueCommitCount } from "./searchAggregate";
import type { DiffHit, SearchHit } from "@/ipc/git";

function diffHit(file: string, line: number, side: "+" | "-", text: string): DiffHit {
  return { file, line_no: line, side, text };
}

function commit(oid: string, options: Partial<Omit<SearchHit, "oid">> = {}): SearchHit {
  return {
    oid,
    short_oid: oid.slice(0, 7),
    summary: options.summary ?? `summary of ${oid}`,
    author_name: options.author_name ?? "alice",
    time: options.time ?? 1_700_000_000,
    message_match: options.message_match ?? false,
    diff_hits: options.diff_hits ?? [],
  };
}

describe("aggregateByFile", () => {
  test("groups every diff hit by file", () => {
    const hits: SearchHit[] = [
      commit("a1", {
        diff_hits: [diffHit("src/foo.ts", 10, "+", "added"), diffHit("src/bar.ts", 1, "-", "gone")],
      }),
      commit("b2", {
        diff_hits: [diffHit("src/foo.ts", 11, "+", "another")],
      }),
    ];
    const groups = aggregateByFile(hits);
    expect(groups.map((g) => g.file)).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(groups[0]!.commits.map((c) => c.oid)).toEqual(["a1", "b2"]);
    expect(groups[0]!.totalLines).toBe(2);
    expect(groups[1]!.totalLines).toBe(1);
  });

  test("orders files by total hit count, then alphabetically", () => {
    const hits: SearchHit[] = [
      commit("c", {
        diff_hits: [diffHit("z.txt", 1, "+", "x"), diffHit("a.txt", 1, "+", "x")],
      }),
      commit("d", { diff_hits: [diffHit("a.txt", 2, "+", "y")] }),
    ];
    const groups = aggregateByFile(hits);
    // a.txt has 2 hits, z.txt has 1.
    expect(groups.map((g) => g.file)).toEqual(["a.txt", "z.txt"]);
  });

  test("ties on total break alphabetically (stable display)", () => {
    const hits: SearchHit[] = [
      commit("c", {
        diff_hits: [diffHit("zz.txt", 1, "+", "x"), diffHit("aa.txt", 1, "+", "x")],
      }),
    ];
    const groups = aggregateByFile(hits);
    expect(groups.map((g) => g.file)).toEqual(["aa.txt", "zz.txt"]);
  });

  test("commits with only message-match are dropped from the file rollup", () => {
    const hits: SearchHit[] = [
      commit("msgonly", { message_match: true, diff_hits: [] }),
      commit("withdiff", { diff_hits: [diffHit("a.txt", 1, "+", "x")] }),
    ];
    const groups = aggregateByFile(hits);
    expect(groups.length).toBe(1);
    expect(groups[0]!.commits.map((c) => c.oid)).toEqual(["withdiff"]);
  });

  test("a single commit touching the same file twice still appears once under that file", () => {
    const hits: SearchHit[] = [
      commit("a1", {
        diff_hits: [diffHit("foo.ts", 10, "+", "x"), diffHit("foo.ts", 12, "-", "y")],
      }),
    ];
    const groups = aggregateByFile(hits);
    expect(groups.length).toBe(1);
    expect(groups[0]!.commits.length).toBe(1);
    expect(groups[0]!.commits[0]!.lines.length).toBe(2);
  });

  test("empty input yields empty output", () => {
    expect(aggregateByFile([])).toEqual([]);
  });

  test("uniqueCommitCount dedupes a commit that touches multiple files", () => {
    const groups = aggregateByFile([
      commit("a", {
        diff_hits: [diffHit("x.ts", 1, "+", "x"), diffHit("y.ts", 1, "+", "y")],
      }),
      commit("b", { diff_hits: [diffHit("x.ts", 2, "-", "z")] }),
    ]);
    expect(uniqueCommitCount(groups)).toBe(2);
  });

  test("uniqueCommitCount on empty groups is 0", () => {
    expect(uniqueCommitCount([])).toBe(0);
  });
});
