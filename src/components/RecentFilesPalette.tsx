import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Eye, FilePlus2, GitBranch, History, Trash2 } from "lucide-react";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { RecentAction, RecentFile } from "@/lib/recentFiles";

/**
 * v0.13.8 — Recent Files palette (Ctrl+E).
 *
 * IDE-style "jump back to a hot file" overlay. Lists the per-repo MRU
 * collected by `noteRecentFile`, with three reopen actions:
 *   - **Enter** → Diff view (working-tree if the file's modified, else
 *     HEAD diff via the file's history). Default and most common.
 *   - **Shift+Enter** → Blame at HEAD.
 *   - **Ctrl+Enter** → File history (follows renames).
 *
 * The icon next to each row reflects the *last* action the user took
 * with that file, so a quick glance tells them "I was diffing this"
 * vs "I was blaming this".
 *
 * Keyboard model:
 *   - First Ctrl+E opens the palette with the second-most-recent file
 *     pre-selected (matches IntelliJ Recent Files: holding Ctrl and
 *     hitting E once goes "back" by one entry, twice goes back two).
 *     If only one entry exists, that's selected.
 *   - ↓ / Tab moves the selection down (wraps).
 *   - ↑ / Shift+Tab moves up (wraps).
 *   - Esc closes without selecting.
 *
 * Persistence + bumping all live in the store. This component is
 * read-only over the slice except for the `forgetRecentFile` per-row
 * delete affordance.
 */
export function RecentFilesPalette() {
  const t = useT();
  const open = useApp((s) => s.recentFilesOpen);
  const recentFiles = useApp((s) => s.recentFiles);
  const close = useApp((s) => s.closeRecentFiles);
  const forget = useApp((s) => s.forgetRecentFile);
  const openWorkingDiff = useApp((s) => s.openWorkingDiff);
  const openBlame = useApp((s) => s.openBlame);
  const openFileHistory = useApp((s) => s.openFileHistory);

  // Pre-select the second entry on open (matches IntelliJ semantics —
  // the first entry is "where you are right now"). When there's only
  // one entry, fall back to it.
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(recentFiles.length > 1 ? 1 : 0);
  }, [open, recentFiles.length]);

  // Keep the selected row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-recent-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);

  const items = useMemo(() => recentFiles.slice(), [recentFiles]);

  const move = (delta: number) => {
    if (items.length === 0) return;
    setSelected((s) => (s + delta + items.length) % items.length);
  };

  const activate = (entry: RecentFile, action: RecentAction) => {
    close();
    if (action === "blame") void openBlame(entry.path);
    else if (action === "history") void openFileHistory(entry.path);
    else void openWorkingDiff(entry.path);
  };

  // Keyboard handling. Attached to window while the palette is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const entry = items[selected];
        if (!entry) return;
        const action: RecentAction =
          e.ctrlKey || e.metaKey ? "history" : e.shiftKey ? "blame" : "diff";
        activate(entry, action);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, selected]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh]"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-lg border border-border bg-card text-card-foreground shadow-2xl"
        role="dialog"
        aria-label={t("recent.title")}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <History className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">{t("recent.title")}</span>
          <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Ctrl+E
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-auto py-1">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {t("recent.empty")}
            </div>
          ) : (
            items.map((entry, idx) => (
              <RecentRow
                key={entry.path}
                entry={entry}
                index={idx}
                active={idx === selected}
                onSelect={() => setSelected(idx)}
                onActivate={() => activate(entry, "diff")}
                onForget={() => forget(entry.path)}
              />
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border bg-secondary/40 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="font-mono">↑↓</kbd> {t("recent.hint.navigate")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono">↵</kbd> {t("recent.hint.diff")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono">⇧↵</kbd> {t("recent.hint.blame")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono">⌃↵</kbd> {t("recent.hint.history")}
          </span>
          <span className="ml-auto">{items.length}</span>
        </div>
      </div>
    </div>
  );
}

function RecentRow({
  entry,
  index,
  active,
  onSelect,
  onActivate,
  onForget,
}: {
  entry: RecentFile;
  index: number;
  active: boolean;
  onSelect: () => void;
  onActivate: () => void;
  onForget: () => void;
}) {
  // Pick the icon from the *last* action so the user can scan the list
  // and see "ah, I last edited this one, and was diffing the other".
  const Icon =
    entry.action === "blame"
      ? Eye
      : entry.action === "history"
        ? GitBranch
        : entry.action === "working"
          ? FilePlus2
          : ArrowRight;

  const norm = entry.path.replace(/\\/g, "/");
  const lastSlash = norm.lastIndexOf("/");
  const dir = lastSlash >= 0 ? norm.slice(0, lastSlash + 1) : "";
  const file = lastSlash >= 0 ? norm.slice(lastSlash + 1) : norm;

  return (
    <div
      data-recent-idx={index}
      onMouseEnter={onSelect}
      onClick={onActivate}
      className={cn(
        "group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-mono text-[12.5px]">{file}</span>
        {dir && <span className="ml-2 font-mono text-[11px] text-muted-foreground">{dir}</span>}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onForget();
        }}
        title="Remove from recent files"
        className={active ? "opacity-70" : "opacity-0 group-hover:opacity-70"}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
      {active && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
    </div>
  );
}
