import { useCallback, useEffect, useRef, useState } from "react";
import { RefsPane } from "@/components/history/RefsPane";
import { CommitList } from "@/components/history/CommitList";
import { CommitDetails } from "@/components/history/CommitDetails";
import {
  HISTORY_LEFT_MAX,
  HISTORY_LEFT_MIN,
  HISTORY_RIGHT_MAX,
  HISTORY_RIGHT_MIN,
  useSettings,
} from "@/stores/settings";

/**
 * v0.13.34 — Resizable three-pane history view.
 *
 * Previous behaviour: `grid-cols-[220px_1fr_380px]` — both side columns
 * were hardcoded, which hurt branches with long names (truncated to
 * ellipsis at 220 px) and commit subjects on small windows.
 *
 * Now: left and right widths are stored in `useSettings` (clamped to
 * sane ranges, persisted across sessions). Two thin drag handles sit
 * over the grid borders; mousedown captures the pointer and updates
 * the width during mousemove until mouseup.
 *
 * The drag is "live" rather than "preview-then-commit" because we want
 * the inner panes (which are full-height scroll containers) to reflow
 * immediately so users can judge the new width visually. The cost is
 * one settings write per mousemove tick; localStorage handles ~1k
 * writes/sec comfortably and we throttle anyway by writing only the
 * rounded integer pixel value.
 */
export function HistoryPage() {
  const leftW = useSettings((s) => s.historyLeftWidth);
  const rightW = useSettings((s) => s.historyRightWidth);
  const setSettings = useSettings((s) => s.set);

  // Active drag state. `null` = not dragging; otherwise we know which
  // divider is being dragged and need only translate clientX deltas
  // into a new width.
  const [drag, setDrag] = useState<null | "left" | "right">(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const onMouseDown = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      setDrag(side);
    },
    [],
  );

  // While a divider is being dragged, listen on the window so the
  // pointer can stray off the thin handle without dropping the drag,
  // and so we still get the mouseup if the user releases off-screen.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (drag === "left") {
        const w = Math.round(e.clientX - rect.left);
        const clamped = Math.min(HISTORY_LEFT_MAX, Math.max(HISTORY_LEFT_MIN, w));
        setSettings({ historyLeftWidth: clamped });
      } else {
        const w = Math.round(rect.right - e.clientX);
        const clamped = Math.min(HISTORY_RIGHT_MAX, Math.max(HISTORY_RIGHT_MIN, w));
        setSettings({ historyRightWidth: clamped });
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // While dragging, force the col-resize cursor everywhere — otherwise
    // when the pointer briefly leaves the 4 px handle the cursor flickers
    // back to default and the drag feels janky.
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [drag, setSettings]);

  return (
    <div
      ref={containerRef}
      className="grid h-full"
      // Inline grid template because the widths are dynamic. The
      // middle 1fr column always absorbs the remaining space, so the
      // CommitList shrinks/grows symmetrically as either side moves.
      style={{ gridTemplateColumns: `${leftW}px 1fr ${rightW}px` }}
    >
      <div className="relative min-h-0 min-w-0 overflow-hidden border-r border-border">
        <RefsPane />
        {/* Left divider: 4 px wide invisible bar overlapping the right edge.
            We keep the visible separator (border-r above) and only catch
            pointer events here; this matches IntelliJ where the visible
            line stays still and the hit-target sits on top of it. */}
        <DragHandle onMouseDown={onMouseDown("left")} active={drag === "left"} />
      </div>
      <div className="relative min-h-0 min-w-0 overflow-hidden border-r border-border">
        <CommitList />
        <DragHandle onMouseDown={onMouseDown("right")} active={drag === "right"} />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">
        <CommitDetails />
      </div>
    </div>
  );
}

/**
 * Thin invisible drag-target overlapping the right edge of its parent
 * column. Becomes visible (subtle accent line) when the user is actually
 * dragging, so the hit area remains discoverable but doesn't visually
 * compete with the static border in the resting state.
 */
function DragHandle({
  onMouseDown,
  active,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  active: boolean;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      // -right-[2px] centres the 4 px hit area over the 1 px border.
      // z-10 ensures it sits above the inner pane content (which has
      // overflow-auto scrollbars that would otherwise eat the grab).
      className={`absolute -right-0.5 top-0 z-10 h-full w-1 cursor-col-resize transition-colors ${
        active ? "bg-primary/60" : "hover:bg-primary/40"
      }`}
    />
  );
}
