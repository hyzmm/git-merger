import { useMemo, useRef, useState } from "react";
import { ArrowLeft, GitBranch } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useApp } from "@/stores/app";
import { useHighlight } from "@/lib/useHighlight";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";
import type { BlameLine } from "@/ipc/git";

const ROW_HEIGHT = 20;

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
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

export function BlamePage() {
  const file = useApp((s) => s.blame.file);
  const revision = useApp((s) => s.blame.revision);
  const lines = useApp((s) => s.blame.lines);
  const loading = useApp((s) => s.blame.loading);
  const error = useApp((s) => s.blame.error);
  const prev = useApp((s) => s.blame.prev);
  const stack = useApp((s) => s.blame.history);
  const setView = useApp((s) => s.setView);
  const selectCommit = useApp((s) => s.selectCommit);
  const followRename = useApp((s) => s.blameFollowRename);
  const blameBack = useApp((s) => s.blameBack);
  const blameBeforeCommit = useApp((s) => s.blameBeforeCommit);
  const openFileHistory = useApp((s) => s.openFileHistory);

  // Group consecutive lines from the same commit so we only render blame
  // metadata once per group (IDEA-style).
  const groups = useMemo(() => groupByCommit(lines), [lines]);

  const sourceLines = useMemo(() => lines.map((l) => l.content), [lines]);
  const tokens = useHighlight(sourceLines, file ?? "");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  });

  const [menu, setMenu] = useState<{ pos: ContextMenuPos; items: MenuItem[] } | null>(null);

  // Right-click on any blame row pops a per-line context menu (v0.13.17).
  // We keep the items intentionally focused on commit-level navigation —
  // diff / blame / clipboard — to mirror IntelliJ's annotate gutter menu.
  function onContextMenu(e: React.MouseEvent, ln: BlameLine) {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: `${ln.short_oid} — ${ln.summary.slice(0, 60)}`, heading: true },
      {
        label: "Show this commit in History",
        onClick: () => {
          void selectCommit(ln.oid);
          setView("history");
        },
      },
      {
        label: "Annotate revision before this change",
        onClick: () => void blameBeforeCommit(ln.oid),
      },
      { separator: true, label: "" },
      {
        label: `Copy SHA (${ln.short_oid})`,
        onClick: () => void copyText(ln.oid),
      },
      {
        label: "Copy commit summary",
        onClick: () => void copyText(ln.summary),
      },
      {
        label: "Copy line content",
        onClick: () => void copyText(ln.content),
      },
    ];
    setMenu({ pos: { x: e.clientX, y: e.clientY }, items });
  }

  if (!file) {
    return (
      <section className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Open a file from the Diff view, then click{" "}
        <span className="ml-1 mr-1 font-mono">Blame</span> to inspect line-by-line history.
      </section>
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        {stack.length > 0 && (
          <button
            onClick={() => void blameBack()}
            title="Go back to the previous blame view"
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 hover:bg-accent"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
        )}
        <span className="truncate font-mono">{file}</span>
        {revision && (
          <span
            className="font-mono text-[10.5px] text-[hsl(var(--branch-3))]"
            title={`Annotating revision ${revision}`}
          >
            @ {revision.slice(0, 7)}
          </span>
        )}
        <span className="text-[10.5px] text-muted-foreground">
          {lines.length} lines · {groups.length} commits
        </span>
        {loading && <span className="text-[10.5px] text-muted-foreground">loading...</span>}
        {error && <span className="ml-2 text-[10.5px] text-destructive">{error}</span>}
        <div className="ml-auto flex items-center gap-2">
          {prev && (
            <button
              onClick={() => void followRename()}
              title={`Annotate previous revision (${prev.revision.slice(0, 7)} — ${prev.file})`}
              className="flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 hover:bg-accent"
            >
              <GitBranch className="h-3 w-3" />
              Annotate previous {prev.file !== file ? `(${prev.file.split("/").pop()})` : ""}
            </button>
          )}
          <button
            onClick={() => file && void openFileHistory(file)}
            disabled={!file}
            title="Show this file's history (follows renames)"
            className="h-7 rounded-md border border-border bg-secondary px-3 text-xs hover:bg-accent disabled:opacity-50"
          >
            File history
          </button>
          <button
            onClick={() => setView("diff")}
            className="h-7 rounded-md border border-border bg-secondary px-3 text-xs hover:bg-accent"
          >
            Back to Diff
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-background">
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vRow) => {
            const i = vRow.index;
            const ln = lines[i];
            if (!ln) return null;
            const groupHead = i === 0 || lines[i - 1].oid !== ln.oid;
            const tokRow = tokens?.[i];
            return (
              <div
                key={i}
                onContextMenu={(e) => onContextMenu(e, ln)}
                className={cn(
                  "absolute left-0 top-0 grid w-full font-mono text-[12px] leading-[20px] hover:bg-accent/20",
                  groupHead && "border-t border-border/40",
                )}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${vRow.start}px)`,
                  gridTemplateColumns: "120px 110px 70px 50px 1fr",
                  columnGap: 8,
                }}
                title="Right-click for actions"
              >
                {/* Author */}
                <div
                  className={cn(
                    "truncate px-2 text-[11px] text-muted-foreground",
                    !groupHead && "opacity-0",
                  )}
                  title={`${ln.author_name} <${ln.author_email}>`}
                >
                  {ln.author_name}
                </div>

                {/* Time */}
                <div
                  className={cn(
                    "truncate text-[11px] text-muted-foreground",
                    !groupHead && "opacity-0",
                  )}
                >
                  {timeAgo(ln.time)}
                </div>

                {/* Short oid (clickable) */}
                <button
                  onClick={() => {
                    void selectCommit(ln.oid);
                    setView("history");
                  }}
                  className={cn(
                    "truncate text-left text-[11px] text-[hsl(var(--branch-1))] hover:underline",
                    !groupHead && "opacity-0",
                  )}
                  title={`${ln.oid}\n${ln.summary}\n\nClick: open in History · Right-click: more`}
                >
                  {ln.short_oid}
                </button>

                {/* Line number */}
                <div className="select-none bg-[hsl(var(--diff-gutter,220_13%_13%))] pr-2 text-right text-[11px] text-muted-foreground">
                  {ln.line}
                </div>

                {/* Content */}
                <div className="overflow-x-auto whitespace-pre pr-3">
                  {tokRow ? (
                    tokRow.map((t, ti) => (
                      <span
                        key={ti}
                        style={{
                          color: t.color,
                          fontStyle: t.italic ? "italic" : undefined,
                          fontWeight: t.bold ? 600 : undefined,
                        }}
                      >
                        {t.text}
                      </span>
                    ))
                  ) : (
                    <span>{ln.content}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ContextMenu
        pos={menu?.pos ?? null}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
      />
    </section>
  );
}

interface BlameGroup {
  oid: string;
  start: number;
  end: number;
  /** kept for the head row */
  head: BlameLine;
}

function groupByCommit(lines: BlameLine[]): BlameGroup[] {
  const out: BlameGroup[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const last = out[out.length - 1];
    if (last && last.oid === ln.oid) {
      last.end = i;
    } else {
      out.push({ oid: ln.oid, start: i, end: i, head: ln });
    }
  }
  return out;
}
