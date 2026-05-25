import { useEffect } from "react";
import { Archive, Check, Trash2 } from "lucide-react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";

function fmtTime(t: number): string {
  if (!t) return "";
  const d = new Date(t * 1000);
  return d.toLocaleString();
}

export function StashPage() {
  const repo = useApp((s) => s.repo);
  const entries = useApp((s) => s.stash.entries);
  const loading = useApp((s) => s.stash.loading);
  const busy = useApp((s) => s.stash.busy);
  const error = useApp((s) => s.stash.error);
  const status = useApp((s) => s.stash.status);

  const loadStash = useApp((s) => s.loadStash);
  const saveStash = useApp((s) => s.saveStash);
  const applyStash = useApp((s) => s.applyStash);
  const popStash = useApp((s) => s.popStash);
  const dropStash = useApp((s) => s.dropStash);
  const confirm = useApp((s) => s.confirm);

  useEffect(() => {
    if (repo) void loadStash();
  }, [repo, loadStash]);

  const onNewStash = async () => {
    const message = window.prompt(
      "Stash message (optional):\n\nLeave blank to use 'WIP on <branch>'.",
      "",
    );
    // Cancel = null. Empty string = use default message.
    if (message === null) return;
    const includeUntracked = await confirm({
      level: "warning",
      title: "Include untracked files?",
      message:
        "OK = stash both tracked changes and brand-new files (`git stash -u`). Cancel = stash only tracked-but-modified files.",
      confirmLabel: "Include untracked",
      cancelLabel: "Skip untracked",
    });
    void saveStash({
      message: message.trim() || undefined,
      includeUntracked,
      keepIndex: false,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <Archive className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">{entries.length} stash entries</span>
        {loading && <span className="text-muted-foreground">· loading...</span>}
        {busy && <span className="text-muted-foreground">· working...</span>}
        {status && <span className="text-[hsl(var(--branch-1))]">· {status}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onNewStash}
            disabled={busy}
            className={cn(
              "h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90",
              busy && "cursor-not-allowed opacity-60",
            )}
          >
            Stash working changes…
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!loading && entries.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No stashes yet. Use <span className="font-mono">Stash working changes…</span> to save
            uncommitted edits for later.
          </div>
        )}
        {entries.map((e) => (
          <div
            key={e.index}
            className="flex items-center gap-3 border-b border-border/40 px-3 py-2 hover:bg-accent/30"
          >
            <span className="font-mono text-[11px] text-muted-foreground">
              stash@{`{${e.index}}`}
            </span>
            <span className="font-mono text-[11px] text-[hsl(var(--branch-1))]">{e.short_oid}</span>
            <span className="flex-1 truncate text-xs">{e.message}</span>
            <span className="shrink-0 text-[10.5px] text-muted-foreground">{fmtTime(e.time)}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => void applyStash(e.index)}
                disabled={busy}
                title="Apply (keep on stack)"
                className={cn(
                  "h-7 rounded-md border border-border bg-secondary px-2.5 text-[11px] hover:bg-accent",
                  busy && "cursor-not-allowed opacity-60",
                )}
              >
                Apply
              </button>
              <button
                onClick={() => void popStash(e.index)}
                disabled={busy}
                title="Apply and remove from stack"
                className={cn(
                  "flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:opacity-90",
                  busy && "cursor-not-allowed opacity-60",
                )}
              >
                <Check className="h-3 w-3" />
                Pop
              </button>
              <button
                onClick={() => void dropStash(e.index)}
                disabled={busy}
                title="Drop without applying"
                className={cn(
                  "flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.10)] px-2.5 text-[11px] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.18)]",
                  busy && "cursor-not-allowed opacity-60",
                )}
              >
                <Trash2 className="h-3 w-3" />
                Drop
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
