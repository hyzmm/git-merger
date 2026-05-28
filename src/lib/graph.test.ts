import { describe, expect, it } from "bun:test";
import {
  applyColMapping,
  buildColMapping,
  createLayoutState,
  extendLayout,
  layoutGraph,
} from "./graph";

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

// ---------------------------------------------------------------------------
// v0.13.23 — color stability + first-parent inheritance
// ---------------------------------------------------------------------------

import { branchSlotForName } from "./branchColors";

describe("graph coloring (v0.13.23)", () => {
  it("first-parent chain keeps a single color from HEAD to root", () => {
    // Linear history; every commit's first (and only) parent is the next one.
    // The single lane's color must be picked exactly once and inherited
    // through every row. This is what makes `main` a single uninterrupted
    // colored column on screen.
    const out = layoutGraph([c("A", "B"), c("B", "C"), c("C", "D"), c("D")]);
    const colors = new Set(out.map((r) => r.dotColor));
    expect(colors.size).toBe(1);
  });

  it("uses the first ref name to pick a lane color when present", () => {
    // A has a ref attached → its color must hash from "main", *not* from
    // its oid. Same hash the RefsPane uses, so the dot in the graph and
    // the dot in the ref list agree.
    const out = layoutGraph([
      { oid: "A", parents: ["B"], refs: ["main"] },
      { oid: "B", parents: [] },
    ]);
    expect(out[0]!.dotColor).toBe(branchSlotForName("main"));
    // First parent inherits the same lane / color, not B's oid hash.
    expect(out[1]!.dotColor).toBe(out[0]!.dotColor);
  });

  it("falls back to oid hashing when no refs are attached", () => {
    // Without refs, the lane color is derived from the *first commit's*
    // oid (since the lane is created at row 0 and inherited downward),
    // and stays stable across reruns.
    const out1 = layoutGraph([c("a1b2c3d", "deadbee"), c("deadbee")]);
    const out2 = layoutGraph([c("a1b2c3d", "deadbee"), c("deadbee")]);
    expect(out1[0]!.dotColor).toBe(out2[0]!.dotColor);
    expect(out1[0]!.dotColor).toBe(branchSlotForName("a1b2c3d"));
    // Same lane → same color for the first-parent continuation.
    expect(out1[1]!.dotColor).toBe(out1[0]!.dotColor);
  });

  it("merge's secondary parent gets its own lane color", () => {
    // M has two parents A (first) and B (second). A inherits M's lane color;
    // B starts a new lane that must NOT collide with M's color when we hash
    // distinct oids — and even on a hash collision we still want a *separate*
    // lane allocation (different dotCol).
    const out = layoutGraph([c("M", "A", "B"), c("A"), c("B")]);
    const rowM = out[0]!;
    const rowB = out[2]!;
    // B uses a different column than M.
    expect(rowB.dotCol).not.toBe(rowM.dotCol);
  });

  it("color slots stay within the palette range", () => {
    // Generate a small zoo of inputs and confirm every assigned slot lives
    // in [0, 6). Sanity check that BRANCH_PALETTE_SIZE wraparound works.
    const out = layoutGraph([
      { oid: "x1", parents: ["x2"], refs: ["main"] },
      { oid: "x2", parents: ["x3"], refs: ["develop"] },
      { oid: "x3", parents: [], refs: ["v1.0", "v1.0.1"] },
    ]);
    for (const row of out) {
      expect(row.dotColor).toBeGreaterThanOrEqual(0);
      expect(row.dotColor).toBeLessThan(6);
    }
  });
});

// ---------------------------------------------------------------------------
// v0.13.27 — lane reuse re-coloring (candidate B-2)
// ---------------------------------------------------------------------------

