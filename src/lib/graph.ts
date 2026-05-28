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
 * Coloring (v0.13.23 + v0.13.27)
 * ------------------------------
 * Every lane carries a palette slot in [0, BRANCH_PALETTE_SIZE) plus a
 * `colorPinned` flag. The slot is chosen at lane *creation* time and
 * prefers the branch / ref short name attached to the commit (so `main`
 * is always the same color across launches and matches the dot in
 * RefsPane). When no ref is attached we fall back to hashing the oid so
 * at least re-renders of the same DAG stay visually stable.
 *
 * **First-parent inheritance** (v0.13.23): when a commit has parents,
 * its first parent keeps the dot's lane *and* its color. That's why a
 * long fast-forward branch (e.g. main from HEAD all the way back to the
 * root) renders as a single uninterrupted column of the same hue.
 *
 * **Lane-reuse re-coloring** (v0.13.27, candidate B-2): a lane opened
 * with a tentative oid-hash color (typically pre-allocated as the
 * right-hand side of an earlier merge, before the commit's ref was
 * visible) is *upgraded* to the proper ref-name color the moment a
 * commit carrying refs lands in that lane. `colorPinned` distinguishes
 * the two states so we never re-color a lane whose color is already
 * authoritative — main's column stays one hue all the way down.
 *
 * **Merge-edge coloring** (v0.13.28, candidate B-3): a merge commit's
 * non-first-parent curve that **lands on an already-existing lane**
 * (kind="merge", e.g. `git merge feature` while feature is still alive
 * in some lane to the right) is now drawn in the **merge commit's own
 * color**, not the absorbed branch's color. Visually this matches
 * IDEA: the line is the merge commit *reaching across* to absorb a
 * tip, so it belongs to the branch issuing the merge. Curves to
 * brand-new lanes (kind="branch", side branches *first* appearing at
 * the merge row) keep the new lane's color so the side branch reads
 * as its own column going down — that's the side branch starting
 * here, not the merge reaching for it.
 *
 * **Trunk lane anchoring** (v0.13.29, candidate B-4): callers may pass
 * an ordered `trunkOids` hint (e.g. `[HEAD, main, develop]`) and the
 * allocator will *prefer* to place those commits on the matching low
 * column index — `trunkOids[0]` → col 0, `trunkOids[1]` → col 1, etc.
 * The preference only applies at lane-creation time and only when the
 * preferred column is free; we never *evict* an already-allocated
 * lane (that would retroactively rewrite already-emitted RowLayouts
 * on a paginated walk and break the v0.13.21 increment contract). In
 * practice this means: HEAD's commit is `commits[0]` so its lane
 * lands in col 0 trivially; `main`'s tip, if it appears later, slots
 * into col 1 instead of col 2/3/etc. — provided col 1 isn't already
 * holding a non-trunk side branch. Combined with first-parent
 * inheritance (B-1), the entire main column then runs straight down
 * the second physical lane while a feature branch the user just
 * checked out keeps the leftmost column for itself.
 *
 * **Render-time column re-mapping** (v0.13.30, candidate B-5): the
 * "never evict" rule of B-4 means a trunk that arrives mid-history
 * after a non-trunk side branch already took its preferred logical
 * column gets bumped right. To still ship the IDEA-style "trunks
 * always leftmost" guarantee without rewriting RowLayouts, we expose
 * {@link buildColMapping} — a pure function over the layout state
 * that returns a `logicalCol → displayCol` permutation: trunks
 * (recorded as they're allocated, in their `trunkOids` priority
 * order) get the lowest display columns, and every other logical
 * column keeps its relative order behind them. Renderers (GraphRow,
 * GraphRow's curve paths, through-segments) take the mapping from
 * the layout cache and translate at draw time. The lane allocator's
 * outputs are still byte-for-byte identical to B-4; B-5 is purely a
 * presentation-layer transform. A side effect of this design: when
 * a new page arrives carrying a trunk that wasn't visible before,
 * the mapping shifts and *all on-screen rows* re-render to put the
 * newly-known trunk on its anchored display column. This is the
 * intended behaviour and matches IDEA's own re-shuffle on
 * progressive load.
 */

import { branchSlotForName, BRANCH_PALETTE_SIZE } from "./branchColors";

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
  /**
   * Ref short names that point at this commit (branch tips, tags). When
   * present, the *first* entry is preferred for color hashing — same input
   * the RefsPane uses, so colors line up between the two surfaces. May be
   * empty / absent (the 99% case, for commits in the middle of history).
   */
  refs?: string[];
}

