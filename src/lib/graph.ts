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

/**
 * Mutable state carried between calls to {@link extendLayout}. Allocate
 * once per logical history walk via {@link createLayoutState}, then keep
 * passing the same instance as you append more commits at the end of
 * the list. The shape is intentionally JSON-cloneable so a Zustand store
 * can persist it if needed.
 */
export interface LayoutState {
  lanes: Lane[];
  oidColor: Map<string, number>;
  nextColor: number;
}

export function createLayoutState(): LayoutState {
  return {
    lanes: [],
    oidColor: new Map(),
    nextColor: 0,
  };
}

/**
 * Append `commits` to a running layout, mutating `state` in place and
 * returning the rows produced for the new commits only.
 *
 * The lane allocator is stateful (a parent commit on the previous page may
 * be the second parent of a commit on this one and reuse a still-waiting
 * lane), so callers MUST feed pages in walk order — same order the backend
 * yielded them — and MUST NOT skip pages. Filtering / re-ordering happens
 * later, on the laid-out rows.
 */
export function extendLayout(state: LayoutState, commits: CommitInput[]): RowLayout[] {
  function colorFor(oid: string): number {
    let c = state.oidColor.get(oid);
    if (c === undefined) {
      c = state.nextColor++ % 6;
      state.oidColor.set(oid, c);
    }
    return c;
  }

  function findFreeLane(): number {
    for (let i = 0; i < state.lanes.length; i++) if (state.lanes[i] === null) return i;
    state.lanes.push(null);
    return state.lanes.length - 1;
  }

  const out: RowLayout[] = [];

  for (const c of commits) {
    // 1) Determine the dot column. If some lane is already waiting for this
    //    commit, reuse it; otherwise allocate a fresh lane.
    let col = state.lanes.findIndex((l) => l !== null && l.waiting === c.oid);
    let dotColor: number;
    if (col === -1) {
      col = findFreeLane();
      dotColor = colorFor(c.oid);
      state.lanes[col] = { waiting: c.oid, color: dotColor };
    } else {
      dotColor = state.lanes[col]!.color;
    }

    const lanesBefore: Lane[] = state.lanes.map((l) => (l ? { ...l } : null));

    // 3) Process parents.
    const parents = c.parents;
    if (parents.length === 0) {
      state.lanes[col] = null;
    } else {
      state.lanes[col] = { waiting: parents[0], color: dotColor };
      for (let i = 1; i < parents.length; i++) {
        const p = parents[i];
        const existing = state.lanes.findIndex((l) => l !== null && l.waiting === p);
        if (existing === -1) {
          const idx = findFreeLane();
          state.lanes[idx] = { waiting: p, color: colorFor(p) };
        }
      }
    }

    const lanesAfter: Lane[] = state.lanes.map((l) => (l ? { ...l } : null));

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

    const curves: LaneCurve[] = [];
    parents.forEach((p, i) => {
      const targetCol = state.lanes.findIndex((l) => l !== null && l.waiting === p);
      if (targetCol === -1) return;
      const targetLane = state.lanes[targetCol];
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

/**
 * One-shot layout for a complete commit list. Equivalent to
 * `extendLayout(createLayoutState(), commits)` but kept as a top-level
 * export to preserve the v0.1.0 API and simple call sites that don't
 * need incremental state.
 */
export function layoutGraph(commits: CommitInput[]): RowLayout[] {
  return extendLayout(createLayoutState(), commits);
}
