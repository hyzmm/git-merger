import { useState } from "react";
import { ArrowUpCircle, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { useUpdater } from "@/lib/useUpdater";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Tiny badge that appears in the Topbar when an update is available.
 *  In dev / unsigned builds the underlying check() throws — we just hide
 *  the badge in those cases (status === "error" or "idle"). */
export function UpdateBadge() {
  const { state, downloadAndInstall, apply } = useUpdater();
  const [open, setOpen] = useState(false);
  const t = useT();

  // Only render once we have something to say.
  if (state.status === "idle" || state.status === "checking" || state.status === "error") {
    return null;
  }

  const downloading = state.status === "downloading";
  const ready = state.status === "ready";
  const pct = state.progress?.total
    ? Math.round((state.progress.downloaded / state.progress.total) * 100)
    : null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border border-[hsl(var(--branch-1)/.4)] bg-[hsl(var(--branch-1)/.10)] px-2 text-xs text-[hsl(var(--branch-1))] hover:bg-[hsl(var(--branch-1)/.18)]",
        )}
        title={t("updater.title")}
      >
        {ready ? (
          <CheckCircle className="h-3.5 w-3.5" />
        ) : downloading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowUpCircle className="h-3.5 w-3.5" />
        )}
        <span>
          {ready
            ? t("updater.ready")
            : downloading
              ? t("updater.downloading", { pct: pct ?? 0 })
              : t("updater.available", { version: state.available?.version ?? "?" })}
        </span>
      </button>

      {open && state.available && (
        <div className="absolute right-0 top-9 z-50 w-80 rounded-md border border-border bg-popover p-3 text-xs shadow-lg">
          <div className="mb-1.5 flex items-center gap-2">
            <ArrowUpCircle className="h-4 w-4 text-[hsl(var(--branch-1))]" />
            <span className="font-semibold">{t("updater.title")}</span>
            <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
              v{state.available.version}
            </span>
          </div>

          {state.available.notes && (
            <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-secondary/50 p-2 font-mono text-[10.5px] text-muted-foreground">
              {state.available.notes}
            </pre>
          )}

          {downloading && (
            <div className="mb-2 h-1 w-full overflow-hidden rounded bg-secondary">
              <div
                className="h-full bg-[hsl(var(--branch-1))] transition-all"
                style={{ width: `${pct ?? 30}%` }}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="h-7 rounded-md border border-border bg-secondary px-3 text-[11px] hover:bg-accent"
            >
              {t("updater.later")}
            </button>
            {ready ? (
              <button
                onClick={() => void apply()}
                className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:opacity-90"
              >
                <RefreshCw className="h-3 w-3" />
                {t("updater.restart")}
              </button>
            ) : (
              <button
                onClick={() => void downloadAndInstall()}
                disabled={downloading}
                className={cn(
                  "h-7 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:opacity-90",
                  downloading && "cursor-not-allowed opacity-60",
                )}
              >
                {downloading ? t("common.loading") : t("updater.download")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
