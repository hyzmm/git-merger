/**
 * OutputPanel — VS Code-style bottom output panel.
 *
 * Displays a live log of every JS → Rust IPC call (command name + duration)
 * so developers can spot slow backend operations when working with large repos.
 *
 * Behaviour:
 * - Auto-scrolls to the bottom when new entries arrive (unless the user has
 *   scrolled up to inspect older entries).
 * - Colour-codes durations: <100ms = dim, 100-500ms = amber, >500ms = red.
 * - Right-click context menu with Copy / Select All / Clear.
 * - Cmd/Ctrl+K shortcut to clear the panel.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useIpcLog, type IpcLogEntry } from "@/lib/ipcLog";
import { ContextMenu, type MenuItem, type ContextMenuPos } from "@/components/ContextMenu";

function durationClass(ms: number): string {
  if (ms < 100) return "text-muted-foreground/70";
  if (ms < 500) return "text-amber-400";
  return "text-red-400";
}

function Row({ entry }: { entry: IpcLogEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false });
  return (
    <div className="flex items-center gap-2 border-b border-border/40 px-3 py-0.5 font-mono text-xs leading-relaxed hover:bg-accent/30">
      {/* status dot */}
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${entry.ok ? "bg-emerald-400" : "bg-red-400"
          }`}
      />
      {/* timestamp */}
      <span className="shrink-0 text-muted-foreground/60 tabular-nums">{time}</span>
      {/* command name */}
      <span className="min-w-0 flex-1 truncate">{entry.command}</span>
      {/* duration */}
      <span className={`shrink-0 text-right tabular-nums ${durationClass(entry.durationMs)}`}>
        {entry.durationMs.toFixed(1)}ms
      </span>
    </div>
  );
}

export function OutputPanel() {
  const entries = useIpcLog((s) => s.entries);
  const clear = useIpcLog((s) => s.clear);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuPos | null>(null);

  // Auto-scroll to bottom when new entries arrive.
  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [entries, autoScroll]);

  // Detect manual scroll-up to pause auto-scroll.
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    // If the user is within 24px of the bottom, resume auto-scroll.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  };

  // ---------- context menu ----------

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const copySelection = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text) {
      void navigator.clipboard.writeText(text);
      return;
    }
    // No selection → copy all log text.
    if (!containerRef.current) return;
    const all = Array.from(containerRef.current.querySelectorAll("[data-log-row]")).map(
      (el) => el.textContent ?? "",
    );
    void navigator.clipboard.writeText(all.join("\n"));
  }, []);

  const selectAll = useCallback(() => {
    if (!containerRef.current) return;
    const range = document.createRange();
    range.selectNodeContents(containerRef.current);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  // Cmd/Ctrl+K → clear; Cmd/Ctrl+A → select only panel content
  const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      clear();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      // Only intercept if focus is inside this panel.
      if (containerRef.current?.contains(e.target as Node)) {
        e.preventDefault();
        selectAll();
      }
    }
  }, []);

  const ctxMenuItems: MenuItem[] = [
    { label: "Copy", onClick: copySelection },
    { label: "Select All", onClick: selectAll },
    { label: "", separator: true },
    {
      label: navigator.platform.includes("Mac") ? "Clear (⌘K)" : "Clear (Ctrl+K)",
      onClick: clear,
    },
  ];

  // Count failed calls for the status-bar badge.
  const failCount = entries.filter((e) => !e.ok).length;

  return (
    <div className="flex h-full flex-col border-t border-border bg-card">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/50 bg-muted/30 px-2 py-0.5">
        <span className="select-none text-xs font-medium text-foreground/80">OUTPUT</span>

        {/* Spacer */}
        <div className="flex-1" />

        {entries.length > 0 && (
          <span className="select-none text-[10px] tabular-nums text-muted-foreground/60">
            {entries.length} entries{failCount > 0 ? ` · ${failCount} errors` : ""}
          </span>
        )}

        {/* Clear */}
        <button
          type="button"
          onClick={clear}
          title="Clear output (⌘K / Ctrl+K)"
          className="select-none rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        >
          Clear
        </button>

        {/* Auto-scroll indicator */}
        <button
          type="button"
          onClick={() => setAutoScroll((v) => !v)}
          title={autoScroll ? "Auto-scroll ON — click to lock" : "Auto-scroll OFF — scrolled up"}
          className={`select-none rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent ${autoScroll ? "text-muted-foreground/60" : "text-amber-400"
            }`}
        >
          {autoScroll ? "↡ Auto" : "↟ Locked"}
        </button>
      </div>

      {/* Log list */}
      <div
        tabIndex={0}
        ref={containerRef}
        onKeyDown={onKey}
        onScroll={handleScroll}
        onContextMenu={handleContextMenu}
        className="flex-1 overflow-y-auto overscroll-contain select-text cursor-auto"
      >
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50 select-none">
            IPC calls will appear here as they happen…
          </div>
        ) : (
          entries.map((e) => <Row key={e.id} entry={e} />)
        )}
      </div>
      <ContextMenu pos={ctxMenu} items={ctxMenuItems} onClose={closeCtxMenu} />
    </div>
  );
}
