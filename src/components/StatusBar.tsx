/**
 * StatusBar — VS Code-style bottom status bar.
 *
 * Thin bar always visible at the very bottom of the window. Contains an
 * "Output" toggle button that opens/closes the OutputPanel above it.
 * Also shows a live count of active IPC calls and errors.
 */

import { useIpcLog } from "@/lib/ipcLog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function StatusBar() {
  const entries = useIpcLog((s) => s.entries);
  const panelOpen = useIpcLog((s) => s.panelOpen);
  const togglePanel = useIpcLog((s) => s.togglePanel);

  // Last few entries for the mini summary.
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const failCount = entries.filter((e) => !e.ok).length;

  return (
    <div className="flex h-6 shrink-0 select-none items-center gap-2 border-t border-border bg-muted/50 px-2 text-[11px] leading-none text-muted-foreground">
      {/* Output toggle — always visible */}
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onClick={togglePanel}
        title={panelOpen ? "Hide Output panel" : "Show Output panel"}
        className={cn(
          panelOpen ? "bg-accent/60 text-foreground" : "",
        )}
      >
        <span className="text-xs">⎙</span>
        <span>Output</span>
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Last IPC call mini-summary */}
      {lastEntry && (
        <span className="hidden items-center gap-1.5 sm:flex" title={`Last: ${lastEntry.command}`}>
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              lastEntry.ok ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          <span className="max-w-[200px] truncate text-[10px] tabular-nums">
            {lastEntry.command}
          </span>
          <span className="tabular-nums text-[10px]">
            {lastEntry.durationMs.toFixed(0)}ms
          </span>
        </span>
      )}

      {/* Error count badge */}
      {failCount > 0 && (
        <span className="flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">
          <span>✕</span>
          <span className="tabular-nums">{failCount}</span>
        </span>
      )}

      {/* Total count */}
      {entries.length > 0 && (
        <span className="tabular-nums text-[10px] opacity-50">{entries.length}</span>
      )}
    </div>
  );
}
