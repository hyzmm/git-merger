/**
 * Lightweight toast queue, zustand-backed.
 *
 * Why hand-rolled: pulling in a full toast lib for ~120 LOC of UI is overkill;
 * we already render every other primitive with shadcn-flavoured Tailwind, so
 * adding a 4th component file (`<ToastContainer/>`) keeps the bundle lean.
 *
 * Behaviour:
 * - `pushToast` returns the auto-generated id so callers can dismiss imperatively.
 * - Each toast auto-dismisses after `durationMs` (default 5s; `error` uses 7s).
 * - At most `MAX_VISIBLE` toasts on screen — older ones drop off the front.
 *
 * The store is intentionally NOT part of `useApp` so toast events can be fired
 * from anywhere (including outside React render cycles, e.g. invoke wrappers).
 */

import { create } from "zustand";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  variant: ToastVariant;
  /** Plain text (the renderer doesn't interpret markdown / HTML). */
  message: string;
  /** Optional secondary line; rendered smaller. */
  detail?: string;
  /** Auto-dismiss timeout in ms. */
  durationMs: number;
}

export interface ToastStore {
  toasts: Toast[];
  push: (
    variant: ToastVariant,
    message: string,
    opts?: { detail?: string; durationMs?: number },
  ) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_VISIBLE = 4;
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 7000,
};

let nextId = 0;
function makeId(): string {
  nextId += 1;
  return `toast-${nextId}`;
}

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (variant, message, opts) => {
    const id = makeId();
    const toast: Toast = {
      id,
      variant,
      message,
      detail: opts?.detail,
      durationMs: opts?.durationMs ?? DEFAULT_DURATION[variant],
    };
    set((s) => {
      const next = [...s.toasts, toast];
      // Keep tail; older toasts drop off so we never overflow vertically.
      const trimmed = next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
      return { toasts: trimmed };
    });
    return id;
  },
  dismiss: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
  clear: () => set({ toasts: [] }),
}));

// ---------- Convenience helpers ----------

/** Module-level alias so call sites outside React can fire toasts. */
export const toast = {
  info: (message: string, detail?: string) =>
    useToasts.getState().push("info", message, { detail }),
  success: (message: string, detail?: string) =>
    useToasts.getState().push("success", message, { detail }),
  warning: (message: string, detail?: string) =>
    useToasts.getState().push("warning", message, { detail }),
  error: (message: string, detail?: string) =>
    useToasts.getState().push("error", message, { detail }),
  dismiss: (id: string) => useToasts.getState().dismiss(id),
};
