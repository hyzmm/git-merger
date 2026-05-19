/**
 * Commit-graph lane assignment.
 *
 * Given a list of commits ordered by time/topology (newest first), produce, for
 * each row:
 *   - the lane the commit's dot sits in
 *   - the set of "lane lines" passing through this row (top->bottom segments)
 *   - the set of curves: from this commit's dot to each parent, possibly
 *     switching lanes
 */

export interface LaneSegment {
  col: number;
  color: number;
}

export interface LaneCurve {
  fromCol: number;
  toCol: number;
  color: number;
  kind: "straight" | "merge" | "branch";
}

export interface RowLayout {
  oid: string;
  dotCol: number;
  dotColor: number;
  through: LaneSegment[];
  curves: LaneCurve[];
  width: number;
}

interface CommitInput {
  oid: string;
  parents: string[];
}

type Lane = { waiting: string; color: number } | null;

export function layoutGraph(commits: CommitInput[]): RowLayout[] {
  const lanes: Lane[] = [];
  const oidColor = new Map<string, number>();
  let nextColor = 0;

  function colorFor(oid: string): number {
    let c = oidColor.get(oid);
    if (c === undefined) {
      c = nextColor++ % 6;
      oidColor.set(oid, c);
    }
    return c;
  }

  function findFreeLane(): number {
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === null) return i;
    lanes.push(null);
    return lanes.length - 1;
  }

  const out: RowLayout[] = [];

  for (const c of commits) {
    // 1) Determine the dot column. If some lane is already waiting for this
    //    commit, reuse it; otherwise allocate a fresh lane.
    let col = lanes.findIndex((l) => l !== null && l.waiting === c.oid);
    let dotColor: number;
    if (col === -1) {
      col = findFreeLane(); // may push a null entry
      dotColor = colorFor(c.oid);
      lanes[col] = { waiting: c.oid, color: dotColor }; // placeholder so snapshot captures it
    } else {
      dotColor = lanes[col]!.color;
    }

    // 2) Snapshot the lanes BEFORE we mutate them for parents. Note: lanes now
    //    contains an entry at `col` waiting for c.oid, which represents the
    //    line *coming into* this row from above.
    const lanesBefore: Lane[] = lanes.map((l) => (l ? { ...l } : null));

    // 3) Process parents.
    const parents = c.parents;
    if (parents.length === 0) {
      // Root commit: this lane terminates here.
      lanes[col] = null;
    } else {
      // First parent continues this lane.
      lanes[col] = { waiting: parents[0], color: dotColor };
      for (let i = 1; i < parents.length; i++) {
        const p = parents[i];
        const existing = lanes.findIndex((l) => l !== null && l.waiting === p);
        if (existing === -1) {
          const idx = findFreeLane();
          lanes[idx] = { waiting: p, color: colorFor(p) };
        }
        // else: that parent is already waited on by another lane; the curve
        // will simply merge into it.
      }
    }

    // 4) Snapshot the lanes AFTER mutations.
    const lanesAfter: Lane[] = lanes.map((l) => (l ? { ...l } : null));

    // 5) Build "through" segments — lanes that pass through this row vertically
    //    (i.e. were occupied at top AND at bottom with same target, and are not
    //    the dot column).
    const through: LaneSegment[] = [];
    const maxLen = Math.max(lanesBefore.length, lanesAfter.length);
    for (let i = 0; i < maxLen; i++) {
      if (i === col) continue;
      const b = lanesBefore[i] ?? null;
      const a = lanesAfter[i] ?? null;
      if (b && a && b.waiting === a.waiting) {
        through.push({ col: i, color: b.color });
      }
    }

    // 6) Build curves — one per parent, going from `col` (top half of dot) to
    //    the lane that ends up waiting for that parent (bottom half).
    const curves: LaneCurve[] = [];
    parents.forEach((p, i) => {
      const targetCol = lanes.findIndex((l) => l !== null && l.waiting === p);
      if (targetCol === -1) return;
      const targetLane = lanes[targetCol];
      if (!targetLane) return;
      if (i === 0) {
        if (targetCol === col) {
          curves.push({ fromCol: col, toCol: col, color: dotColor, kind: "straight" });
        } else {
          curves.push({
            fromCol: col,
            toCol: targetCol,
            color: dotColor,
            kind: "merge",
          });
        }
      } else {
        const before = lanesBefore[targetCol];
        const wasExisting = !!before && before.waiting === p;
        curves.push({
          fromCol: col,
          toCol: targetCol,
          color: targetLane.color,
          kind: wasExisting ? "merge" : "branch",
        });
      }
    });

    const width = Math.max(
      1,
      lanesBefore.length,
      lanesAfter.length,
      col + 1,
      ...curves.map((cc) => Math.max(cc.fromCol, cc.toCol) + 1),
    );

    out.push({
      oid: c.oid,
      dotCol: col,
      dotColor,
      through,
      curves,
      width,
    });
  }

  return out;
}
