/**
 * Lightweight IPC-call profiler store, zustand-backed.
 *
 * Every `invoke()` call in `src/ipc/invoke.ts` pushes a log entry here so
 * the OutputPanel can surface command names + durations in real time. This
 * is intentionally a standalone store (not part of `useApp`) so the timing
 * wrapper works outside React render cycles.
 */

import { create } from "zustand";

export interface IpcLogEntry {
  id: number;
  command: string;
  /** Elapsed wall-clock time in milliseconds. */
  durationMs: number;
  /** ISO-8601 timestamp when the call *completed*. */
  timestamp: string;
  /** `true` = resolved, `false` = rejected. */
  ok: boolean;
}

export interface IpcLogStore {
  entries: IpcLogEntry[];
  /** Maximum entries to keep in memory (FIFO). */
  maxEntries: number;
  /** Whether the Output panel is visible. */
  panelOpen: boolean;
  push: (entry: Omit<IpcLogEntry, "id">) => void;
  clear: () => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
}

let nextId = 0;

export const useIpcLog = create<IpcLogStore>((set) => ({
  entries: [],
  maxEntries: 500,
  panelOpen: false,

  push: (entry) => {
    const id = nextId++;
    const record: IpcLogEntry = { id, ...entry };
    set((s) => {
      const next = [...s.entries, record];
      const trimmed =
        next.length > s.maxEntries ? next.slice(next.length - s.maxEntries) : next;
      return { entries: trimmed };
    });
  },

  clear: () => set({ entries: [] }),

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (open) => set({ panelOpen: open }),
}));

/** Module-level push so timing code outside React can log without a hook. */
export const ipcLog = {
  push: (entry: Omit<IpcLogEntry, "id">) => useIpcLog.getState().push(entry),
  clear: () => useIpcLog.getState().clear(),
};
