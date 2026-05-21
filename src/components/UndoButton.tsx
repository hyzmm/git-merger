/**
 * Topbar Undo button.
 *
 * Shows the most recent reflog entry that maps to a meaningful undo
 * (`reset` / `merge` / `pull` / `cherry-pick` / `revert` / `rebase` /
 * `commit (amend)`) — pulls reflog on mount and on every refresh, hides
 * itself when the reflog has no useful candidate.
 *
 * Click main button → 2-step confirmation → `git reset --mixed <oldOid>`
 * (preserves working tree changes the user might have).
 *
 * Click chevron → dropdown listing the next 8 undoable entries with
 * inline "Undo" buttons each.
 */
import { useEffect, useRef, useState } from "react";
import { Undo2, ChevronDown } from "lucide-react";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { findQuickUndo, listUndoables } from "@/lib/reflogActions";

export function UndoButton() {
  const repo = useApp((s) => s.repo);
  const entries = useApp((s) => s.reflog.entries);
  const loadReflog = useApp((s) => s.loadReflog);
  const resetTo = useApp((s) => s.resetTo);
  const t = useT();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ index: number; oid: string } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Eagerly load reflog when the user opens a repo so the button has
  // data without needing to navigate to the Reflog view first.
  useEffect(() => {
    if (repo) void loadReflog();
  }, [repo, loadReflog]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!repo) return null;

  const top = findQuickUndo(entries);
  if (!top) return null;
  const list = listUndoables(entries, 8);

  const tooltip = `${t("undo.tooltip").replace("{verb}", top.action.verb)} (HEAD@{${top.index}} → ${top.shortTargetOid})`;

  const doUndo = async (oid: string, index: number) => {
    setPending({ index, oid });
    try {
      await resetTo(oid, "mixed");
      setOpen(false);
      // Refresh reflog list so the next "most recent" entry pops to the top.
      void loadReflog();
    } finally {
      setPending(null);
    }
  };

  return (
    <div ref={popoverRef} className="relative flex items-center">
      <button
        onClick={() => void doUndo(top.targetOid, top.index)}
        disabled={pending !== null}
        title={tooltip}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-l-md border border-border bg-secondary px-2 text-xs text-foreground hover:bg-accent",
          pending !== null && "cursor-not-allowed opacity-60",
        )}
      >
        <Undo2 className="h-3.5 w-3.5" />
        <span className="hidden capitalize lg:inline">
          {t("undo.label").replace("{verb}", top.action.verb)}
        </span>
        <span className="lg:hidden">{t("undo.shortLabel")}</span>
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("undo.moreTitle")}
        className={cn(
          "inline-flex h-8 items-center justify-center rounded-r-md border border-l-0 border-border bg-secondary px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-30 w-[360px] overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <div className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("undo.recent")}
          </div>
          <div className="max-h-[320px] overflow-auto">
            {list.length === 0 && (
              <div className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                {t("undo.empty")}
              </div>
            )}
            {list.map((c) => (
              <button
                key={c.index}
                disabled={pending !== null}
                onClick={() => void doUndo(c.targetOid, c.index)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border/40 px-3 py-1.5 text-left hover:bg-accent",
                  pending?.index === c.index && "opacity-60",
                )}
              >
                <span className="w-14 shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">
                  HEAD@{`{${c.index}}`}
                </span>
                <span className="w-16 shrink-0 truncate text-[10.5px] uppercase tracking-wider text-[hsl(var(--branch-3))]">
                  {c.action.label}
                </span>
                <span className="flex-1 truncate text-[11px]" title={c.message}>
                  {c.message}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {c.shortTargetOid}
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-border bg-secondary/40 px-3 py-1 text-[10px] text-muted-foreground">
            {t("undo.hint")}
          </div>
        </div>
      )}
    </div>
  );
}
