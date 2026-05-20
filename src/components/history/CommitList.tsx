import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useApp } from "@/stores/app";
import { layoutGraph } from "@/lib/graph";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { GraphRow } from "./GraphRow";
import { HistoryFilterBar } from "./HistoryFilterBar";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";
import type { CommitSummary } from "@/ipc/git";

const ROW_HEIGHT = 28;

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
  const error = useApp((s) => s.history.error);
  const selectCommit = useApp((s) => s.selectCommit);
  const checkoutCommit = useApp((s) => s.checkoutCommit);
  const cherryPick = useApp((s) => s.cherryPick);
  const revertCommit = useApp((s) => s.revertCommit);
  const resetTo = useApp((s) => s.resetTo);
  const createBranch = useApp((s) => s.createBranch);
  const createTag = useApp((s) => s.createTag);

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

  const layout = useMemo(
    () => layoutGraph(filtered.map((c) => ({ oid: c.oid, parents: c.parents }))),
    [filtered],
  );

  const graphCols = useMemo(() => Math.max(2, ...layout.map((r) => r.width)), [layout]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

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
    <section className="flex min-w-0 flex-col">
      <HistoryFilterBar />
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <span className="text-muted-foreground">{filtered.length} commits</span>
        {filtered.length !== commits.length && (
          <span className="text-muted-foreground">· filtered from {commits.length}</span>
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
              const row = layout[vRow.index];
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
                    gridTemplateColumns: `${graphCols * 14}px 1fr 180px 110px 80px`,
                  }}
                  title="Right-click for actions"
                >
                  <div className="flex h-7 items-center">
                    {row && <GraphRow row={row} cols={graphCols} />}
                  </div>
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
