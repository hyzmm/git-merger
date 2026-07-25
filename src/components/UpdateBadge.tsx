import { useState } from "react";
import { ArrowUpCircle, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { useUpdater } from "@/lib/useUpdater";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

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
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
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
      </Button>

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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t("updater.later")}
            </Button>
            {ready ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => void apply()}
              >
                <RefreshCw className="h-3 w-3" />
                {t("updater.restart")}
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => void downloadAndInstall()}
                disabled={downloading}
              >
                {downloading ? t("common.loading") : t("updater.download")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
