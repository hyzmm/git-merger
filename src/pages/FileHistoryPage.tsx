/**
 * Per-file history view (`git log --follow -- <file>` equivalent).
 *
 * Left: chronological commit list for this file, with rename markers.
 * Right: the diff of the selected commit *for the path the file had at
 *        that commit* — so renames are transparent.
 *
 * Entry points:
 *   - Diff toolbar "File history" button (current file)
 *   - Blame toolbar "File history" button
 *   - Commit-details right-click on a file
 */
import { useEffect } from "react";
import { ArrowRight, FileClock, GitCommit, History as HistoryIcon } from "lucide-react";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { SideBySide, Unified } from "@/components/diff/DiffViews";

const STATUS_TONES: Record<string, string> = {
  added: "bg-[hsl(var(--branch-1)/.20)] text-[hsl(var(--branch-1))]",
  modified: "bg-[hsl(var(--branch-2)/.20)] text-[hsl(var(--branch-2))]",
  deleted: "bg-[hsl(var(--destructive)/.18)] text-[hsl(var(--destructive))]",
  renamed: "bg-[hsl(var(--branch-3)/.20)] text-[hsl(var(--branch-3))]",
  copied: "bg-[hsl(var(--branch-4)/.20)] text-[hsl(var(--branch-4))]",
  typechange: "bg-secondary text-foreground",
};

export function FileHistoryPage() {
  const repo = useApp((s) => s.repo);
  const fh = useApp((s) => s.fileHistory);
  const select = useApp((s) => s.selectFileHistoryEntry);
  const setView = useApp((s) => s.setView);
  const openDiff = useApp((s) => s.openDiff);
  const openBlame = useApp((s) => s.openBlame);
  const mode = useApp((s) => s.diff.mode);
  const setDiffMode = useApp((s) => s.setDiffMode);
  const t = useT();

  // Restore last view if user navigates here without a target.
  useEffect(() => {
    if (repo && !fh.startPath) setView("history");
  }, [repo, fh.startPath, setView]);

  if (!repo) return null;

  const entry = fh.entries[fh.selectedIdx];

  return (
    <div className="grid h-full grid-cols-[360px_1fr]">
      {/* Left — commit list */}
      <div className="flex h-full min-h-0 flex-col border-r border-border">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
          <FileClock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-foreground">{fh.startPath}</span>
          <span className="text-muted-foreground">
            · {fh.entries.length} {t("fileHistory.commits")}
          </span>
          {fh.loading && <span className="text-muted-foreground">· loading…</span>}
          <button
            onClick={() => fh.startPath && void openBlame(fh.startPath)}
            disabled={!fh.startPath}
            title={t("fileHistory.openBlame")}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <HistoryIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        {fh.error && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
            {fh.error}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {!fh.loading && fh.entries.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              {t("fileHistory.empty")}
            </div>
          )}
          {fh.entries.map((e, i) => (
            <button
              key={`${e.commit.oid}-${i}`}
              onClick={() => void select(i)}
              className={cn(
                "block w-full border-b border-border/40 px-3 py-2 text-left hover:bg-accent/30",
                i === fh.selectedIdx && "bg-accent/60",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-4 rounded px-1.5 text-[9.5px] font-medium uppercase tracking-wider leading-4",
                    STATUS_TONES[e.status] ?? STATUS_TONES.modified,
                  )}
                >
                  {e.status}
                </span>
                <span className="font-mono text-[11px] text-[hsl(var(--branch-1))]">
                  {e.commit.short_oid}
                </span>
                <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">
                  {timeAgo(e.commit.time)}
                </span>
              </div>
              <div className="mt-1 truncate text-xs">{e.commit.summary}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <span>{e.commit.author_name}</span>
                {(e.insertions > 0 || e.deletions > 0) && (
                  <span className="font-mono">
                    {e.insertions > 0 && (
                      <span className="text-[hsl(142_70%_55%)]">+{e.insertions}</span>
                    )}
                    {e.insertions > 0 && e.deletions > 0 && " "}
                    {e.deletions > 0 && (
                      <span className="text-[hsl(0_72%_65%)]">-{e.deletions}</span>
                    )}
                  </span>
                )}
              </div>
              {(e.status === "renamed" || e.status === "copied") && e.old_path && (
                <div className="mt-1 flex items-center gap-1 truncate font-mono text-[10.5px] text-muted-foreground">
                  <span className="line-through">{e.old_path}</span>
                  <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                  <span>{e.path_at_commit}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right — diff at selected commit */}
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
          {entry ? (
            <>
              <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate font-mono">{entry.path_at_commit}</span>
              <span className="text-muted-foreground">·</span>
              <button
                onClick={() => {
                  // Jump to the full commit diff in the standard Diff view.
                  void openDiff(entry.commit.oid, entry.path_at_commit);
                }}
                title={t("fileHistory.openInDiff")}
                className="font-mono text-[11px] text-[hsl(var(--branch-1))] hover:underline"
              >
                {entry.commit.short_oid}
              </button>
              <span className="truncate text-muted-foreground">{entry.commit.summary}</span>

              <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-secondary p-0.5">
                <button
                  onClick={() => setDiffMode("sbs")}
                  className={cn(
                    "h-6 rounded px-2 text-[11px]",
                    mode === "sbs" ? "bg-background text-foreground" : "text-muted-foreground",
                  )}
                >
                  Side-by-side
                </button>
                <button
                  onClick={() => setDiffMode("unified")}
                  className={cn(
                    "h-6 rounded px-2 text-[11px]",
                    mode === "unified" ? "bg-background text-foreground" : "text-muted-foreground",
                  )}
                >
                  Unified
                </button>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">{t("fileHistory.selectCommit")}</span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {fh.diffLoading && <div className="p-4 text-xs text-muted-foreground">Loading diff…</div>}
          {!fh.diffLoading && fh.fileDiff && entry && (
            <>
              {mode === "sbs" ? (
                <SideBySide fileDiff={fh.fileDiff} filename={entry.path_at_commit} />
              ) : (
                <Unified fileDiff={fh.fileDiff} filename={entry.path_at_commit} />
              )}
            </>
          )}
          {!fh.diffLoading && !fh.fileDiff && entry && (
            <div className="p-4 text-xs text-muted-foreground">No diff.</div>
          )}
        </div>
      </div>
    </div>
  );
}