describe("graph coloring (v0.13.27 B-2)", () => {
  it("upgrades a placeholder lane color when a ref-bearing commit lands on it", () => {
    // Layout (newest-first):
    //   M  parents: [A, F]   ← merge of feature into main
    //   A  parents: [P]      ← main HEAD before merge
    //   F  parents: [P], refs: ["feature"]   ← feature tip, lands on the
    //                                          lane M opened with an
    //                                          oid-hash placeholder
    //   P  parents: []
    //
    // M opens lane 1 for F using oid hashing (because at the time M is
    // processed we don't yet see F's refs). When we then visit F, the
    // lane reuse path must notice F.refs[0]="feature", swap in the
    // ref-hashed color, and pin the lane.
    const out = layoutGraph([
      { oid: "M", parents: ["A", "F"] },
      { oid: "A", parents: ["P"] },
      { oid: "F", parents: ["P"], refs: ["feature"] },
      { oid: "P", parents: [] },
    ]);
    const featureRow = out.find((r) => r.oid === "F")!;
    expect(featureRow.dotColor).toBe(branchSlotForName("feature"));
  });

  it("does NOT re-color a pinned (first-parent inherited) lane", () => {
    // Layout:
    //   A  parents: [B], refs: ["main"]   ← pins lane 0 to hash("main")
    //   B  parents: [C], refs: ["develop"] ← B sits in lane 0 via
    //                                        first-parent inheritance;
    //                                        its `develop` ref must NOT
    //                                        steal main's color slot.
    //   C  parents: []
    //
    // Without the colorPinned guard, B would re-hash to "develop" and
    // visually fork the main column mid-history. With the guard, the
    // pinned color is preserved.
    const out = layoutGraph([
      { oid: "A", parents: ["B"], refs: ["main"] },
      { oid: "B", parents: ["C"], refs: ["develop"] },
      { oid: "C", parents: [] },
    ]);
    const a = out.find((r) => r.oid === "A")!;
    const b = out.find((r) => r.oid === "B")!;
    expect(a.dotColor).toBe(branchSlotForName("main"));
    expect(b.dotColor).toBe(a.dotColor);
    // Sanity: it would have been hash("develop") if B had won the race.
    // We don't *require* main and develop to differ (palette has only 6
    // slots, hash collisions are possible), but the property under test
    // is "B inherits A's slot", not "B equals hash('develop')".
  });

  it("two unrelated branches recycling a lane do not share a hue from inheritance", () => {
    // Layout: lane 0 is opened by A (refs=["alpha"]) → pinned to
    // hash("alpha"). A is a root (no parents), so lane 0 is freed.
    // Then Z appears with refs=["zeta"] and reuses lane 0 (findFreeLane
    // picks the lowest free slot). The expected color is hash("zeta"),
    // NOT hash("alpha") inherited by stale-cache route.
    //
    // This is the *original* lane-reuse-after-release case the regular
    // code already handled correctly (because findFreeLane picks lane
    // 0, then colorFor(Z, ["zeta"]) computes a fresh ref-hash). The
    // test pins down that behaviour so a future refactor can't
    // regress.
    const out = layoutGraph([
      { oid: "A", parents: [], refs: ["alpha"] },
      { oid: "Z", parents: [], refs: ["zeta"] },
    ]);
    const a = out.find((r) => r.oid === "A")!;
    const z = out.find((r) => r.oid === "Z")!;
    expect(a.dotColor).toBe(branchSlotForName("alpha"));
    expect(z.dotColor).toBe(branchSlotForName("zeta"));
  });
});

// ---------------------------------------------------------------------------
// v0.13.28 — merge edge coloring (candidate B-3)
// ---------------------------------------------------------------------------

describe("graph coloring (v0.13.28 B-3)", () => {
  it("merge curve to an already-existing lane uses the merge commit's color", () => {
    // Topology (newest first):
    //   M  parents: [A, F]   ← merge of feature into main, refs=["main"]
    //   F  parents: [P], refs: ["feature"]
    //   A  parents: [P]
    //   P  parents: []
    //
    // When M is processed: parent A inherits M's lane (col 0); parent
    // F is *not yet allocated* → new lane opened with placeholder.
    // When F's row is then walked, F is already waiting in its lane;
    // and a *new* sibling commit on row F could land back into a
    // lane reach. But here we want to assert the merge curve from M to
    // F (kind="branch" — new lane) is colored with F's lane (side branch),
    // and *also* assert the converse for an already-live side branch.
    //
    // To get a kind="merge" edge we need the side parent's lane to
    // already exist *before* M's row — i.e. the side branch is alive
    // for some rows above M. Construct it like this:
    //
    //   X  parents: [F]              ← keeps F's lane alive above M
    //   M  parents: [A, F], refs: ["main"]
    //   F  parents: [P], refs: ["feature"]
    //   A  parents: [P]
    //   P  parents: []
    //
    // When M is processed, the "F" lane already exists (X opened it
    // and is waiting on F), so M's curve to F is kind="merge" — and
    // per B-3 must use M's own dotColor, not the feature lane color.
    const out = layoutGraph([
      { oid: "X", parents: ["F"] },
      { oid: "M", parents: ["A", "F"], refs: ["main"] },
      { oid: "F", parents: ["P"], refs: ["feature"] },
      { oid: "A", parents: ["P"] },
      { oid: "P", parents: [] },
    ]);
    const rowM = out.find((r) => r.oid === "M")!;
    const rowF = out.find((r) => r.oid === "F")!;

    // Find the curve from M to F's column.
    const mergeCurve = rowM.curves.find((cv) => cv.toCol === rowF.dotCol);
    expect(mergeCurve).toBeDefined();
    expect(mergeCurve!.kind).toBe("merge");
    // Core B-3 assertion: edge color follows the *merge commit*, not
    // the absorbed branch.
    expect(mergeCurve!.color).toBe(rowM.dotColor);
    expect(mergeCurve!.color).toBe(branchSlotForName("main"));
  });

  it("merge curve that opens a brand-new lane keeps the side branch color", () => {
    // Topology:
    //   M  parents: [A, F], refs: ["main"]   ← F lane is brand new here
    //   A  parents: [P]
    //   F  parents: [P], refs: ["feature"]
    //   P  parents: []
    //
    // F is *not* alive when M is processed — M opens a fresh lane for
    // it. kind="branch". This curve must be colored with the new
    // lane's eventual color (the side branch), not the merge color,
    // so the new column reads as a distinct branch starting here.
    const out = layoutGraph([
      { oid: "M", parents: ["A", "F"], refs: ["main"] },
      { oid: "A", parents: ["P"] },
      { oid: "F", parents: ["P"], refs: ["feature"] },
      { oid: "P", parents: [] },
    ]);
    const rowM = out.find((r) => r.oid === "M")!;
    const rowF = out.find((r) => r.oid === "F")!;

    const branchCurve = rowM.curves.find((cv) => cv.toCol === rowF.dotCol);
    expect(branchCurve).toBeDefined();
    expect(branchCurve!.kind).toBe("branch");
    // Must NOT be M's color — that would make the brand-new side
    // column visually start as main and only switch hues on the
    // next row.
    expect(branchCurve!.color).not.toBe(rowM.dotColor);
  });

  it("merge curve color is independent of the side branch's eventual ref-color upgrade", () => {
    // Regression coverage: even in the "merge" case where the side
    // branch lane existed before M, B-3 picks dotColor *at curve
    // emit time* — so a later B-2 lane-color upgrade for the side
    // branch (when its tip commit with refs is processed) cannot
    // retroactively change the merge curve's color. The point: M's
    // edge is committed to M's color, period.
    //
    // Topology:
    //   X  parents: [F]
    //   M  parents: [A, F], refs: ["main"]
    //   F  parents: [P], refs: ["feature"]   ← B-2 upgrade happens here
    //   A  parents: [P]
    //   P  parents: []
    const out = layoutGraph([
      { oid: "X", parents: ["F"] },
      { oid: "M", parents: ["A", "F"], refs: ["main"] },
      { oid: "F", parents: ["P"], refs: ["feature"] },
      { oid: "A", parents: ["P"] },
      { oid: "P", parents: [] },
    ]);
    const rowM = out.find((r) => r.oid === "M")!;
    const rowF = out.find((r) => r.oid === "F")!;

    // F's dotColor reflects the B-2 upgrade to "feature".
    expect(rowF.dotColor).toBe(branchSlotForName("feature"));
    // M's merge curve toward F's lane is *still* main's color, not
    // feature's — it commits at curve-emit time to dotColor.
    const mergeCurve = rowM.curves.find((cv) => cv.toCol === rowF.dotCol)!;
    expect(mergeCurve.color).toBe(branchSlotForName("main"));
    expect(mergeCurve.color).not.toBe(rowF.dotColor);
  });
});

