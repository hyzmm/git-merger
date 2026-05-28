import { FileTree } from "@/components/diff/FileTree";
import { DiffViewer } from "@/components/diff/DiffViewer";

/**
 * Two-pane layout: file tree on the left, viewer on the right.
 *
 * v0.13.22 fix — every grid cell needs explicit `min-h-0` AND `h-full` so the
 * inner `h-full` chains in `DiffViewer` / `SideBySide` / `Unified` actually
 * resolve to a bounded height. Without that the cell defaults to
 * `min-height: auto`, gets pushed past the viewport by the diff content,
 * and the inner `overflow-auto` scroller has nothing to scroll inside of.
 */
export function DiffPage() {
  return (
    <div className="grid h-full min-h-0 grid-cols-[280px_1fr] overflow-hidden">
      <div className="min-h-0 h-full overflow-hidden border-r border-border">
        <FileTree />
      </div>
      <div className="min-h-0 min-w-0 h-full overflow-hidden">
        <DiffViewer />
      </div>
    </div>
  );
}