type Lane = { waiting: string; color: number; colorPinned: boolean } | null;

/**
 * Mutable state carried between calls to {@link extendLayout}. Allocate
 * once per logical history walk via {@link createLayoutState}, then keep
 * passing the same instance as you append more commits at the end of
 * the list. The shape is intentionally JSON-cloneable so a Zustand store
 * can persist it if needed.
 */
export interface LayoutState {
  lanes: Lane[];
  /**
   * v0.13.27 — only **pinned** colors are memoised here. Unpinned
   * (oid-hash placeholder) colors are recomputed on demand so the
   * "lane reuse upgrades to ref color" path doesn't fight a stale
   * cache entry from an earlier visit. Pinned entries are stable
   * forever — once `main` is blue, it stays blue across reloads.
   */
  oidColor: Map<string, number>;
  /**
   * Single sequential counter used as a last-resort tiebreaker when neither
   * the commit's ref names nor its oid hash give us a slot we like. Kept on
   * the state so re-renders don't drift, but in practice it rarely advances
   * because oid hashing covers almost everything.
   */
  nextColor: number;
  /**
   * v0.13.29 B-4 — ordered list of "trunk" commit oids the caller wants
   * anchored to low columns. `trunkOids[i]` is preferred for col `i`.
   * Typical input: `[HEAD oid, main tip oid, develop tip oid, ...]`
   * collected by the store from the repo's branch metadata. Order is
   * significant — earlier entries win lower columns. Only consulted at
   * lane-creation time; existing lanes are never evicted, so feeding
   * trunk hints across paginated calls is safe and the increment
   * contract from v0.13.21 holds.
   */
  trunkOids: string[];
  /**
   * v0.13.30 B-5 — for each oid in `trunkOids` that has actually been
   * allocated a lane during the walk, the *logical* column index it
   * landed in. Indexed by `trunkOids` position: `trunkLogicalCols[i]`
   * is either the logical col of `trunkOids[i]`'s lane (a number ≥ 0)
   * or `-1` if that trunk hasn't appeared yet. This is the raw input
   * for {@link buildColMapping} — the renderer turns it into a
   * permutation that puts allocated trunks on the leftmost display
   * columns even if they didn't manage to grab the matching logical
   * column at allocation time (B-4's no-eviction rule sometimes pushes
   * them right).
   */
  trunkLogicalCols: number[];
}

export function createLayoutState(): LayoutState {
  return {
    lanes: [],
    oidColor: new Map(),
    nextColor: 0,
    trunkOids: [],
    trunkLogicalCols: [],
  };
}

/**
 * v0.13.29 B-4 — optional knobs for {@link extendLayout}. Only
 * `trunkOids` is currently exposed; future B-series candidates may
 * extend this without breaking the call surface.
 */
