import { useMemo } from "react";
import { useApp } from "@/stores/app";
import { layoutGraph } from "@/lib/graph";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { GraphRow } from "./GraphRow";

export function CommitList() {
  const commits = useApp((s) => s.history.commits);
  const filter = useApp((s) => s.history.filter);
  const selectedOid = useApp((s) => s.history.selectedOid);
  const loading = useApp((s) => s.history.loading);
  const error = useApp((s) => s.history.error);
  const selectCommit = useApp((s) => s.selectCommit);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return commits;
    return commits.filter(
      (c) =>
        c.summary.toLowerCase().includes(q) ||
        c.author_name.toLowerCase().includes(q) ||
        c.author_email.toLowerCase().includes(q) ||
        c.oid.startsWith(q) ||
        c.refs.some((r) => r.toLowerCase().includes(q)),
    );
  }, [commits, filter]);

  const layout = useMemo(
    () => layoutGraph(filtered.map((c) => ({ oid: c.oid, parents: c.parents }))),
    [filtered],
  );

  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <span className="text-muted-foreground">{filtered.length} commits</span>
        {filter && <span className="text-muted-foreground">· filtered from {commits.length}</span>}
        {loading && <span className="text-muted-foreground">· loading...</span>}
        {error && <span className="text-destructive">· {error}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.map((c, i) => {
          const row = layout[i];
          const selected = c.oid === selectedOid;
          return (
            <div
              key={c.oid}
              onClick={() => selectCommit(c.oid)}
              className={cn(
                "grid h-7 cursor-pointer items-center gap-3 border-b border-border/40 px-3 text-[12.5px]",
                "hover:bg-accent/40",
                selected && "bg-accent",
              )}
              style={{
                gridTemplateColumns: `${Math.max(2, row?.width ?? 2) * 14}px 1fr 180px 110px 80px`,
              }}
            >
              <div className="flex h-7 items-center">{row && <GraphRow row={row} />}</div>
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
        {!loading && filtered.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {commits.length === 0 ? "No commits in this repository." : "No matches."}
          </div>
        )}
      </div>
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
