import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useApp } from "@/stores/app";
import { useSettings } from "@/stores/settings";
import {
  applyColMapping,
  buildColMapping,
  createLayoutState,
  extendLayout,
  type LayoutState,
  type RowLayout,
} from "@/lib/graph";
import { computeTrunkOids } from "@/lib/trunkOids";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { GraphRow, GRAPH_LANE_WIDTH } from "./GraphRow";
import { GraphSkeleton } from "./GraphSkeleton";
import { HistoryFilterBar } from "./HistoryFilterBar";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";
import type { CommitSummary } from "@/ipc/git";

const ROW_HEIGHT = 28;

/**
 * v0.13.6 — hard cap on the graph column's pixel width, no matter how many
 * lanes the history actually has. Heavy-fork repos used to push this past
 * 200 px and crowd out the commit summary; now we cap and let the graph
 * SVG scroll horizontally **inside** its own column instead.
 */
const GRAPH_COL_CAP = { normal: 220, compact: 140 } as const;

interface MenuState {
  pos: ContextMenuPos;
  items: MenuItem[];
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback: textarea + execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

export function CommitList() {
  const commits = useApp((s) => s.history.commits);
  // v0.13.29 B-4 — feed the lane allocator a trunk hint derived from
  // refs (HEAD + main/master/develop/dev/trunk if present). The hint
  // is best-effort: see `lib/graph.ts` "Trunk lane anchoring" — it
  // never evicts a lane to honour a hint, so the visual outcome on
  // typical histories is identical to baseline. The hookup exists so
  // a future B-5 (lane permutation / rebalance) has the data channel
  // ready.
  const refs = useApp((s) => s.history.refs);
  const filter = useApp((s) => s.history.filter);
  const authorFilter = useApp((s) => s.history.authorFilter);
  const sinceFilter = useApp((s) => s.history.sinceFilter);
  const untilFilter = useApp((s) => s.history.untilFilter);
  const pathspec = useApp((s) => s.history.pathspec);
  const selectedOid = useApp((s) => s.history.selectedOid);
  // v0.13.26 — multi-selection set used for batch cherry-pick. The
  // `selected` flag below highlights every member; the focused row
  // (selectedOid) gets the same accent so the boundary visually folds
  // into "the click is the focus".
  const selectedOids = useApp((s) => s.history.selectedOids);
  const loading = useApp((s) => s.history.loading);
  const loadingMore = useApp((s) => s.history.loadingMore);
  const hasMore = useApp((s) => s.history.hasMore);
  const error = useApp((s) => s.history.error);
  const selectCommit = useApp((s) => s.selectCommit);
  const selectCommitMulti = useApp((s) => s.selectCommitMulti);
  const clearCommitMultiSelect = useApp((s) => s.clearCommitMultiSelect);
  const loadMoreHistory = useApp((s) => s.loadMoreHistory);
  const checkoutCommit = useApp((s) => s.checkoutCommit);
  const cherryPick = useApp((s) => s.cherryPick);
  const cherryPickMany = useApp((s) => s.cherryPickMany);
  const revertCommit = useApp((s) => s.revertCommit);
  const resetTo = useApp((s) => s.resetTo);
  const openRebasePlan = useApp((s) => s.openRebasePlan);
  const createBranch = useApp((s) => s.createBranch);
  const createTag = useApp((s) => s.createTag);
  const confirm = useApp((s) => s.confirm);
  // v0.13.16 — graph reachability highlight.
  const highlightOid = useApp((s) => s.history.highlightOid);
  const highlightMode = useApp((s) => s.history.highlightMode);
  const highlightSet = useApp((s) => s.history.highlightSet);
  const highlightLoading = useApp((s) => s.history.highlightLoading);
  const highlightAncestors = useApp((s) => s.highlightAncestors);
  const highlightDescendants = useApp((s) => s.highlightDescendants);
  const clearHighlight = useApp((s) => s.clearHighlight);

  // v0.13.6 — graph display mode (normal / compact / hidden). Persisted in
  // the settings store so the user's choice survives restarts.
  const graphMode = useSettings((s) => s.graphMode);

  const [menu, setMenu] = useState<MenuState | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return commits.filter((c) => {
      if (authorFilter && c.author_name !== authorFilter) return false;
      if (sinceFilter !== null && c.time < sinceFilter) return false;
      if (untilFilter !== null && c.time > untilFilter) return false;
      if (q) {
        const hit =
          c.summary.toLowerCase().includes(q) ||
          c.author_name.toLowerCase().includes(q) ||
          c.author_email.toLowerCase().includes(q) ||
          c.oid.startsWith(q) ||
          c.refs.some((r) => r.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [commits, filter, authorFilter, sinceFilter, untilFilter]);

  // ---------- Incremental graph layout ----------
  // The layout allocator is stateful (parent commits on previous pages keep
  // lanes alive), so we carry state across renders and only walk *new*
  // commits when the array grows by appending. If `commits` is reset
  // (loadHistory after a filter change or repo switch), we rebuild from
  // scratch. We key by `commits` array identity + length to detect both.
  // v0.13.30 B-5 — the cache stores `rawRowsByOid` in the allocator's
  // *logical* column space (stable across paginated calls). The
  // displayed `rowsByOid` is derived from `rawRowsByOid` by applying
  // the trunk-anchored column permutation built from `state` at
  // memoisation time, which lets newly-discovered trunks pull
  // themselves to the leftmost display column without rewriting any
  // raw row.
  // v0.13.31 — cache the mapped output too, keyed by
  // `(trunkLogicalCols, maxRawWidth)`. When the key is unchanged
  // across renders (the common case: a `commits` append that doesn't
  // surface a new trunk), we only `applyColMapping` to the *new* raw
  // rows and leave existing mapped rows at their original references
  // — that's what lets memoised `<GraphRow>` skip re-renders during
  // history scrolling. When the key changes (a newly-known trunk
  // pulled itself to a leftmost col), we rebuild every mapped row
  // because the permutation actually shifted columns under us.
  const layoutCache = useRef<{
    arr: CommitSummary[] | null;
    state: LayoutState;
    rawRowsByOid: Map<string, RowLayout>;
    maxRawWidth: number;
    mappedRowsByOid: Map<string, RowLayout>;
    mappingKey: string;
  }>({
    arr: null,
    state: createLayoutState(),
    rawRowsByOid: new Map(),
    maxRawWidth: 0,
    mappedRowsByOid: new Map(),
    mappingKey: "__init__",
  });

  // v0.13.29 B-4 — derive the trunk hint from the current refs once
  // per refs change, then thread it through the lane allocator on
  // every subsequent extend. New entries (e.g. main becomes visible
  // after a paginated load) accumulate into the layout state without
  // disturbing already-emitted rows.
  const trunkOids = useMemo(() => computeTrunkOids(refs), [refs]);

  const { rowsByOid, totalGraphCols } = useMemo(() => {
    const cache = layoutCache.current;
    const isExtension =
      cache.arr === commits || // identity hit (no append happened, hot reload of memo)
      (cache.arr !== null &&
        commits.length >= cache.arr.length &&
        cache.arr.every((c, i) => commits[i]?.oid === c.oid));
    // Track which raw rows are *new* this turn so we can avoid
    // re-mapping the unchanged ones when the mapping key is stable.
    let newRawOids: string[] | null = null;
    if (!isExtension) {
      cache.state = createLayoutState();
      cache.rawRowsByOid = new Map();
      cache.maxRawWidth = 0;
      cache.mappedRowsByOid = new Map();
      cache.mappingKey = "__init__";
      const rows = extendLayout(cache.state, commits, { trunkOids });
      for (const r of rows) {
        cache.rawRowsByOid.set(r.oid, r);
        if (r.width > cache.maxRawWidth) cache.maxRawWidth = r.width;
      }
      cache.arr = commits;
      newRawOids = rows.map((r) => r.oid); // every row is new on a full rebuild
    } else if (commits.length > (cache.arr?.length ?? 0)) {
      const start = cache.arr?.length ?? 0;
      const newRows = extendLayout(cache.state, commits.slice(start), { trunkOids });
      for (const r of newRows) {
        cache.rawRowsByOid.set(r.oid, r);
        if (r.width > cache.maxRawWidth) cache.maxRawWidth = r.width;
      }
      cache.arr = commits;
      newRawOids = newRows.map((r) => r.oid);
    }
    // v0.13.33 — mapping cache key based on the *actual mapping
    // output*, not on `trunkLogicalCols` directly. This catches the
    // case where `trunkLogicalCols` mutates in cosmetically-different
    // but semantically-equivalent ways: a freshly-known phantom
    // trunk (`[0]` → `[0, -1]`) changes the array shape but produces
    // the same `mapping` because `buildColMapping` skips `-1`. Keying
    // on the mapping itself avoids spurious full rebuilds during
    // refs reload.
    const haveLanes = cache.maxRawWidth > 0;
    const mapping = haveLanes ? buildColMapping(cache.state, cache.maxRawWidth) : undefined;
    const mappingKey = mapping ? mapping.join(",") : "";
    const trunkAllocationsChanged = mappingKey !== cache.mappingKey;
    if (trunkAllocationsChanged && mapping) {
      // Trunk permutation actually shifted — every existing mapped
      // row may now sit on a different display column, so re-derive
      // all of them. This surfaces a newly-discovered trunk on its
      // anchored display column across already-rendered rows.
      cache.mappedRowsByOid = new Map();
      for (const [oid, raw] of cache.rawRowsByOid) {
        cache.mappedRowsByOid.set(oid, applyColMapping(raw, mapping));
      }
      cache.mappingKey = mappingKey;
    } else if (newRawOids && newRawOids.length > 0 && mapping) {
      // Mapping unchanged — only translate the new rows. Existing
      // mapped row references stay the same so memoised GraphRows
      // can bail out of re-rendering during pure-append pagination
      // (the common case).
      for (const oid of newRawOids) {
        const raw = cache.rawRowsByOid.get(oid);
        if (raw) cache.mappedRowsByOid.set(oid, applyColMapping(raw, mapping));
      }
    }
    let maxCols = 2;
    for (const r of cache.mappedRowsByOid.values()) {
      if (r.width > maxCols) maxCols = r.width;
    }
    return { rowsByOid: cache.mappedRowsByOid, totalGraphCols: maxCols };
  }, [commits, trunkOids]);

  const graphCols = totalGraphCols;

  // v0.13.6 — derive concrete pixel sizes from graphMode + max lane count.
  // The "natural" width (lanes × cell) is what the SVG truly needs; the
  // "track" width is what we let the grid cell occupy (capped so the
  // commit summary always has room). When natural > track, the SVG just
  // scrolls horizontally inside the cell.
  const compact = graphMode === "compact";
  const hidden = graphMode === "hidden";
  const laneW = compact ? GRAPH_LANE_WIDTH.compact : GRAPH_LANE_WIDTH.normal;
  const naturalGraphW = graphCols * laneW;
  const cap = compact ? GRAPH_COL_CAP.compact : GRAPH_COL_CAP.normal;
  const trackGraphW = hidden ? 0 : Math.min(naturalGraphW, cap);
  const graphOverflows = !hidden && naturalGraphW > trackGraphW;
  const gridCols = hidden ? `1fr 180px 110px 80px` : `${trackGraphW}px 1fr 180px 110px 80px`;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // When selectedOid changes (e.g. user clicked a ref in RefsPane), scroll
  // the matching row into view.
  useEffect(() => {
    if (!selectedOid) return;
    const idx = filtered.findIndex((c) => c.oid === selectedOid);
    if (idx < 0) return;
    virtualizer.scrollToIndex(idx, { align: "center" });
  }, [selectedOid, filtered, virtualizer]);

  // Infinite scroll: when the last virtualized row is within ~20 rows of the
  // tail of the *unfiltered* list, ask the store for the next backend page.
  // Important: we trigger off the unfiltered length because filtering is a
  // local concern, while paging is about the global walk.
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!hasMore || loadingMore || loading) return;
    if (filter || authorFilter || sinceFilter !== null || untilFilter !== null) {
      // While the user has an active filter, the visible row index doesn't
      // map cleanly to walk progress. Be conservative and trigger only when
      // the filtered list itself is near its end.
      const last = virtualItems[virtualItems.length - 1];
      if (last && last.index >= filtered.length - 5) void loadMoreHistory();
      return;
    }
    const last = virtualItems[virtualItems.length - 1];
    if (last && last.index >= commits.length - 20) void loadMoreHistory();
  }, [
    virtualItems,
    hasMore,
    loadingMore,
    loading,
    filter,
    authorFilter,
    sinceFilter,
    untilFilter,
    filtered.length,
    commits.length,
    loadMoreHistory,
  ]);

  const onContextMenu = (e: React.MouseEvent, c: CommitSummary) => {
    e.preventDefault();
    // v0.13.26 — only collapse the multi-selection if the right-click
    // landed on a commit *outside* the current set. Right-clicking a
    // member preserves the set so "Cherry-pick N onto HEAD" can act on
    // the whole batch.
    const inMulti = selectedOids.has(c.oid);
    if (!inMulti) selectCommit(c.oid);
    const multiSize = inMulti ? selectedOids.size : 1;
    const items: MenuItem[] = [
      { label: `${c.short_oid} — ${c.summary.slice(0, 60)}`, heading: true },
      {
        label: "New branch from here…",
        onClick: () => {
          const name = window.prompt(`New branch from ${c.short_oid}:`, "")?.trim();
          if (!name) return;
          void (async () => {
            const ck = await confirm({
              level: "warning",
              title: `Checkout '${name}' after creating?`,
              message: `OK = create + checkout. Cancel = just create the ref, stay on the current branch.`,
              confirmLabel: "Create + checkout",
              cancelLabel: "Create only",
            });
            void createBranch(name, c.oid, ck);
          })();
        },
      },
      {
        label: "Create tag here…",
        onClick: () => {
          const name = window.prompt(`Tag name at ${c.short_oid}:`, "")?.trim();
          if (!name) return;
          const msg = window.prompt(`Tag message (blank = lightweight tag):`, "") ?? "";
          void createTag(name, c.oid, msg.trim() || undefined);
        },
      },
      {
        label: "Checkout (detached HEAD)",
        onClick: () => void checkoutCommit(c.oid),
      },
      { separator: true, label: "" },
      // v0.13.26 — when right-clicking inside an N-element multi-select,
      // cherry-pick acts on the whole set (oldest-first inside the
      // store). When the click is outside the set, we fall back to the
      // single-shot cherry-pick on this one row, matching the previous
      // behaviour.
      multiSize >= 2
        ? {
            label: `Cherry-pick ${multiSize} commits onto HEAD`,
            onClick: () => void cherryPickMany([...selectedOids]),
          }
        : {
            label: "Cherry-pick onto HEAD",
            onClick: () => void cherryPick(c.oid),
          },
      {
        label: "Revert this commit",
        onClick: () => void revertCommit(c.oid),
      },
      { separator: true, label: "" },
      { label: "Reset HEAD to here", heading: true },
      {
        label: "Soft (keep index + working tree)",
        onClick: () => void resetTo(c.oid, "soft"),
      },
      {
        label: "Mixed (keep working tree)",
        onClick: () => void resetTo(c.oid, "mixed"),
      },
      {
        label: "Hard (discard everything)",
        danger: true,
        onClick: () => void resetTo(c.oid, "hard"),
      },
      { separator: true, label: "" },
      {
        label: c.parents[0]
          ? `Rebase interactively from here (${c.short_oid}^)`
          : "Rebase interactively from here (root commit — n/a)",
        disabled: !c.parents[0],
        onClick: () => {
          if (c.parents[0]) void openRebasePlan(c.parents[0]);
        },
      },
      { separator: true, label: "" },
      { label: "Highlight reachability", heading: true },
      {
        label: "Ancestors (this commit + parents)",
        onClick: () => void highlightAncestors(c.oid),
      },
      {
        label: "Descendants (this commit + children)",
        onClick: () => void highlightDescendants(c.oid),
      },
      ...(highlightOid
        ? [
            {
              label: "Clear highlight",
              onClick: () => clearHighlight(),
            },
          ]
        : []),
      { separator: true, label: "" },
      {
        label: `Copy SHA (${c.short_oid})`,
        onClick: () => void copyText(c.oid),
      },
      {
        label: "Copy commit message",
        onClick: () => void copyText(c.summary),
      },
    ];
    setMenu({ pos: { x: e.clientX, y: e.clientY }, items });
  };

  return (
    <section className="flex h-full min-w-0 min-h-0 flex-col">
      <HistoryFilterBar />
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <span className="text-muted-foreground">{filtered.length} commits</span>
        {filtered.length !== commits.length && (
          <span className="text-muted-foreground">· filtered from {commits.length}</span>
        )}
        {hasMore && !loading && <span className="text-muted-foreground">· +more</span>}
        {/* v0.13.26 — multi-select indicator with a one-click batch
            cherry-pick. We surface the action both here and in the
            right-click menu so casual ctrl-click users have a discoverable
            entry point that doesn't require finding the contextual menu. */}
        {selectedOids.size > 1 && (
          <span className="flex items-center gap-1.5 rounded bg-[hsl(var(--branch-1)/.18)] px-2 py-0.5 text-[10.5px] text-[hsl(var(--branch-1))]">
            <span>{selectedOids.size} selected</span>
            <button
              onClick={() => void cherryPickMany([...selectedOids])}
              title="Cherry-pick the selected commits onto HEAD (oldest first)"
              className="rounded border border-[hsl(var(--branch-1)/.5)] bg-background/40 px-1.5 text-[10px] hover:bg-accent"
            >
              Cherry-pick…
            </button>
            <button
              onClick={clearCommitMultiSelect}
              title="Clear multi-selection (Esc)"
              className="rounded border border-border bg-background/40 px-1.5 text-[10px] text-foreground hover:bg-accent"
            >
              clear
            </button>
          </span>
        )}
        {pathspec && (
          <span className="rounded bg-secondary px-1.5 font-mono text-[10.5px] text-foreground">
            path: {pathspec}
          </span>
        )}
        {authorFilter && (
          <span className="rounded bg-secondary px-1.5 text-[10.5px] text-foreground">
            author: {authorFilter}
          </span>
        )}
        {loading && <span className="text-muted-foreground">· loading...</span>}
        {loadingMore && !loading && (
          <span className="text-muted-foreground">· loading more...</span>
        )}
        {error && <span className="text-destructive">· {error}</span>}
        {highlightOid && (
          <span className="ml-auto flex items-center gap-1.5 rounded bg-[hsl(var(--branch-3)/.15)] px-2 py-0.5 text-[10.5px] text-[hsl(var(--branch-3))]">
            <span>
              {highlightLoading
                ? "computing..."
                : `Highlighting ${highlightMode} of ${highlightOid.slice(0, 7)}`}
            </span>
            {!highlightLoading && (
              <span className="text-muted-foreground">· {highlightSet.size} commits</span>
            )}
            <button
              onClick={clearHighlight}
              className="ml-1 rounded border border-border bg-background/40 px-1.5 text-[10px] text-foreground hover:bg-accent"
              title="Clear highlight (Esc)"
            >
              clear
            </button>
          </span>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {loading && commits.length === 0 ? (
          // v0.13.32 — first-load skeleton. We render this only when
          // the commits array is *actually empty* (not just filtered
          // empty), so a slow filter on a populated history doesn't
          // wipe the existing rows out from under the user.
          <GraphSkeleton
            gridCols={gridCols}
            trackGraphW={trackGraphW}
            compact={compact}
            hidden={hidden}
          />
        ) : !loading && filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {commits.length === 0 ? "No commits in this repository." : "No matches."}
          </div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((vRow) => {
              const c = filtered[vRow.index];
              if (!c) return null;
              const row = rowsByOid.get(c.oid);
              const isFocus = c.oid === selectedOid;
              // v0.13.26 — a row is "selected" if the user has it in
              // the multi-selection set (the focus row is always also a
              // member, so this single check covers both cases). Extra
              // members get the same accent so the batch reads as one
              // continuous block.
              const inMulti = selectedOids.has(c.oid);
              const selected = inMulti || isFocus;
              // v0.13.16 — when a highlight set is active, dim every row
              // outside it. The selected row is never dimmed (so the
              // commit details panel still has obvious context).
              const dimmed =
                !!highlightOid && !highlightSet.has(c.oid) && !selected && !highlightLoading;
              const isHighlightRoot = c.oid === highlightOid;
              return (
                <div
                  key={c.oid}
                  onClick={(e) => {
                    // v0.13.26 — modifier-aware multi-select. Plain
                    // click collapses to single; ctrl/cmd toggles; shift
                    // extends the range from the anchor.
                    const mode: "single" | "ctrl" | "shift" = e.shiftKey
                      ? "shift"
                      : e.ctrlKey || e.metaKey
                        ? "ctrl"
                        : "single";
                    void selectCommitMulti(c.oid, mode);
                  }}
                  onContextMenu={(e) => onContextMenu(e, c)}
                  className={cn(
                    "absolute left-0 top-0 grid w-full cursor-pointer items-center gap-3 border-b border-border/40 px-3 text-[12.5px]",
                    "hover:bg-accent/40",
                    selected && "bg-accent",
                    // Slight inner ring so the user can see the
                    // currently focused row inside a wide multi-selection.
                    isFocus &&
                      selectedOids.size > 1 &&
                      "ring-1 ring-inset ring-[hsl(var(--branch-1)/.6)]",
                    dimmed && "opacity-25",
                    isHighlightRoot &&
                      "ring-1 ring-inset ring-[hsl(var(--branch-3)/.6)] bg-[hsl(var(--branch-3)/.07)]",
                  )}
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${vRow.start}px)`,
                    gridTemplateColumns: gridCols,
                  }}
                  title={
                    selectedOids.size > 1
                      ? `${selectedOids.size} commits selected · right-click for batch actions`
                      : "Click to focus, Ctrl/Shift+Click for multi-select, right-click for actions"
                  }
                >
                  {!hidden && (
                    <div
                      className={cn(
                        "flex h-7 items-center",
                        // When the SVG is wider than the track, allow it
                        // to scroll horizontally inside its own cell so
                        // the commit summary column never gets squeezed.
                        graphOverflows && "overflow-x-auto",
                      )}
                      // Hide the inline scrollbar so the row stays clean
                      // visually; users still scroll via wheel + shift /
                      // touchpad. The graph dot's color is enough cue
                      // that the lane is alive even when off-screen.
                      style={
                        graphOverflows
                          ? { scrollbarWidth: "none", msOverflowStyle: "none" }
                          : undefined
                      }
                      title={
                        graphOverflows
                          ? `${graphCols} lanes — scroll horizontally or switch graph to compact / hidden`
                          : undefined
                      }
                    >
                      {row && <GraphRow row={row} cols={graphCols} compact={compact} />}
                    </div>
                  )}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <RefBadges refs={c.refs} />
                    <span className="truncate">{c.summary}</span>
                  </div>
                  <div className="truncate text-muted-foreground">{c.author_name}</div>
                  <div className="text-muted-foreground">{timeAgo(c.time)}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{c.short_oid}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ContextMenu
        pos={menu?.pos ?? null}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
      />
    </section>
  );
}

function RefBadges({ refs }: { refs: string[] }) {
  if (!refs || refs.length === 0) return null;
  return (
    <span className="flex shrink-0 gap-1">
      {refs.slice(0, 4).map((r) => {
        const isTag = !r.includes("/") && /^v?\d/.test(r);
        const isRemote = r.startsWith("origin/") || r.startsWith("upstream/");
        const isHead = r === "HEAD";
        const cls = isHead
          ? "border-[hsl(var(--branch-4)/.4)] bg-[hsl(var(--branch-4)/.1)] text-[hsl(var(--branch-4))]"
          : isTag
            ? "border-[hsl(var(--branch-3)/.4)] bg-[hsl(var(--branch-3)/.1)] text-[hsl(var(--branch-3))]"
            : isRemote
              ? "border-[hsl(var(--branch-2)/.4)] bg-[hsl(var(--branch-2)/.1)] text-[hsl(var(--branch-2))]"
              : "border-[hsl(var(--branch-1)/.4)] bg-[hsl(var(--branch-1)/.1)] text-[hsl(var(--branch-1))]";
        return (
          <span
            key={r}
            className={cn(
              "inline-flex h-[18px] items-center rounded-full border px-2 text-[10.5px]",
              cls,
            )}
          >
            {r}
          </span>
        );
      })}
    </span>
  );
}
