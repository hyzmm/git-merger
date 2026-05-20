import { useEffect } from "react";
import { History as HistoryIcon, RotateCcw } from "lucide-react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import type { ReflogEntry } from "@/ipc/git";

function fmtTime(t: number): string {
  if (!t) return "";
  return new Date(t * 1000).toLocaleString();
}

/** Visual category derived from the reflog message prefix. */
function categorize(message: string): { label: string; cls: string } {
  const m = message.match(/^([a-zA-Z][a-zA-Z\- ]*?):\s*/);
  const action = (m?.[1] ?? "").toLowerCase();
  if (action.includes("commit")) return { label: action, cls: "text-[hsl(var(--branch-1))]" };
  if (action.includes("reset")) return { label: action, cls: "text-[hsl(var(--branch-3))]" };
  if (action.includes("checkout")) return { label: action, cls: "text-[hsl(var(--branch-2))]" };
  if (action.includes("merge")) return { label: action, cls: "text-[hsl(var(--branch-4))]" };
  if (action.includes("rebase")) return { label: action, cls: "text-[hsl(var(--branch-5))]" };
  if (action.includes("pull")) return { label: action, cls: "text-[hsl(var(--branch-2))]" };
  if (action.includes("cherry")) return { label: action, cls: "text-[hsl(var(--branch-1))]" };
  if (action.includes("revert")) return { label: action, cls: "text-[hsl(var(--branch-3))]" };
  if (action) return { label: action, cls: "text-muted-foreground" };
  return { label: "ref", cls: "text-muted-foreground" };
}

export function ReflogPage() {
  const repo = useApp((s) => s.repo);
  const entries = useApp((s) => s.reflog.entries);
  const loading = useApp((s) => s.reflog.loading);
  const error = useApp((s) => s.reflog.error);

  const loadReflog = useApp((s) => s.loadReflog);
  const resetTo = useApp((s) => s.resetTo);

  useEffect(() => {
    if (repo) void loadReflog();
  }, [repo, loadReflog]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <HistoryIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">HEAD reflog · {entries.length} entries</span>
        {loading && <span className="text-muted-foreground">· loading...</span>}
        <span className="ml-auto text-[10.5px] text-muted-foreground">
          Reflog only stores HEAD history locally — never pushed.
        </span>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!loading && entries.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">No reflog entries.</div>
        )}
        {entries.map((e) => (
          <ReflogRow key={e.index} entry={e} onReset={(oid, mode) => void resetTo(oid, mode)} />
        ))}
      </div>
    </div>
  );
}

function ReflogRow({
  entry,
  onReset,
}: {
  entry: ReflogEntry;
  onReset: (oid: string, mode: "soft" | "mixed" | "hard") => void;
}) {
  const cat = categorize(entry.message);
  const msgWithoutPrefix = cat.label
    ? entry.message.replace(new RegExp(`^${cat.label}[:\\s]+`, "i"), "")
    : entry.message;

  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-3 py-2 text-xs hover:bg-accent/30">
      <span className="w-16 shrink-0 font-mono text-[10.5px] text-muted-foreground">
        HEAD@{`{${entry.index}}`}
      </span>
      <span
        className={cn("w-20 shrink-0 truncate text-[10.5px] uppercase tracking-wider", cat.cls)}
        title={cat.label}
      >
        {cat.label}
      </span>
      <span className="font-mono text-[11px] text-[hsl(var(--branch-1))]">
        {entry.short_old_oid}
      </span>
      <span className="text-muted-foreground">→</span>
      <span className="font-mono text-[11px] text-[hsl(var(--branch-2))]">
        {entry.short_new_oid}
      </span>
      <span className="flex-1 truncate" title={entry.message}>
        {msgWithoutPrefix || entry.message}
      </span>
      <span className="shrink-0 text-[10.5px] text-muted-foreground">{fmtTime(entry.time)}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => onReset(entry.new_oid, "mixed")}
          title={`Reset HEAD to this state (mixed). Useful to UNDO whatever happened AFTER this entry.`}
          className="flex h-6 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[10.5px] hover:bg-accent"
        >
          <RotateCcw className="h-3 w-3" />
          Restore
        </button>
        <button
          onClick={() => onReset(entry.new_oid, "hard")}
          title="Reset HARD — discard everything after this entry. DESTRUCTIVE."
          className="h-6 rounded-md border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.10)] px-2 text-[10.5px] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.18)]"
        >
          Hard
        </button>
      </div>
    </div>
  );
}
