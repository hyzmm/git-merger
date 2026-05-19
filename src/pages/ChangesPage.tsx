import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import type { WorkingFile } from "@/ipc/git";

const STATUS_LABEL: Record<WorkingFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  typechange: "T",
  untracked: "?",
  conflict: "!",
};

const STATUS_COLOR: Record<WorkingFile["status"], string> = {
  added: "text-[hsl(var(--diff-added-fg))]",
  modified: "text-[hsl(var(--diff-modified-fg))]",
  deleted: "text-[hsl(var(--diff-removed-fg))]",
  renamed: "text-[hsl(var(--branch-2))]",
  typechange: "text-[hsl(var(--branch-3))]",
  untracked: "text-muted-foreground",
  conflict: "text-[hsl(var(--destructive))]",
};

export function ChangesPage() {
  const files = useApp((s) => s.changes.files);
  const selected = useApp((s) => s.changes.selected);
  const message = useApp((s) => s.changes.message);
  const loading = useApp((s) => s.changes.loading);
  const committing = useApp((s) => s.changes.committing);
  const error = useApp((s) => s.changes.error);

  const toggle = useApp((s) => s.toggleChange);
  const selectAll = useApp((s) => s.selectAllChanges);
  const clearSel = useApp((s) => s.clearChangeSelection);
  const stageSel = useApp((s) => s.stageSelected);
  const unstageSel = useApp((s) => s.unstageSelected);
  const discardSel = useApp((s) => s.discardSelected);
  const setMessage = useApp((s) => s.setCommitMessage);
  const commit = useApp((s) => s.commitWorking);

  const staged = files.filter((f) => f.flag === "staged" || f.flag === "both");
  const unstaged = files.filter(
    (f) => f.flag === "unstaged" || f.flag === "untracked" || f.flag === "both",
  );
  const conflicts = files.filter((f) => f.flag === "conflict");
  const stagedCount = staged.length;
  const hasSelection = selected.size > 0;

  return (
    <div className="grid h-full grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
          <span className="text-muted-foreground">{files.length} changes</span>
          {stagedCount > 0 && <span className="text-muted-foreground">· {stagedCount} staged</span>}
          {conflicts.length > 0 && (
            <span className="text-[hsl(var(--destructive))]">· {conflicts.length} unmerged</span>
          )}
          {loading && <span className="text-muted-foreground">· loading...</span>}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={selectAll}
              className="h-7 rounded-md border border-border bg-secondary px-3 text-xs hover:bg-accent"
            >
              Select all
            </button>
            <button
              onClick={clearSel}
              disabled={!hasSelection}
              className={cn(
                "h-7 rounded-md border border-border bg-secondary px-3 text-xs hover:bg-accent",
                !hasSelection && "cursor-not-allowed opacity-60",
              )}
            >
              Clear
            </button>
            <button
              onClick={stageSel}
              disabled={!hasSelection}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium",
                hasSelection
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "cursor-not-allowed bg-secondary text-muted-foreground opacity-60",
              )}
            >
              Stage
            </button>
            <button
              onClick={unstageSel}
              disabled={!hasSelection}
              className={cn(
                "h-7 rounded-md border border-border bg-secondary px-3 text-xs hover:bg-accent",
                !hasSelection && "cursor-not-allowed opacity-60",
              )}
            >
              Unstage
            </button>
            <button
              onClick={discardSel}
              disabled={!hasSelection}
              className={cn(
                "h-7 rounded-md border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.10)] px-3 text-xs text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.18)]",
                !hasSelection && "cursor-not-allowed opacity-60",
              )}
            >
              Discard
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {conflicts.length > 0 && (
            <Section title="Unmerged" files={conflicts} selected={selected} toggle={toggle} />
          )}
          {staged.length > 0 && (
            <Section title="Staged changes" files={staged} selected={selected} toggle={toggle} />
          )}
          {unstaged.length > 0 && (
            <Section
              title="Unstaged changes"
              files={unstaged}
              selected={selected}
              toggle={toggle}
            />
          )}
          {!loading && files.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Working tree is clean.
            </div>
          )}
        </div>
      </div>

      {/* Right: commit panel */}
      <aside className="flex h-full min-w-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-3">
          <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Commit staged changes
          </h2>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message&#10;&#10;Optional longer body…"
            className="block h-32 w-full resize-none rounded-md border border-input bg-background p-2 font-mono text-xs outline-none focus:border-ring"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={commit}
              disabled={committing || stagedCount === 0 || !message.trim()}
              className={cn(
                "h-8 flex-1 rounded-md text-xs font-medium",
                stagedCount > 0 && message.trim() && !committing
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "cursor-not-allowed bg-secondary text-muted-foreground opacity-60",
              )}
            >
              {committing
                ? "Committing..."
                : `Commit ${stagedCount} file${stagedCount === 1 ? "" : "s"}`}
            </button>
          </div>
          {error && <div className="mt-2 text-[11px] text-destructive">{error}</div>}
        </div>
      </aside>
    </div>
  );
}

function Section({
  title,
  files,
  selected,
  toggle,
}: {
  title: string;
  files: WorkingFile[];
  selected: Set<string>;
  toggle: (path: string) => void;
}) {
  return (
    <div>
      <div className="border-b border-border bg-card px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} ({files.length})
      </div>
      {files.map((f) => {
        const isSelected = selected.has(f.path);
        return (
          <label
            key={f.path}
            className={cn(
              "flex cursor-pointer items-center gap-2 border-b border-border/30 px-3 py-1 text-xs",
              "hover:bg-accent/40",
              isSelected && "bg-accent/60",
            )}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggle(f.path)}
              className="accent-[hsl(var(--branch-1))]"
            />
            <span
              className={cn(
                "w-3.5 text-center font-mono text-[11px] font-bold",
                STATUS_COLOR[f.status],
              )}
            >
              {STATUS_LABEL[f.status]}
            </span>
            <span className="flex-1 truncate font-mono">{f.path}</span>
            <span className="text-[10.5px] text-muted-foreground">{f.flag}</span>
          </label>
        );
      })}
    </div>
  );
}
