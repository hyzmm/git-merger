import { describe, expect, it } from "bun:test";
import { createLayoutState, extendLayout, layoutGraph } from "./graph";

/**
 * Helper: build a CommitInput from a compact spec.
 * `["c", "p1", "p2"]` → { oid: "c", parents: ["p1", "p2"] }
 */
function c(oid: string, ...parents: string[]) {
  return { oid, parents };
}

describe("layoutGraph", () => {
  it("returns one row per commit, in input order", () => {
    const out = layoutGraph([c("A", "B"), c("B", "C"), c("C")]);
    expect(out.map((r) => r.oid)).toEqual(["A", "B", "C"]);
  });

  it("places a linear history in a single column", () => {
    const out = layoutGraph([c("A", "B"), c("B", "C"), c("C")]);
    for (const row of out) {
      expect(row.dotCol).toBe(0);
      expect(row.through).toEqual([]);
    }
    // First two rows have a "straight" curve down to the next commit; the root
    // has no curves.
    expect(out[0]!.curves).toHaveLength(1);
    expect(out[0]!.curves[0]!.kind).toBe("straight");
    expect(out[1]!.curves[0]!.kind).toBe("straight");
    expect(out[2]!.curves).toHaveLength(0);
  });

  it("introduces a second lane for a branch and merges back", () => {
    // Topology (newest first):
    //   M -- p1=A,  p2=B
    //   A -- A1
    //   B -- C
    //   A1 -- C
    //   C
    const out = layoutGraph([c("M", "A", "B"), c("A", "A1"), c("B", "C"), c("A1", "C"), c("C")]);
    // Merge commit must emit at least 2 curves (one per parent).
    const merge = out[0]!;
    expect(merge.curves.length).toBeGreaterThanOrEqual(2);
    // Some non-zero column gets allocated for the second parent's lane.
    const cols = new Set(out.map((r) => r.dotCol));
    expect(cols.size).toBeGreaterThan(1);
    // Final commit (root) terminates: no curves.
    expect(out[out.length - 1]!.curves).toHaveLength(0);
  });

  it("the root commit has no curves and terminates its lane", () => {
    const out = layoutGraph([c("only")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.curves).toHaveLength(0);
    expect(out[0]!.dotCol).toBe(0);
  });

  it("through-segments skip the dot column", () => {
    // A long branch passing through B's row
    //   A -- C       (col 0 → C)
    //   B -- D       (col 1 → D)
    //   C -- D
    //   D
    const out = layoutGraph([c("A", "C"), c("B", "D"), c("C", "D"), c("D")]);
    // Row B (idx 1): A's lane (col 0, waiting for C) should pass through.
    const rowB = out[1]!;
    expect(rowB.through.some((t) => t.col !== rowB.dotCol)).toBe(true);
  });

  it("width grows to accommodate the highest used column", () => {
    const out = layoutGraph([c("M", "A", "B"), c("A"), c("B")]);
    // Merge row uses two lanes ⇒ width >= 2.
    expect(out[0]!.width).toBeGreaterThanOrEqual(2);
  });

  it("assigns a stable color to each oid", () => {
    const out = layoutGraph([c("A", "B"), c("B")]);
    // The same lane (col 0) carries A then continues for B; color should
    // remain consistent for the lane's continuation.
    expect(typeof out[0]!.dotColor).toBe("number");
    expect(typeof out[1]!.dotColor).toBe("number");
  });
});

describe("extendLayout (incremental)", () => {
  it("produces the same rows as layoutGraph for the same input", () => {
    const all = [c("M", "A", "B"), c("A", "A1"), c("B", "C"), c("A1", "C"), c("C")];
    const oneShot = layoutGraph(all);
    const inc = extendLayout(createLayoutState(), all);
    expect(inc).toEqual(oneShot);
  });

  it("paged extension matches one-shot when split mid-branch", () => {
    // Same DAG, but feed it in two halves like a paginated walker.
    const all = [c("M", "A", "B"), c("A", "A1"), c("B", "C"), c("A1", "C"), c("C")];
    const state = createLayoutState();
    const page1 = extendLayout(state, all.slice(0, 2));
    const page2 = extendLayout(state, all.slice(2));

    const oneShot = layoutGraph(all);
    const merged = [...page1, ...page2];

    // Lane allocation depends on internal state; the merged result must be
    // byte-identical to the one-shot layout.
    expect(merged).toEqual(oneShot);
  });

  it("resolves a still-waiting parent to a deterministic dot column", () => {
    // A merge commit M references parents A and B. We feed M alone first,
    // then A, then B as separate "pages". Each parent must eventually land
    // on some lane that was alive in M's row — i.e. extendLayout never
    // forgets a waiting parent across calls.
    const state = createLayoutState();
    const [rowM] = extendLayout(state, [c("M", "A", "B")]);
    const [rowA] = extendLayout(state, [c("A", "B")]);
    const [rowB] = extendLayout(state, [c("B")]);
    expect(rowM).toBeTruthy();
    expect(rowA).toBeTruthy();
    expect(rowB).toBeTruthy();

    // M's curves reach to the lanes of A and B respectively.
    const reached = new Set(rowM!.curves.map((cc) => cc.toCol));
    expect(reached.has(rowA!.dotCol)).toBe(true);
    expect(reached.has(rowB!.dotCol)).toBe(true);

    // And B's color was assigned exactly once (deterministic, not random).
    const sameRunAgain = createLayoutState();
    extendLayout(sameRunAgain, [c("M", "A", "B")]);
    extendLayout(sameRunAgain, [c("A", "B")]);
    const [rowB2] = extendLayout(sameRunAgain, [c("B")]);
    expect(rowB2!.dotColor).toBe(rowB!.dotColor);
  });

  it("extends an empty state without throwing", () => {
    const state = createLayoutState();
    expect(extendLayout(state, [])).toEqual([]);
    // State should still be usable afterwards.
    const out = extendLayout(state, [c("only")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.dotCol).toBe(0);
  });

  it("treats two non-overlapping pages as truly independent in lane usage", () => {
    // First page is a self-contained walk; second page is unrelated.
    const state = createLayoutState();
    const p1 = extendLayout(state, [c("A", "B"), c("B")]);
    const p2 = extendLayout(state, [c("X", "Y"), c("Y")]);
    expect(p1.map((r) => r.oid)).toEqual(["A", "B"]);
    expect(p2.map((r) => r.oid)).toEqual(["X", "Y"]);
    // After page 1 finished, lane 0 was freed (B is root). Page 2 should be
    // able to reuse col 0 again.
    expect(p2[0]!.dotCol).toBe(0);
  });
});
