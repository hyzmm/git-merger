/**
 * Commit-graph lane assignment.
 *
 * Given a list of commits ordered by time/topology (newest first), produce, for
 * each row:
 *   - the lane the commit's dot sits in
 *   - the set of "lane lines" passing through this row (top->bottom segments)
 *   - the set of curves: from this commit's dot to each parent, possibly
 *     switching lanes
 *
 * Algorithm: maintain an array `lanes`, where lanes[i] is the parent oid that
 * the lane is currently waiting for. When we visit a commit C with oid O:
 *   1. Find the lane index `col` whose value === O. If none, append a new lane.
 *   2. Output a dot at (row, col).
 *   3. For each parent P of C (in order):
 *      - If first parent: replace lanes[col] = P.
 *      - Else: try to find an existing lane already waiting for P (merge
 *        target); otherwise allocate a new lane on the right.
 *   4. If C had no parents (root), free `lanes[col] = null`.
 */

export interface LaneSegment {
  /** lane indices the line passes through this row vertically (top->bottom). */
  col: number;
  color: number; // hue index 0..N
}

export interface LaneCurve {
  /** Where the curve starts (top of the row). */
  fromCol: number;
  /** Where the curve ends (bottom of the row). */
  toCol: number;
  color: number;
  /** "down": straight, "merge": merge into fromCol, "branch": branch off fromCol. */
  kind: "straight" | "merge" | "branch";
}

export interface RowLayout {
  oid: string;
  /** column of the dot on this row */
  dotCol: number;
  /** color index of the dot */
  dotColor: number;
  /** straight vertical segments passing through (lane index + color) */
  through: LaneSegment[];
  /** curves drawn for this row (commit->parent) */
  curves: LaneCurve[];
  /** total lanes occupied at this row, used for SVG width */
  width: number;
}

interface CommitInput {
  oid: string;
  parents: string[];
}

export function layoutGraph(commits: CommitInput[]): RowLayout[] {
  /** Each lane stores either null (free) or { waiting: parentOid, color }. */
  type Lane = { waiting: string; color: number } | null;
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
    // Snapshot lanes at top of row.
    const lanesBefore = lanes.map((l) => (l ? { ...l } : null));

    // Find this commit's lane (some lane is waiting for it). If none, allocate.
    let col = lanes.findIndex((l) => l !== null && l.waiting === c.oid);
    let dotColor: number;
    if (col === -1) {
      col = findFreeLane();
      dotColor = colorFor(c.oid);
    } else {
      dotColor = lanes[col]!.color;
    }

    // Process parents.
    const parents = c.parents;
    // First parent continues the current lane.
    if (parents.length === 0) {
      lanes[col] = null;
    } else {
      lanes[col] = { waiting: parents[0], color: dotColor };
      // Other parents allocate (or reuse if some other lane already waits for it).
      for (let i = 1; i < parents.length; i++) {
        const p = parents[i];
        const existing = lanes.findIndex((l) => l !== null && l.waiting === p);
        if (existing === -1) {
          const idx = findFreeLane();
          lanes[idx] = { waiting: p, color: colorFor(p) };
        }
        // else: leave it as-is; the curve will merge there.
      }
    }

    // Snapshot lanes at bottom of row.
    const lanesAfter = lanes.map((l) => (l ? { ...l } : null));

    // Build "through" segments: any lane that is non-null in BOTH before & after
    // and not the dot column counts as passing through.
    const through: LaneSegment[] = [];
    const maxLen = Math.max(lanesBefore.length, lanesAfter.length);
    for (let i = 0; i < maxLen; i++) {
      const b = lanesBefore[i] ?? null;
      const a = lanesAfter[i] ?? null;
      if (i === col) continue;
      if (b && a && b.waiting === a.waiting) {
        through.push({ col: i, color: b.color });
      }
    }

    // Build curves.
    const curves: LaneCurve[] = [];
    // a) The "incoming" lane: if before had a lane !== col waiting for c.oid we'd
    //    have used it as col already — so no incoming merge from a different col.
    // b) For each parent of c, draw a curve from `col` to the lane that ends up
    //    waiting for that parent.
    parents.forEach((p, i) => {
      const targetCol = lanes.findIndex((l) => l !== null && l.waiting === p);
      if (targetCol === -1) return;
      if (i === 0) {
        if (targetCol === col) {
          curves.push({ fromCol: col, toCol: col, color: dotColor, kind: "straight" });
        } else {
          // First parent shifted columns (rare, but possible if first parent was
          // already in another lane). Treat as "merge" visually.
          curves.push({
            fromCol: col,
            toCol: targetCol,
            color: dotColor,
            kind: "merge",
          });
        }
      } else {
        // Secondary parent: branching out (or merging into existing lane).
        const wasExisting =
          lanesBefore[targetCol] !== null && lanesBefore[targetCol]!.waiting === p;
        curves.push({
          fromCol: col,
          toCol: targetCol,
          color: lanes[targetCol]!.color,
          kind: wasExisting ? "merge" : "branch",
        });
      }
    });

    // Trim trailing null lanes for tighter width estimate.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const width = Math.max(
      lanesBefore.length,
      lanesAfter.length,
      col + 1,
      ...curves.map((c) => Math.max(c.fromCol, c.toCol) + 1),
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
