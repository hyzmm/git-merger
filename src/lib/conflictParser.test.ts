import { describe, expect, it } from "bun:test";
import {
  chunkSummary,
  joinChunks,
  parseConflicts,
  resolveText,
  type ConflictChunk,
} from "./conflictParser";

const SIMPLE_CONFLICT = [
  "before clean line",
  "<<<<<<< HEAD",
  "ours line 1",
  "ours line 2",
  "=======",
  "theirs line",
  ">>>>>>> feat-branch",
  "after clean line",
  "",
].join("\n");

const DIFF3_CONFLICT = [
  "<<<<<<< HEAD",
  "ours",
  "||||||| ancestor",
  "base",
  "=======",
  "theirs",
  ">>>>>>> feat",
  "",
].join("\n");

describe("parseConflicts", () => {
  it("splits clean / conflict / clean sections", () => {
    const chunks = parseConflicts(SIMPLE_CONFLICT);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.kind).toBe("clean");
    expect(chunks[1]!.kind).toBe("conflict");
    expect(chunks[2]!.kind).toBe("clean");
  });

  it("captures ours / theirs labels and bodies", () => {
    const chunks = parseConflicts(SIMPLE_CONFLICT);
    const c = chunks[1] as ConflictChunk;
    expect(c.oursLabel).toBe("HEAD");
    expect(c.theirsLabel).toBe("feat-branch");
    expect(c.ours).toBe("ours line 1\nours line 2\n");
    expect(c.theirs).toBe("theirs line\n");
    expect(c.base).toBeUndefined();
    expect(c.resolution).toBe("pending");
  });

  it("captures the base section in diff3 style", () => {
    const chunks = parseConflicts(DIFF3_CONFLICT);
    expect(chunks).toHaveLength(1);
    const c = chunks[0] as ConflictChunk;
    expect(c.kind).toBe("conflict");
    expect(c.ours).toBe("ours\n");
    expect(c.base).toBe("base\n");
    expect(c.theirs).toBe("theirs\n");
  });

  it("indexes conflicts by occurrence order", () => {
    const text = [
      "<<<<<<< A",
      "x",
      "=======",
      "y",
      ">>>>>>> B",
      "<<<<<<< C",
      "p",
      "=======",
      "q",
      ">>>>>>> D",
      "",
    ].join("\n");
    const chunks = parseConflicts(text);
    const conflicts = chunks.filter((c) => c.kind === "conflict") as ConflictChunk[];
    expect(conflicts.map((c) => c.index)).toEqual([0, 1]);
  });

  it("returns one clean chunk for non-conflicted text", () => {
    const chunks = parseConflicts("just a normal\nfile here\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.kind).toBe("clean");
  });

  it("returns [] for empty input", () => {
    expect(parseConflicts("")).toEqual([]);
  });
});

describe("resolveText", () => {
  function mk(ours: string, theirs: string): ConflictChunk {
    return {
      kind: "conflict",
      index: 0,
      oursLabel: "ours",
      theirsLabel: "theirs",
      ours,
      theirs,
      resolution: "pending",
      result: ours,
    };
  }

  it("'left' returns ours", () => {
    expect(resolveText(mk("A\n", "B\n"), "left")).toBe("A\n");
  });

  it("'right' returns theirs", () => {
    expect(resolveText(mk("A\n", "B\n"), "right")).toBe("B\n");
  });

  it("'both' concatenates with a newline glue when ours doesn't end in one", () => {
    expect(resolveText(mk("A", "B\n"), "both")).toBe("A\nB\n");
  });

  it("'both' does not add an extra newline when ours already ends in one", () => {
    expect(resolveText(mk("A\n", "B\n"), "both")).toBe("A\nB\n");
  });

  it("'both' handles empty ours gracefully", () => {
    expect(resolveText(mk("", "B\n"), "both")).toBe("B\n");
  });

  it("'manual' / 'pending' return the existing result text", () => {
    const c = mk("A\n", "B\n");
    c.result = "edited\n";
    expect(resolveText(c, "manual")).toBe("edited\n");
    expect(resolveText(c, "pending")).toBe("edited\n");
  });
});

describe("joinChunks", () => {
  it("re-concatenates clean + conflict.result", () => {
    const chunks = parseConflicts(SIMPLE_CONFLICT);
    // Apply: pick "right"
    for (const c of chunks) {
      if (c.kind === "conflict") c.result = resolveText(c, "right");
    }
    const out = joinChunks(chunks);
    expect(out).toBe("before clean line\ntheirs line\nafter clean line\n");
  });

  it("round-trips a clean file", () => {
    const text = "a\nb\nc\n";
    const chunks = parseConflicts(text);
    expect(joinChunks(chunks)).toBe(text);
  });
});

describe("chunkSummary", () => {
  it("counts pending vs resolved correctly", () => {
    const chunks = parseConflicts(SIMPLE_CONFLICT);
    const s1 = chunkSummary(chunks);
    expect(s1).toEqual({ total: 1, resolved: 0, pending: 1 });

    (chunks[1] as ConflictChunk).resolution = "left";
    const s2 = chunkSummary(chunks);
    expect(s2).toEqual({ total: 1, resolved: 1, pending: 0 });
  });

  it("returns zero totals for clean files", () => {
    expect(chunkSummary(parseConflicts("clean\n"))).toEqual({
      total: 0,
      resolved: 0,
      pending: 0,
    });
  });
});
