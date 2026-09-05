import { useEffect } from "react";
import { Archive, Check, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import { confirm } from "@/lib/confirm";
import { Unified } from "@/components/diff/DiffViews";
import type { FileChange } from "@/ipc/git";

// Compact timestamp ("8/25 14:30") so the time column doesn't eat row
// width in the narrow stash list pane; the year is only kept when the
// stash is from a previous year. The full locale string used to force
// horizontal scrolling.
function fmtTime(t: number): string {
  if (!t) return "";
  const d = new Date(t * 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const md = `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

// Mirror the FileTree component's status icons. Kept inline here because
// the global FileTree pulls from `s.diff.files` directly and we need to
// render against `s.stash.files` instead — pulling FileTree apart for
// reuse would balloon scope.
const STATUS_LABEL: Record<FileChange["status"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  typechange: "T",
};

const STATUS_COLOR: Record<FileChange["status"], string> = {
  added: "text-[hsl(var(--diff-added-fg))]",
  deleted: "text-[hsl(var(--diff-removed-fg))]",
  modified: "text-[hsl(var(--diff-modified-fg))]",
  renamed: "text-[hsl(var(--branch-2))]",
  copied: "text-[hsl(var(--branch-2))]",
  typechange: "text-[hsl(var(--branch-3))]",
};

export function StashPage() {
  const repo = useApp((s) => s.repo);
  const entries = useApp((s) => s.stash.entries);
  const loading = useApp((s) => s.stash.loading);
  const busy = useApp((s) => s.stash.busy);
  const error = useApp((s) => s.stash.error);
  const status = useApp((s) => s.stash.status);
  const selectedIndex = useApp((s) => s.stash.selectedIndex);
  const files = useApp((s) => s.stash.files);
  const filesLoading = useApp((s) => s.stash.filesLoading);
  const selectedFile = useApp((s) => s.stash.selectedFile);
  const fileDiff = useApp((s) => s.stash.fileDiff);
  const diffLoading = useApp((s) => s.stash.diffLoading);

  const loadStash = useApp((s) => s.loadStash);
  const saveStash = useApp((s) => s.saveStash);
  const applyStash = useApp((s) => s.applyStash);
  const popStash = useApp((s) => s.popStash);
  const dropStash = useApp((s) => s.dropStash);
  const selectStashEntry = useApp((s) => s.selectStashEntry);
  const selectStashFile = useApp((s) => s.selectStashFile);

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

  // v0.13.24 — three-pane layout:
  //   [ stash list (left, ~340px) | file list (mid, ~280px) | diff (rest) ]
  // The middle + right panes are empty when no stash is selected, with a
  // hint that prompts the user to click a row first. Clicking is a pure
  // read-only navigation; destructive actions (Apply / Pop / Drop) still
  // live on the row itself and route through ConfirmDialog.
  return (
    <div className="grid h-full grid-rows-[auto_1fr] overflow-hidden">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <Archive className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 truncate text-muted-foreground">{entries.length} stash entries</span>
        {loading && (
          <span className="shrink-0 text-muted-foreground">· loading...</span>
        )}
        {busy && <span className="shrink-0 text-muted-foreground">· working...</span>}
        {status && (
          <span className="min-w-0 truncate text-[hsl(var(--branch-1))]">· {status}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            onClick={onNewStash}
            disabled={busy}
            variant="default"
            size="sm"
          >
            Stash working changes…
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] break-words text-destructive">
          {error}
        </div>
      )}

      <div
        className="grid min-h-0 overflow-hidden"
        style={{ gridTemplateColumns: "minmax(240px, 1fr) minmax(0, 280px) minmax(0, 2fr)" }}
      >
        {/* ----- Left: stash list ----- */}
        <div className="min-h-0 overflow-auto border-r border-border">
          {!loading && entries.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No stashes yet. Use <span className="font-mono">Stash working changes…</span> to save
              uncommitted edits for later.
            </div>
          )}
          {entries.map((e) => {
            const active = e.index === selectedIndex;
            return (
              <div
                key={e.index}
                onClick={() => void selectStashEntry(e.index)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 border-b border-border/40 px-3 py-2",
                  "hover:bg-accent/30",
                  active && "bg-accent",
                )}
                title="Click to preview · use the action buttons to apply / pop / drop"
              >
                {/* Text block: min-w-0 everywhere so long messages / hashes
                    truncate instead of forcing the row wider than the pane. */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      stash@{`{${e.index}}`}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-[hsl(var(--branch-1))]">
                      {e.short_oid}
                    </span>
                    <span className="ml-auto min-w-0 shrink truncate text-right text-[10px] text-muted-foreground">
                      {fmtTime(e.time)}
                    </span>
                  </div>
                  <div className="truncate text-xs" title={e.message}>
                    {e.message}
                  </div>
                </div>
                {/* Icon-only actions: fixed width, never stretch with content.
                    Dimmed until the row is hovered or a button receives
                    keyboard focus. Clicks are contained here so picking an
                    action doesn't *also* swap the preview to this row. */}
                <div
                  className={cn(
                    "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150",
                    "group-hover:opacity-100 focus-within:opacity-100",
                    active && "opacity-100",
                  )}
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={busy}
                          aria-label="Apply (keep on stack)"
                          onClick={() => void applyStash(e.index)}
                        />
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>Apply… (keep on stack)</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={busy}
                          aria-label="Apply and remove from stack"
                          onClick={() => void popStash(e.index)}
                        />
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>Pop… (apply and remove)</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={busy}
                          aria-label="Drop without applying"
                          className="text-destructive hover:bg-destructive/15 hover:text-destructive"
                          onClick={() => void dropStash(e.index)}
                        />
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent>Drop… (without applying)</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>

        {/* ----- Middle: file list of selected stash ----- */}
        <div className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-card">
          <div className="border-b border-border px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Files {files.length > 0 && `(${files.length})`}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {selectedIndex === null ? (
              <div className="p-4 text-xs text-muted-foreground">
                Select a stash entry on the left to preview its contents.
              </div>
            ) : filesLoading ? (
              <div className="p-4 text-xs text-muted-foreground">Loading file list…</div>
            ) : files.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">
                This stash records no file changes.
              </div>
            ) : (
              files.map((f) => {
                const active = f.path === selectedFile;
                return (
                  <div
                    key={`${f.old_path ?? ""}->${f.path}`}
                    onClick={() => void selectStashFile(f.path)}
                    className={cn(
                      "grid cursor-pointer items-center gap-1.5 px-3 py-1 text-xs hover:bg-accent/50",
                      active && "bg-accent",
                    )}
                    style={{ gridTemplateColumns: "14px 1fr auto" }}
                    title={f.path}
                  >
                    <span
                      className={cn(
                        "text-center font-mono text-[11px] font-bold",
                        STATUS_COLOR[f.status],
                      )}
                    >
                      {STATUS_LABEL[f.status]}
                    </span>
                    <span className="truncate font-mono">{f.path}</span>
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {f.insertions > 0 && (
                        <span className="text-[hsl(var(--diff-added-fg))]">+{f.insertions}</span>
                      )}
                      {f.insertions > 0 && f.deletions > 0 && " "}
                      {f.deletions > 0 && (
                        <span className="text-[hsl(var(--diff-removed-fg))]">-{f.deletions}</span>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ----- Right: inline diff preview ----- */}
        <div className="flex min-h-0 flex-col overflow-hidden">
          {selectedIndex === null ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Pick a stash to see what it would apply.
            </div>
          ) : selectedFile === null ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {filesLoading ? "Loading…" : "Select a file from the list."}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
                <span className="truncate font-mono">{selectedFile}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  {entries[selectedIndex]?.short_oid}
                </span>
                {fileDiff && (
                  <span className="ml-auto text-[10.5px] text-muted-foreground">
                    {fileDiff.hunks.length} hunk{fileDiff.hunks.length === 1 ? "" : "s"}
                  </span>
                )}
                {diffLoading && (
                  <span className="ml-auto text-[10.5px] text-muted-foreground">loading…</span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {/*
                  v0.13.24 — reuse the same Unified renderer the main Diff
                  view uses, but feed it the stash's FileDiff via props so
                  the global `s.diff.fileDiff` stays untouched. Side-by-
                  side mode would need its own filename context too; the
                  preview is read-only and Unified is the more compact
                  choice for a narrow third column anyway.
                */}
                {fileDiff ? (
                  <Unified fileDiff={fileDiff} filename={selectedFile} />
                ) : (
                  <div className="p-4 text-xs text-muted-foreground">
                    {diffLoading ? "Loading diff…" : "No diff."}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
