/**
 * Centralised confirmation dialog (v0.13.15).
 *
 * Replaces the scattered `window.confirm()` calls with a styled,
 * theme-aware modal that:
 *   - Ranks consequence as `danger` (destructive — red Confirm button)
 *     vs `warning` (recoverable — primary-blue button).
 *   - Lets callers attach a verbatim `detail` block (refspec, oid,
 *     file list…) so the user can verify the exact thing they're
 *     about to do.
 *   - Resolves a Promise<boolean> via the store, so call sites read as
 *     `if (await get().confirm({...})) { ... }` — the same shape as
 *     the previous `confirm(...)` calls but no longer block the JS
 *     thread or steal native window focus.
 *
 * Keyboard: ESC = cancel, Enter = confirm. Click outside the card
 * dismisses too (treated as cancel). Focus jumps to the Confirm
 * button on open so a deliberate Enter press is required.
 */
import { useEffect, useRef } from "react";
import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function ConfirmDialog() {
  const req = useApp((s) => s.confirmRequest);
  const close = useApp((s) => s.closeConfirm);
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Move focus to the Confirm button each time a new prompt mounts so
  // keyboard users can confirm with Enter without first tabbing — but
  // require a deliberate keystroke (no auto-confirm).
  useEffect(() => {
    if (req) confirmRef.current?.focus();
  }, [req?.id]);

  if (!req) return null;

  const onCancel = () => close(false);
  const onConfirm = () => close(true);
  const isDanger = req.level === "danger";
  const Icon = isDanger ? ShieldAlert : AlertTriangle;
  const iconCls = isDanger ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--branch-3))]";
  const defaultLabel = isDanger ? t("common.delete") : t("common.confirm");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        // Backdrop click cancels (only when clicking the overlay itself).
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter") {
          // Don't trigger if user is typing inside an input — but we have
          // no input here, so safe to confirm.
          e.preventDefault();
          onConfirm();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4", iconCls)} />
            <h2 className="text-sm font-semibold">{req.title}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="space-y-3 px-4 py-3">
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{req.message}</p>

          {req.detail && (
            <pre className="max-h-40 overflow-auto rounded border border-border bg-secondary px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">
              {req.detail}
            </pre>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={onCancel}
            >
              {req.cancelLabel ?? t("common.cancel")}
            </Button>
            <Button
              variant={isDanger ? "destructive" : "default"}
              size="sm"
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
            >
              {req.confirmLabel ?? defaultLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
