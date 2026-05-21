/**
 * Renders the global toast queue from `useToasts`.
 *
 * Mounted once at the App root. Every toast schedules its own dismissal
 * timer in a per-toast `useEffect`, so dismissals (manual or auto) can
 * never race with new pushes — the queue is the single source of truth.
 */
import { useEffect } from "react";
import { useToasts, type Toast, type ToastVariant } from "@/lib/toast";

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: "border-sky-500/60 bg-sky-500/10 text-sky-100",
  success: "border-emerald-500/60 bg-emerald-500/10 text-emerald-100",
  warning: "border-amber-500/60 bg-amber-500/10 text-amber-100",
  error: "border-rose-500/60 bg-rose-500/10 text-rose-100",
};

const VARIANT_GLYPH: Record<ToastVariant, string> = {
  info: "ⓘ",
  success: "✓",
  warning: "!",
  error: "✕",
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    if (toast.durationMs <= 0) return;
    const handle = window.setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(handle);
  }, [toast.id, toast.durationMs, dismiss]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg backdrop-blur-sm ${
        VARIANT_CLASSES[toast.variant]
      }`}
    >
      <span aria-hidden className="mt-0.5 select-none font-mono text-xs opacity-80">
        {VARIANT_GLYPH[toast.variant]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="break-words leading-snug">{toast.message}</div>
        {toast.detail ? (
          <div className="mt-0.5 break-words text-xs opacity-70">{toast.detail}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss"
        className="-mr-1 ml-1 rounded px-1 text-xs opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToasts((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