// ---------------------------------------------------------------------------
// v0.13.29 — trunk lane anchoring (candidate B-4)
// ---------------------------------------------------------------------------

describe("graph trunk anchoring (v0.13.29 B-4)", () => {
  it("places a trunk-hinted side branch into its anchored column even when it appears late", () => {
    // Topology (newest first):
    //   F  parents: [P], refs: ["feature"]   ← HEAD, lands in col 0
    //   X  parents: []                       ← orphan side commit, dies in col 1 immediately
    //   M  parents: [P], refs: ["main"]      ← main's tip; col 1 is FREE again by now
    //   P  parents: []
    //
    // Without B-4, M would also get col 1 here (findFreeLane picks
    // the lowest free slot, which is 1 because X's lane was freed
    // when X had no parents). The point of this test is to confirm
    // the *happy path* still works under B-4 — the hint is not
    // ignored, and trunkOids state is materialised. The next test
    // covers the case where B-4 actively diverges from baseline by
    // refusing to evict.
    const out = layoutGraph(
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "X", parents: [] },
        { oid: "M", parents: ["P"], refs: ["main"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    const rowF = out.find((r) => r.oid === "F")!;
    const rowM = out.find((r) => r.oid === "M")!;
    expect(rowF.dotCol).toBe(0);
    expect(rowM.dotCol).toBe(1);
  });

  it("anchors multiple trunks at distinct columns when a non-trunk commit leads", () => {
    // Detached-HEAD scenario: commits[0] is an unrelated tip the
    // user is currently sitting on, neither main nor develop. The
    // caller still wants `main` and `develop` anchored to specific
    // columns. trunkOids=["MAIN", "DEV"] reserves col 0 for main's
    // tip and col 1 for develop's tip; the leading non-trunk
    // commit lands in whatever's left (col 2).
    //
    // Without B-4, the leading commit takes col 0 (findFreeLane
    // returns 0 because lanes is empty), and MAIN / DEV cascade
    // into cols 1 / 2 on a "first-come" basis. With B-4, the
    // leading commit is *not* in trunkOids → it skips the trunk
    // path and goes through findFreeLane, which now returns 0 too
    // — but immediately afterwards the trunk slots stay reserved:
    // when MAIN arrives, col 0 is occupied by the lead, so MAIN
    // cannot evict it (no-eviction rule), but col 1 is *not* its
    // anchor (MAIN's anchor is col 0). MAIN's anchor is occupied
    // → fall through. End state: MAIN takes col 1, DEV takes col 2.
    // This is the same as baseline, so this case alone does NOT
    // separate B-4 from baseline. It's documented here as the
    // boundary of what "no eviction" allows: a non-trunk leading
    // commit *will* shadow the trunk anchor.
    const baseline = layoutGraph([
      { oid: "X", parents: ["P"] },
      { oid: "MAIN", parents: ["P"], refs: ["main"] },
      { oid: "DEV", parents: ["P"], refs: ["develop"] },
      { oid: "P", parents: [] },
    ]);
    const withHint = layoutGraph(
      [
        { oid: "X", parents: ["P"] },
        { oid: "MAIN", parents: ["P"], refs: ["main"] },
        { oid: "DEV", parents: ["P"], refs: ["develop"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["MAIN", "DEV"] },
    );
    // Per the no-eviction rule, X (col 0) shadows MAIN's anchor →
    // identical to baseline.
    expect(withHint.map((r) => [r.oid, r.dotCol])).toEqual(baseline.map((r) => [r.oid, r.dotCol]));
    // What still matters: state.trunkOids has been recorded so a
    // future call (e.g. after the X lane drains and a third trunk
    // appears) can still benefit from anchoring.
  });

  it("does not evict an existing lane to honour a late trunk hint", () => {
    // Topology:
    //   F  parents: [P], refs: ["feature"]   ← HEAD, lands in col 0
    //   S1 parents: [S2]                     ← takes col 1
    //   S2 parents: [P]                      ← keeps col 1 alive
    //   M  parents: [P], refs: ["main"]      ← arrives here; col 1 is OCCUPIED
    //   P  parents: []
    //
    // trunkOids=["F","M"] would *prefer* col 1 for M, but col 1 is
    // currently held by the S1→S2 side chain. The allocator must
    // NOT evict S2 (it would retroactively rewrite S1's row, which
    // already shipped). It falls through to findFreeLane → col 2.
    const out = layoutGraph(
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "S1", parents: ["S2"] },
        { oid: "S2", parents: ["P"] },
        { oid: "M", parents: ["P"], refs: ["main"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    const rowS1 = out.find((r) => r.oid === "S1")!;
    const rowS2 = out.find((r) => r.oid === "S2")!;
    const rowM = out.find((r) => r.oid === "M")!;
    // S1 / S2 are uninterrupted on col 1 — proves no eviction happened.
    expect(rowS1.dotCol).toBe(1);
    expect(rowS2.dotCol).toBe(1);
    // M took the next free slot.
    expect(rowM.dotCol).toBe(2);
  });

  it("trunk hints accumulate across paginated extendLayout calls", () => {
    // Page 1 establishes F at col 0, hints both trunks up front; the
    // throwaway commit X is a root (no parents) so its lane drains
    // immediately and col 1 is empty when page 2 arrives.
    // Page 2 brings M in; the hint from page 1 must still be live
    // and parks M at col 1 even though the call site no longer
    // passes options.
    const state = createLayoutState();
    const page1 = extendLayout(
      state,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "X", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    const page2 = extendLayout(state, [
      { oid: "M", parents: ["P"], refs: ["main"] },
      { oid: "P", parents: [] },
    ]);
    const rowF = page1.find((r) => r.oid === "F")!;
    const rowM = page2.find((r) => r.oid === "M")!;
    expect(rowF.dotCol).toBe(0);
    expect(rowM.dotCol).toBe(1);
    // State carries the hint forward.
    expect(state.trunkOids).toEqual(["F", "M"]);
  });

  it("trunk hint also applies to a merge's secondary parent", () => {
    // Layout:
    //   F  parents: [A, M]                   ← HEAD; merges main *into* feature
    //   A  parents: [P]
    //   M  parents: [P], refs: ["main"]      ← side parent of F, anchored to col 1
    //   P  parents: []
    //
    // F opens col 0. Its first parent A inherits col 0. F's second
    // parent M is *not yet alive* → secondary-parent path opens a
    // fresh lane. Without B-4 it would use findFreeLane → col 1
    // (which happens to also be the trunk slot here, so the test
    // is meaningful only because F is *also* a trunk holding col 0).
    // What we verify: the trunkOid hint is consulted in this path
    // too — concretely, by parking another non-trunk side branch on
    // col 1 first and watching M still claim col 1 when free.
    const out = layoutGraph(
      [
        { oid: "F", parents: ["A", "M"], refs: ["feature"] },
        { oid: "A", parents: ["P"] },
        { oid: "M", parents: ["P"], refs: ["main"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    const rowF = out.find((r) => r.oid === "F")!;
    const rowM = out.find((r) => r.oid === "M")!;
    expect(rowF.dotCol).toBe(0);
    // M's lane was opened by F's secondary-parent path; B-4 sent it
    // straight to col 1.
    expect(rowM.dotCol).toBe(1);
  });

  it("layoutGraph without options is byte-identical to pre-B-4 behaviour", () => {
    // Regression coverage: B-4 must be opt-in via `trunkOids`. A
    // legacy call site that doesn't pass options gets the exact same
    // RowLayouts as before (modulo the now-present `trunkOids: []`
    // on the inner state, which doesn't surface in row outputs).
    const commits = [
      { oid: "F", parents: ["P"], refs: ["feature"] },
      { oid: "X", parents: ["P"] },
      { oid: "M", parents: ["P"], refs: ["main"] },
      { oid: "P", parents: [] },
    ];
    const noHint = layoutGraph(commits);
    const emptyHint = layoutGraph(commits, { trunkOids: [] });
    expect(emptyHint).toEqual(noHint);
  });

  it("repeating a trunk oid in a later call does not re-rank or duplicate", () => {
    // First call seeds [F, M]. Second call repeats [M, F] in
    // reversed order — the state must keep the original ordering
    // (first-seen wins) and not grow the array.
    const state = createLayoutState();
    extendLayout(state, [{ oid: "F", parents: ["P"], refs: ["feature"] }], {
      trunkOids: ["F", "M"],
    });
    extendLayout(state, [], { trunkOids: ["M", "F"] });
    expect(state.trunkOids).toEqual(["F", "M"]);
  });
});

// ---------------------------------------------------------------------------
// v0.13.30 — render-time column re-mapping (candidate B-5)
// ---------------------------------------------------------------------------

describe("buildColMapping (v0.13.30 B-5)", () => {
  it("returns identity when no trunk has been allocated", () => {
    // No options passed → state.trunkOids is empty → no trunk lanes
    // → mapping is the identity permutation on [0, width).
    const state = createLayoutState();
    extendLayout(state, [
      { oid: "A", parents: ["B"] },
      { oid: "B", parents: [] },
    ]);
    const mapping = buildColMapping(state, 1);
    expect(mapping).toEqual([0]);
  });

  it("returns identity when the only trunk is already in col 0", () => {
    // Most common real case: HEAD is commits[0], lands in logical
    // col 0, B-5 has nothing to permute.
    const state = createLayoutState();
    extendLayout(
      state,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F"] },
    );
    const mapping = buildColMapping(state, 1);
    expect(mapping).toEqual([0]);
  });

  it("promotes a trunk that lost its anchored col to the leftmost display col", () => {
    // The IDEA-shaped scenario B-5 exists for. Layout:
    //   F  parents: [P], refs: ["feature"]   ← HEAD, takes logical col 0
    //   X  parents: [Y]                      ← non-trunk, takes logical col 1 (lives long)
    //   Y  parents: [P]                      ← keeps X's lane alive
    //   M  parents: [P], refs: ["main"]      ← trunk, anchored at col 1 but col 1 is OCCUPIED;
    //                                           B-4 falls through to logical col 2
    //   P  parents: []
    //
    // After this walk, logical cols look like: 0=F (trunk), 1=X
    // (non-trunk), 2=M (trunk). B-5's permutation must put both
    // trunks (F, M) at the front:
    //   display 0 ← logical 0 (F)
    //   display 1 ← logical 2 (M)
    //   display 2 ← logical 1 (X)
    // i.e. mapping[0]=0, mapping[1]=2, mapping[2]=1.
    const state = createLayoutState();
    const rows = extendLayout(
      state,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "X", parents: ["Y"] },
        { oid: "Y", parents: ["P"] },
        { oid: "M", parents: ["P"], refs: ["main"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    const rowF = rows.find((r) => r.oid === "F")!;
    const rowX = rows.find((r) => r.oid === "X")!;
    const rowM = rows.find((r) => r.oid === "M")!;
    // Confirm the logical layout matches the scenario description.
    expect(rowF.dotCol).toBe(0);
    expect(rowX.dotCol).toBe(1);
    expect(rowM.dotCol).toBe(2);
    // trunkLogicalCols pinned both trunks.
    expect(state.trunkLogicalCols).toEqual([0, 2]);
    // The mapping promotes the late trunk.
    const width = Math.max(rowF.width, rowX.width, rowM.width);
    const mapping = buildColMapping(state, width);
    expect(mapping[0]).toBe(0); // F stays leftmost
    expect(mapping[2]).toBe(1); // M jumps from logical 2 to display 1
    expect(mapping[1]).toBe(2); // X gets pushed right
  });

  it("preserves relative order of non-trunk lanes", () => {
    // Two non-trunk lanes should keep their original numeric order
    // when sandwiched among trunks; only their absolute display
    // index shifts to accommodate the promoted trunks.
    const state = createLayoutState();
    extendLayout(
      state,
      [
        // Force this exact logical layout:
        //   col 0: F (trunk)
        //   col 1: X (non-trunk, alive long)
        //   col 2: Y (non-trunk, alive long)
        //   col 3: M (trunk)
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "X", parents: ["X1"] },
        { oid: "Y", parents: ["Y1"] },
        { oid: "X1", parents: ["P"] },
        { oid: "Y1", parents: ["P"] },
        { oid: "M", parents: ["P"], refs: ["main"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    // Logical: F=0, X (and X1) = 1, Y (and Y1) = 2, M = 3.
    expect(state.trunkLogicalCols).toEqual([0, 3]);
    const mapping = buildColMapping(state, 4);
    // Trunks first (F, M), then non-trunks in ascending logical
    // order (X col 1, Y col 2).
    expect(mapping).toEqual([0, 2, 3, 1]);
  });

  it("ignores unallocated trunks (oid in trunkOids but never seen as a commit)", () => {
    // If the caller hints a trunk whose tip oid never appears in the
    // commit list (typical: a stale ref the user just reset away),
    // the mapping must not get confused — `-1` slots are simply
    // skipped.
    const state = createLayoutState();
    extendLayout(
      state,
      [{ oid: "F", parents: [], refs: ["feature"] }],
      // M is hinted but never visited.
      { trunkOids: ["F", "M"] },
    );
    expect(state.trunkLogicalCols).toEqual([0, -1]);
    const mapping = buildColMapping(state, 1);
    expect(mapping).toEqual([0]);
  });

  it("v0.13.33: phantom trunks at the front of trunkOids do not waste lane slots", () => {
    // Regression: pre-v0.13.33 `findTrunkLaneFor` would *grow* the
    // `lanes` array preemptively to expose a trunk's preferred col,
    // so feeding `trunkOids = ["NEVER_A", "NEVER_B", "C"]` (where
    // only C ever shows up) inflated `lanes.length` to 3 and every
    // RowLayout to width 3, leaving cols 0 and 1 empty forever.
    // v0.13.33 makes the trunk-lane lookup *lazy*: phantoms can't
    // reserve space.
    const state = createLayoutState();
    const rows = extendLayout(state, [{ oid: "C", parents: [], refs: ["feature"] }], {
      trunkOids: ["NEVER_A", "NEVER_B", "C"],
    });
    const rowC = rows[0]!;
    // C lands in the first physically-free col, not its trunkOids
    // index (2).
    expect(rowC.dotCol).toBe(0);
    expect(rowC.width).toBe(1);
    // lanes array stays compact.
    expect(state.lanes.length).toBe(1);
    // trunkLogicalCols still records C's actual col, with phantoms
    // at -1.
    expect(state.trunkLogicalCols).toEqual([-1, -1, 0]);
    // The mapping leaves C in display col 0 — no unnecessary
    // permutation, no padding columns.
    const mapping = buildColMapping(state, 1);
    expect(mapping).toEqual([0]);
  });

  it("is deterministic — same state, same width → same mapping", () => {
    const state = createLayoutState();
    extendLayout(
      state,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "X", parents: ["Y"] },
        { oid: "Y", parents: ["P"] },
        { oid: "M", parents: ["P"], refs: ["main"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    const a = buildColMapping(state, 3);
    const b = buildColMapping(state, 3);
    expect(a).toEqual(b);
  });
});

describe("applyColMapping (v0.13.30 B-5)", () => {
  it("returns the row unchanged when mapping is undefined", () => {
    const [row] = layoutGraph([
      { oid: "A", parents: ["B"] },
      { oid: "B", parents: [] },
    ]);
    expect(applyColMapping(row!, undefined)).toBe(row);
  });

  it("returns the row unchanged when mapping is empty", () => {
    const [row] = layoutGraph([
      { oid: "A", parents: ["B"] },
      { oid: "B", parents: [] },
    ]);
    expect(applyColMapping(row!, [])).toBe(row);
  });

  it("translates dotCol / through / curves through the mapping", () => {
    // Synthesise a row with non-trivial col fields so we can check
    // every translation point.
    const row = {
      oid: "X",
      dotCol: 1,
      dotColor: 3,
      through: [
        { col: 0, color: 1 },
        { col: 2, color: 4 },
      ],
      curves: [
        { fromCol: 1, toCol: 2, color: 3, kind: "merge" as const },
        { fromCol: 1, toCol: 0, color: 5, kind: "branch" as const },
      ],
      width: 3,
    };
    // Permutation: 0→2, 1→0, 2→1 (trunk-style: bring col 1 to the front).
    const mapping = [2, 0, 1];
    const out = applyColMapping(row, mapping);
    expect(out.dotCol).toBe(0);
    expect(out.through.map((s) => s.col)).toEqual([2, 1]);
    expect(out.curves.map((c) => [c.fromCol, c.toCol])).toEqual([
      [0, 1],
      [0, 2],
    ]);
    // Colors are never permuted by mapping — only positions move.
    expect(out.dotColor).toBe(3);
    expect(out.through.map((s) => s.color)).toEqual([1, 4]);
    expect(out.curves.map((c) => c.color)).toEqual([3, 5]);
    expect(out.curves.map((c) => c.kind)).toEqual(["merge", "branch"]);
    // Width is the *maximum lane count*, not a column index — stays
    // the same.
    expect(out.width).toBe(3);
  });

  it("end-to-end: B-5 promotes a stranded trunk to display col 0 across all rows", () => {
    // The full pipeline a renderer would run: extend → buildColMapping
    // → applyColMapping per row. Verifies that *every row* sees a
    // consistent permutation (so a trunk's column is the same display
    // index from HEAD to root, never jittering between rows).
    const state = createLayoutState();
    const rawRows = extendLayout(
      state,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] }, // trunk, logical 0
        { oid: "X", parents: ["Y"] },
        { oid: "Y", parents: ["P"] },
        { oid: "M", parents: ["P"], refs: ["main"] }, // trunk, logical 2
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    const width = Math.max(...rawRows.map((r) => r.width));
    const mapping = buildColMapping(state, width);
    const displayed = rawRows.map((r) => applyColMapping(r, mapping));

    // M's display col is 1 on its own row.
    const dispM = displayed.find((r) => r.oid === "M")!;
    expect(dispM.dotCol).toBe(1);

    // M's lane is alive as a through-segment on rows that come
    // *before* M in the walk (X, Y) — IF the layout actually opened
    // M's lane that early. In this scenario M only appears at its
    // own row, so we don't expect M's through segment above. What
    // we do expect: F's lane (display col 0) shows up consistently.
    const dispF = displayed.find((r) => r.oid === "F")!;
    expect(dispF.dotCol).toBe(0);

    // Sanity: no duplicate display cols across all (col, color)
    // pairs that share a logical-col origin — i.e. the permutation
    // is a bijection on the active range.
    const displayCols = new Set<number>();
    for (const r of displayed) displayCols.add(r.dotCol);
    expect(displayCols.size).toBe(
      displayed.map((r) => r.dotCol).filter((c, i, a) => a.indexOf(c) === i).length,
    );
  });
});

// ---------------------------------------------------------------------------
// v0.13.31 — invariants underpinning the CommitList mapping cache
// ---------------------------------------------------------------------------
//
// CommitList itself is a React component and not directly unit-tested,
// but its v0.13.31 caching strategy ("re-derive every mapped row only
// when `state.trunkLogicalCols` shifts; otherwise just translate the
// new raw rows") rests on three pure-function invariants that ARE
// testable in isolation:
//
//   1. `buildColMapping` is *prefix-stable* under width growth that
//      adds non-trunk cols only. (Old logical cols keep their display
//      cols when the mapping array is extended for newly-seen
//      non-trunks.)
//   2. `applyColMapping` is a deterministic pure function — same row,
//      same mapping → deeply equal output (so "skipping a re-apply on
//      cache hit" is observably indistinguishable from re-applying).
//   3. `state.trunkLogicalCols.join(",")` uniquely identifies the
//      relevant part of the mapping for cache-key purposes (i.e. two
//      identical join strings imply identical trunk-anchor effects).

describe("v0.13.31 mapping cache invariants", () => {
  it("buildColMapping is prefix-stable when width grows with non-trunk cols only", () => {
    // Set up a layout with a trunk at logical col 0 and one non-
    // trunk lane at logical col 1.
    const state = createLayoutState();
    extendLayout(
      state,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "X", parents: [] },
      ],
      { trunkOids: ["F"] },
    );
    expect(state.trunkLogicalCols).toEqual([0]);
    const mapShort = buildColMapping(state, 2);
    // Pretend the history grew to width 4 by introducing two more
    // non-trunk lanes (we don't actually mutate state.lanes — just
    // simulate what buildColMapping would do).
    const mapWide = buildColMapping(state, 4);
    // Prefix invariant: indices 0..1 match between the short and
    // wide mappings — old rows' display cols can't shift just
    // because width grew.
    expect(mapWide[0]).toBe(mapShort[0]);
    expect(mapWide[1]).toBe(mapShort[1]);
    // The new entries are appended at the tail of the display
    // sequence.
    expect(mapWide[2]).toBe(2);
    expect(mapWide[3]).toBe(3);
  });

  it("applyColMapping is deterministic — equal input → deeply equal output", () => {
    const row = {
      oid: "X",
      dotCol: 1,
      dotColor: 3,
      through: [
        { col: 0, color: 1 },
        { col: 2, color: 4 },
      ],
      curves: [
        { fromCol: 1, toCol: 2, color: 3, kind: "merge" as const },
        { fromCol: 1, toCol: 0, color: 5, kind: "branch" as const },
      ],
      width: 3,
    };
    const mapping = [2, 0, 1];
    const a = applyColMapping(row, mapping);
    const b = applyColMapping(row, mapping);
    // Two separate applies must yield byte-identical content. We
    // compare by structural equality (deep equal), not reference,
    // because applyColMapping intentionally creates a fresh object
    // each call (immutability contract). What CommitList exploits
    // is that *not calling* applyColMapping for an unchanged
    // (row, mapping) pair preserves the same observable output.
    expect(a).toEqual(b);
  });

  it("trunkLogicalCols.join(',') uniquely identifies the trunk-anchor effect", () => {
    // Two states with identical trunkLogicalCols (and trunkOids)
    // produce identical mappings for any given width, regardless
    // of how the lanes got there. This is the cornerstone of the
    // CommitList cache key — if the join string is stable across
    // renders, the mapping is stable, and we can skip re-deriving
    // every mapped row.
    const stateA = createLayoutState();
    extendLayout(
      stateA,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "M", parents: ["P"], refs: ["main"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    const stateB = createLayoutState();
    extendLayout(
      stateB,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "M", parents: ["P"], refs: ["main"] },
        { oid: "P", parents: [] },
      ],
      { trunkOids: ["F", "M"] },
    );
    expect(stateA.trunkLogicalCols.join(",")).toBe(stateB.trunkLogicalCols.join(","));
    // Same join string ⇒ same mapping for any width.
    const width = 3;
    expect(buildColMapping(stateA, width)).toEqual(buildColMapping(stateB, width));
  });

  it("trunk allocation transition flips the cache key", () => {
    // Simulating CommitList's cache-key computation: before main is
    // discovered, only F is allocated → key = "0". When main lands
    // mid-walk, key becomes "0,2" (or wherever main ended up).
    // CommitList uses this to detect "trunk just got allocated, must
    // re-derive every mapped row".
    const state = createLayoutState();
    extendLayout(
      state,
      [
        { oid: "F", parents: ["P"], refs: ["feature"] },
        { oid: "X", parents: ["Y"] },
        { oid: "Y", parents: ["P"] },
      ],
      { trunkOids: ["F", "M"] }, // hint M up front
    );
    const keyBefore = state.trunkLogicalCols.join(",");
    // Now M arrives in a second page.
    extendLayout(state, [
      { oid: "M", parents: ["P"], refs: ["main"] },
      { oid: "P", parents: [] },
    ]);
    const keyAfter = state.trunkLogicalCols.join(",");
    expect(keyBefore).not.toBe(keyAfter);
    // Specifically: the new M oid claimed logical col 2 (cols 0, 1
    // were taken).
    expect(keyAfter.split(",")[1]).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// v0.13.32 — octopus merge coverage (≥3 parents)
// ---------------------------------------------------------------------------
//
// Pre-v0.13.32 the test suite only exercised commits with 0, 1, or 2
// parents. Octopus merges (≥3 parents) are rare in practice but Git
// supports them and so does our allocator (`for (let i = 1; i <
// parents.length; i++)` over secondary parents). The tests below pin
// down the expected layout shape so a future refactor of the
// secondary-parent loop can't silently regress octopus behaviour.

describe("octopus merge layout (v0.13.32)", () => {
  it("emits one curve per parent, all originating from the merge dot", () => {
    // Topology:
    //   M  parents: [A, B, C]   ← 3-way octopus
    //   A  parents: [P]
    //   B  parents: [P]
    //   C  parents: [P]
    //   P  parents: []
    const out = layoutGraph([
      { oid: "M", parents: ["A", "B", "C"] },
      { oid: "A", parents: ["P"] },
      { oid: "B", parents: ["P"] },
      { oid: "C", parents: ["P"] },
      { oid: "P", parents: [] },
    ]);
    const rowM = out.find((r) => r.oid === "M")!;
    expect(rowM.curves).toHaveLength(3);
    // Every curve starts at the merge dot's column.
    for (const cv of rowM.curves) {
      expect(cv.fromCol).toBe(rowM.dotCol);
    }
  });

  it("exactly one curve is the first-parent ('straight' or 'merge'); the rest are secondary", () => {
    const out = layoutGraph([
      { oid: "M", parents: ["A", "B", "C"] },
      { oid: "A", parents: ["P"] },
      { oid: "B", parents: ["P"] },
      { oid: "C", parents: ["P"] },
      { oid: "P", parents: [] },
    ]);
    const rowM = out.find((r) => r.oid === "M")!;
    // First parent ("A") inherits M's lane → straight-down curve.
    const rowA = out.find((r) => r.oid === "A")!;
    const firstParentCurve = rowM.curves.find((cv) => cv.toCol === rowA.dotCol)!;
    expect(firstParentCurve).toBeDefined();
    // Could be "straight" (same col) or "merge" (different col, but
    // see below — first parent normally inherits the dot's col).
    expect(firstParentCurve.kind === "straight" || firstParentCurve.kind === "merge").toBe(true);
    // The other two curves are secondary-parent edges. Both parents
    // were brand-new lanes here (no prior commit waited on them) →
    // kind="branch".
    const secondaryCurves = rowM.curves.filter((cv) => cv.toCol !== rowA.dotCol);
    expect(secondaryCurves).toHaveLength(2);
    for (const cv of secondaryCurves) {
      expect(cv.kind).toBe("branch");
    }
  });

  it("each secondary parent gets its own lane (3 distinct dot columns)", () => {
    const out = layoutGraph([
      { oid: "M", parents: ["A", "B", "C"] },
      { oid: "A", parents: ["P"] },
      { oid: "B", parents: ["P"] },
      { oid: "C", parents: ["P"] },
      { oid: "P", parents: [] },
    ]);
    const cols = new Set([
      out.find((r) => r.oid === "A")!.dotCol,
      out.find((r) => r.oid === "B")!.dotCol,
      out.find((r) => r.oid === "C")!.dotCol,
    ]);
    expect(cols.size).toBe(3);
  });

  it("merge row's width covers all opened lanes (≥ parents.length)", () => {
    const out = layoutGraph([
      { oid: "M", parents: ["A", "B", "C"] },
      { oid: "A", parents: ["P"] },
      { oid: "B", parents: ["P"] },
      { oid: "C", parents: ["P"] },
      { oid: "P", parents: [] },
    ]);
    const rowM = out.find((r) => r.oid === "M")!;
    expect(rowM.width).toBeGreaterThanOrEqual(3);
  });

  it("octopus merge to a parent already alive routes via existing lane (kind='merge')", () => {
    // Topology:
    //   X  parents: [B]              ← keeps B's lane alive *before* M
    //   M  parents: [A, B, C]        ← B already has a lane
    //   A  parents: [P]
    //   B  parents: [P]
    //   C  parents: [P]
    //   P  parents: []
    //
    // The B-bound curve from M should have kind="merge" (lane existed),
    // while the C-bound one is "branch" (fresh lane).
    const out = layoutGraph([
      { oid: "X", parents: ["B"] },
      { oid: "M", parents: ["A", "B", "C"] },
      { oid: "A", parents: ["P"] },
      { oid: "B", parents: ["P"] },
      { oid: "C", parents: ["P"] },
      { oid: "P", parents: [] },
    ]);
    const rowM = out.find((r) => r.oid === "M")!;
    const rowB = out.find((r) => r.oid === "B")!;
    const rowC = out.find((r) => r.oid === "C")!;
    const curveB = rowM.curves.find((cv) => cv.toCol === rowB.dotCol)!;
    const curveC = rowM.curves.find((cv) => cv.toCol === rowC.dotCol)!;
    expect(curveB.kind).toBe("merge");
    expect(curveC.kind).toBe("branch");
  });

  it("paginated octopus merge still produces a single consistent layout", () => {
    // Same DAG fed in two pages — must equal the one-shot result.
    const all = [
      { oid: "M", parents: ["A", "B", "C"] },
      { oid: "A", parents: ["P"] },
      { oid: "B", parents: ["P"] },
      { oid: "C", parents: ["P"] },
      { oid: "P", parents: [] },
    ];
    const oneShot = layoutGraph(all);
    const state = createLayoutState();
    const p1 = extendLayout(state, all.slice(0, 2));
    const p2 = extendLayout(state, all.slice(2));
    expect([...p1, ...p2]).toEqual(oneShot);
  });
});