export interface ExtendLayoutOptions {
  /**
   * Commit oids that should be biased toward low columns, in priority
   * order. Merged into {@link LayoutState.trunkOids} on each call so
   * a paginated walk can refine the hint as more refs become known.
   * Existing entries keep their slot (the *first* time we see a trunk
   * oid wins — feeding the same oid again is a no-op, not a re-rank).
   */
  trunkOids?: readonly string[];
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
export function extendLayout(
  state: LayoutState,
  commits: CommitInput[],
  options?: ExtendLayoutOptions,
): RowLayout[] {
  // v0.13.29 B-4 — fold incoming trunk hints into state. We append
  // (preserving first-seen order) instead of replacing so a later
  // page can refine the hint without rewinding a hint we already
  // honoured on an earlier page.
  if (options?.trunkOids && options.trunkOids.length > 0) {
    const seen = new Set(state.trunkOids);
    for (const oid of options.trunkOids) {
      if (!seen.has(oid)) {
        state.trunkOids.push(oid);
        // v0.13.30 B-5 — keep `trunkLogicalCols` length-aligned with
        // `trunkOids`. The slot is filled in when the trunk's lane
        // is actually allocated (see {@link recordTrunkLaneIfNeeded}).
        state.trunkLogicalCols.push(-1);
        seen.add(oid);
      }
    }
  }
  /**
   * Pick a palette slot for a commit. Returns the slot **and** whether
   * the choice should be considered final (`pinned`):
   *   - `refs[0]` present → ref-hashed slot, pinned = true.
   *   - no refs → oid-hashed slot, pinned = false (placeholder; can be
   *     upgraded later if the same oid turns out to carry refs after
   *     all, e.g. a second-parent that we pre-allocated by oid).
   *
   * Pinned slots are also memoised on `state.oidColor` so a later visit
   * to the same oid (typically as a parent reference from another row)
   * picks up the authoritative color. Unpinned slots are deliberately
   * **not** memoised — re-deriving them is cheap and we don't want a
   * stale placeholder beating an authoritative ref-hashed answer.
   */
  function colorFor(oid: string, refs?: string[]): { slot: number; pinned: boolean } {
    // Pinned cache hit — keep it. This is what stabilises e.g. `main`
    // across both lane reuses *and* paginated re-walks.
    const cached = state.oidColor.get(oid);
    if (cached !== undefined) return { slot: cached, pinned: true };

    if (refs && refs.length > 0) {
      const slot = branchSlotForName(refs[0]!);
      state.oidColor.set(oid, slot);
      state.nextColor = (state.nextColor + 1) % BRANCH_PALETTE_SIZE;
      return { slot, pinned: true };
    }
    // No refs — oid-hash placeholder. Don't memoise; if a future call
    // sees this oid with refs we want the ref hash to win.
    return { slot: branchSlotForName(oid), pinned: false };
  }

  function findFreeLane(): number {
    for (let i = 0; i < state.lanes.length; i++) if (state.lanes[i] === null) return i;
    state.lanes.push(null);
    return state.lanes.length - 1;
  }

  /**
   * v0.13.29 B-4 — try to place `oid` on its preferred trunk column.
   * Returns the chosen column when the trunk hint can be honoured
   * (oid is in `trunkOids` AND its target column is currently free
   * within the existing lanes range), or `-1` when the caller should
   * fall back to {@link findFreeLane}.
   *
   * Why we never evict: lane indexes returned for previous rows are
   * already part of immutable {@link RowLayout}s — clobbering an
   * existing lane to honour a late-arriving trunk hint would
   * retroactively make those rows lie about which column their
   * through-segment belongs to. So the rule is "prefer if you can,
   * accept if you can't": HEAD wins col 0 trivially because it's
   * `commits[0]` and `lanes[0]` is null at that moment; `main`'s tip,
   * arriving later, gets col 1 *if free*, else takes the next free
   * slot like any other branch.
   *
   * v0.13.33 — **never grow lanes preemptively**. Earlier versions
   * did `while (lanes.length <= target) lanes.push(null)` to expose
   * the target slot, which had a subtle bug: a "phantom" trunk
   * (configured in `trunkOids` but whose tip oid never appears in
   * the visible commit window — e.g. detached HEAD with main far
   * out of view) would permanently inflate `lanes.length`, padding
   * every `RowLayout.width` with empty trailing slots and bloating
   * the graph SVG horizontally. Lazy allocation: we only honour the
   * trunk hint when its target col is *already* in range and free;
   * otherwise we let `findFreeLane` pick the lowest free slot. The
   * B-5 mapping ({@link buildColMapping}) then pulls the trunk to
   * its display col 0..N-1 anyway, so the visual contract still
   * holds — just without the phantom padding.
   */
  function findTrunkLaneFor(oid: string): number {
    const target = state.trunkOids.indexOf(oid);
    if (target === -1) return -1;
    // Lazy: don't preallocate slots for trunks that haven't shown up.
    if (target >= state.lanes.length) return -1;
    if (state.lanes[target] === null) return target;
    return -1;
  }

  /**
   * v0.13.30 B-5 — once a trunk oid actually lands in a logical
   * column (whether via {@link findTrunkLaneFor} or fallback through
   * {@link findFreeLane}), record that column on `trunkLogicalCols`
   * so the renderer's permutation can promote it to the front. No-op
   * for non-trunk oids and idempotent for trunk oids that already
   * have a recorded column (subsequent visits — e.g. when the same
   * oid surfaces as a parent reference — must not corrupt the
   * recorded slot).
   */
  function recordTrunkLaneIfNeeded(oid: string, col: number): void {
    const idx = state.trunkOids.indexOf(oid);
    if (idx === -1) return;
    if (state.trunkLogicalCols[idx] === -1) {
      state.trunkLogicalCols[idx] = col;
    }
  }

  const out: RowLayout[] = [];

  for (const c of commits) {
    // 1) Determine the dot column. If some lane is already waiting for this
    //    commit, reuse it; otherwise allocate a fresh lane.
    let col = state.lanes.findIndex((l) => l !== null && l.waiting === c.oid);
    let dotColor: number;
    let dotPinned: boolean;
    if (col === -1) {
      // New lane: this commit isn't tracked yet — typically a fresh branch
      // tip popping into the walk. Color comes from the ref name when we
      // have one; this is the path that makes `main` always blue, etc.
      // v0.13.29 B-4 — if this oid is a known trunk, try its anchored
      // column first; otherwise fall back to the lowest free slot.
      const trunkCol = findTrunkLaneFor(c.oid);
      col = trunkCol !== -1 ? trunkCol : findFreeLane();
      const picked = colorFor(c.oid, c.refs);
      dotColor = picked.slot;
      dotPinned = picked.pinned;
      state.lanes[col] = { waiting: c.oid, color: dotColor, colorPinned: dotPinned };
      // v0.13.30 B-5 — track trunk → logical-col so the renderer can
      // promote it to a leftmost display column even when B-4 fell
      // through to findFreeLane (i.e. the trunk's anchored col was
      // taken).
      recordTrunkLaneIfNeeded(c.oid, col);
    } else {
      // Lane reuse: by default inherit the lane's color (first-parent
      // inheritance — the lane was opened by a child a few rows ago).
      const lane = state.lanes[col]!;
      dotColor = lane.color;
      dotPinned = lane.colorPinned;
      // v0.13.27 B-2 — if the lane's color is still a placeholder
      // (lane was opened as a merge's right-hand side via oid hash)
      // and *this* commit carries refs, upgrade to the ref-hashed
      // color and pin the lane. Without this, two unrelated branches
      // recycling the same physical lane index would share a hue.
      if (!dotPinned && c.refs && c.refs.length > 0) {
        const upgraded = colorFor(c.oid, c.refs);
        dotColor = upgraded.slot;
        dotPinned = true;
        lane.color = dotColor;
        lane.colorPinned = true;
      } else if (dotPinned && !state.oidColor.has(c.oid)) {
        // Pinned lane → memoise so future parent references hit cache.
        state.oidColor.set(c.oid, dotColor);
      }
      // v0.13.30 B-5 — a trunk oid may first surface here (the lane
      // was pre-allocated as some merge's secondary-parent placeholder
      // by oid). Record its logical col now if not already known.
      recordTrunkLaneIfNeeded(c.oid, col);
    }

    const lanesBefore: Lane[] = state.lanes.map((l) => (l ? { ...l } : null));

    // 3) Process parents.
    const parents = c.parents;
    if (parents.length === 0) {
      state.lanes[col] = null;
    } else {
      // First parent: same lane, same color, **same pin status** — a
      // long pinned column (main from HEAD to root) stays pinned all
      // the way down even if the deeper commits don't carry refs.
      state.lanes[col] = { waiting: parents[0], color: dotColor, colorPinned: dotPinned };
      for (let i = 1; i < parents.length; i++) {
        const p = parents[i];
        const existing = state.lanes.findIndex((l) => l !== null && l.waiting === p);
        if (existing === -1) {
          // Merge's secondary parent — the side branch being absorbed.
          // Color it from the parent oid hash. **Not pinned** by
          // default — if the parent commit eventually shows up with
          // refs we'll upgrade the lane's color in the lane-reuse
          // branch above. (If the parent oid happens to already be in
          // the pinned cache from elsewhere, `colorFor` returns
          // pinned=true and we honour that.)
          // v0.13.29 B-4 — same trunk-anchor logic as the dot-lane
          // path: if this parent is itself a trunk tip (typical when
          // a feature branch HEAD merges *from* main), prefer its
          // anchored column.
          const trunkIdx = findTrunkLaneFor(p);
          const idx = trunkIdx !== -1 ? trunkIdx : findFreeLane();
          const placeholder = colorFor(p);
          state.lanes[idx] = {
            waiting: p,
            color: placeholder.slot,
            colorPinned: placeholder.pinned,
          };
          // v0.13.30 B-5 — secondary-parent path can also surface a
          // trunk oid for the first time (e.g. a feature branch
          // merges main into itself, opening main's lane here).
          recordTrunkLaneIfNeeded(p, idx);
        }
        // Otherwise an existing lane is already waiting for this parent
        // (octopus criss-cross), keep its color.
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
        // v0.13.28 B-3 — pick the curve color based on what this edge
        // *means*:
        //   - kind="merge"  (lane already existed → we're reaching
        //     across to absorb it): paint with the merge commit's own
        //     color. The line is the merge issuing the absorb; the
        //     absorbed branch keeps its own hue *below* this row via
        //     its through-segment / dot-up.
        //   - kind="branch" (lane was just opened for this parent →
        //     side branch is starting here): paint with the new
        //     lane's color so the side branch reads as a separate
        //     column going down.
        const kind: LaneCurve["kind"] = wasExisting ? "merge" : "branch";
        const color = kind === "merge" ? dotColor : targetLane.color;
        curves.push({
          fromCol: col,
          toCol: targetCol,
          color,
          kind,
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
 * `extendLayout(createLayoutState(), commits, options)` but kept as a
 * top-level export to preserve the v0.1.0 API and simple call sites
 * that don't need incremental state.
 */
export function layoutGraph(commits: CommitInput[], options?: ExtendLayoutOptions): RowLayout[] {
  return extendLayout(createLayoutState(), commits, options);
}

/**
 * v0.13.30 B-5 — build a `logicalCol → displayCol` permutation from
 * the layout state, given the current logical-col high-water mark
 * (`width`, typically the maximum `RowLayout.width` across all
 * emitted rows).
 *
 * The permutation puts trunks (in their `state.trunkOids` priority
 * order) on the leftmost display columns, then keeps every other
 * logical column in its original numeric order behind them. Only
 * trunks that were actually allocated a lane (logical col != -1)
 * contribute; trunks with no lane yet are silently skipped.
 *
 * **Stability**: identical state + identical width → identical
 * mapping, byte-for-byte. Two non-overlapping trunks never collide
 * because `trunkLogicalCols` is built incrementally and a logical
 * column is owned by exactly one allocator path. The renderer can
 * memoise on `(state.trunkLogicalCols, width)`.
 *
 * **Width input**: pass `Math.max(1, max(row.width for row in rows))`.
 * The mapping is defined on `[0, width)`. If the renderer encounters
 * a logical col equal to or beyond `width` (shouldn't happen if you
 * pass a correct `width`, but defensive code is cheap), look it up
 * via `mapping.get(col) ?? col` to fall through to identity.
 *
 * Returns a flat array `mapping` where `mapping[logicalCol] = displayCol`.
 * Inverse-permutation form (`displayToLogical`) is straightforward to
 * derive but not exported because GraphRow only needs the forward map.
 */
export function buildColMapping(state: LayoutState, width: number): number[] {
  // Collect logical cols that belong to a trunk, in trunkOids order.
  // -1 means the trunk hasn't been allocated yet — skip it.
  const trunkCols: number[] = [];
  const trunkSet = new Set<number>();
  for (const lc of state.trunkLogicalCols) {
    if (lc < 0) continue;
    if (lc >= width) continue;
    if (trunkSet.has(lc)) continue; // defensive — duplicates shouldn't happen
    trunkCols.push(lc);
    trunkSet.add(lc);
  }
  // Non-trunk logical cols, in ascending numeric order — preserves
  // their relative emit order so unrelated side branches don't
  // suddenly swap places when a new trunk shows up.
  const nonTrunkCols: number[] = [];
  for (let i = 0; i < width; i++) {
    if (!trunkSet.has(i)) nonTrunkCols.push(i);
  }
  // displayToLogical: trunks first, then everything else.
  const displayToLogical = [...trunkCols, ...nonTrunkCols];
  // Invert.
  const mapping = new Array<number>(width);
  for (let display = 0; display < displayToLogical.length; display++) {
    mapping[displayToLogical[display]!] = display;
  }
  return mapping;
}

/**
 * v0.13.30 B-5 — apply a column permutation built by
 * {@link buildColMapping} to a single {@link RowLayout}, returning a
 * fresh row whose `dotCol`, `through[].col`, `curves[].fromCol`,
 * `curves[].toCol`, and `width` are expressed in **display** columns.
 *
 * Pure / non-mutating. Renderers should call this once per row at
 * draw time and feed the result to GraphRow as if it were the raw
 * layout. The original `RowLayout` is left untouched, preserving the
 * v0.13.21 increment contract for any consumers still working in
 * logical-col space.
 *
 * If `mapping` is `undefined` or empty (B-5 disabled / no trunks
 * known), the row is returned unchanged.
 */
export function applyColMapping(row: RowLayout, mapping: number[] | undefined): RowLayout {
  if (!mapping || mapping.length === 0) return row;
  const m = (col: number): number => mapping[col] ?? col;
  return {
    oid: row.oid,
    dotCol: m(row.dotCol),
    dotColor: row.dotColor,
    through: row.through.map((seg) => ({ col: m(seg.col), color: seg.color })),
    curves: row.curves.map((cv) => ({
      fromCol: m(cv.fromCol),
      toCol: m(cv.toCol),
      color: cv.color,
      kind: cv.kind,
    })),
    width: row.width,
  };
}
