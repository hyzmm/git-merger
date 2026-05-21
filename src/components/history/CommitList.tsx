import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useApp } from "@/stores/app";
import { useSettings } from "@/stores/settings";
import { createLayoutState, extendLayout, type LayoutState, type RowLayout } from "@/lib/graph";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { GraphRow, GRAPH_LANE_WIDTH } from "./GraphRow";
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
  const filter = useApp((s) => s.history.filter);
  const authorFilter = useApp((s) => s.history.authorFilter);
  const sinceFilter = useApp((s) => s.history.sinceFilter);
  const untilFilter = useApp((s) => s.history.untilFilter);
  const pathspec = useApp((s) => s.history.pathspec);
  const selectedOid = useApp((s) => s.history.selectedOid);
  const loading = useApp((s) => s.history.loading);
  const loadingMore = useApp((s) => s.history.loadingMore);
  const hasMore = useApp((s) => s.history.hasMore);
  const error = useApp((s) => s.history.error);
  const selectCommit = useApp((s) => s.selectCommit);
  const loadMoreHistory = useApp((s) => s.loadMoreHistory);
  const checkoutCommit = useApp((s) => s.checkoutCommit);
  const cherryPick = useApp((s) => s.cherryPick);
  const revertCommit = useApp((s) => s.revertCommit);
  const resetTo = useApp((s) => s.resetTo);
  const openRebasePlan = useApp((s) => s.openRebasePlan);
  const createBranch = useApp((s) => s.createBranch);
  const createTag = useApp((s) => s.createTag);

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
  const layoutCache = useRef<{
    arr: CommitSummary[] | null;
    state: LayoutState;
    rowsByOid: Map<string, RowLayout>;
  }>({
    arr: null,
    state: createLayoutState(),
    rowsByOid: new Map(),
  });

  const { rowsByOid, totalGraphCols } = useMemo(() => {
    const cache = layoutCache.current;
    const isExtension =
      cache.arr === commits || // identity hit (no append happened, hot reload of memo)
      (cache.arr !== null &&
        commits.length >= cache.arr.length &&
        cache.arr.every((c, i) => commits[i]?.oid === c.oid));
    if (!isExtension) {
      cache.state = createLayoutState();
      cache.rowsByOid = new Map();
      const rows = extendLayout(cache.state, commits);
      for (const r of rows) cache.rowsByOid.set(r.oid, r);
      cache.arr = commits;
    } else if (commits.length > (cache.arr?.length ?? 0)) {
      const start = cache.arr?.length ?? 0;
      const newRows = extendLayout(cache.state, commits.slice(start));
      for (const r of newRows) cache.rowsByOid.set(r.oid, r);
      cache.arr = commits;
    }
    let maxCols = 2;
    for (const r of cache.rowsByOid.values()) {
      if (r.width > maxCols) maxCols = r.width;
    }
    return { rowsByOid: cache.rowsByOid, totalGraphCols: maxCols };
  }, [commits]);

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
    selectCommit(c.oid);
    const items: MenuItem[] = [
      { label: `${c.short_oid} — ${c.summary.slice(0, 60)}`, heading: true },
      {
        label: "New branch from here…",
        onClick: () => {
          const name = window.prompt(`New branch from ${c.short_oid}:`, "")?.trim();
          if (!name) return;
          const ck = window.confirm(`Checkout new branch '${name}' immediately?`);
          void createBranch(name, c.oid, ck);
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
      {
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
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {!loading && filtered.length === 0 ? (
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
              const selected = c.oid === selectedOid;
              return (
                <div
                  key={c.oid}
                  onClick={() => selectCommit(c.oid)}
                  onContextMenu={(e) => onContextMenu(e, c)}
                  className={cn(
                    "absolute left-0 top-0 grid w-full cursor-pointer items-center gap-3 border-b border-border/40 px-3 text-[12.5px]",
                    "hover:bg-accent/40",
                    selected && "bg-accent",
                  )}
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${vRow.start}px)`,
                    gridTemplateColumns: gridCols,
                  }}
                  title="Right-click for actions"
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
