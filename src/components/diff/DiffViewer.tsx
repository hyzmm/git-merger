import { useCallback, useMemo, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useApp } from "@/stores/app";
import { useShortcuts } from "@/lib/useShortcuts";
import { cn } from "@/lib/utils";
import { SideBySide, Unified } from "./DiffViews";

export function DiffViewer() {
  const oid = useApp((s) => s.diff.oid);
  const file = useApp((s) => s.diff.selectedFile);
  const fileDiff = useApp((s) => s.diff.fileDiff);
  const loading = useApp((s) => s.diff.loading);
  const error = useApp((s) => s.diff.error);
  const mode = useApp((s) => s.diff.mode);
  const setMode = useApp((s) => s.setDiffMode);
  const showWhitespace = useApp((s) => s.diff.showWhitespace);
  const toggleWhitespace = useApp((s) => s.toggleWhitespace);
  const ignoreWhitespace = useApp((s) => s.diff.ignoreWhitespace);
  const toggleIgnoreWhitespace = useApp((s) => s.toggleIgnoreWhitespace);
  const openBlame = useApp((s) => s.openBlame);
  const openFileHistory = useApp((s) => s.openFileHistory);
  const view = useApp((s) => s.view);

  const containerRef = useRef<HTMLDivElement>(null);

  const goToHunk = useCallback((dir: 1 | -1) => {
    const root = containerRef.current;
    if (!root) return;
    const scroller = root.querySelector<HTMLElement>("[data-diff-scroll]");
    if (!scroller) return;
    const headers = Array.from(scroller.querySelectorAll<HTMLElement>("[data-hunk-index]"));
    if (headers.length === 0) return;
    const top = scroller.scrollTop;
    // Find the hunk closest to the current viewport top.
    let currentIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].offsetTop - 4 <= top) currentIdx = i;
      else break;
    }
    let nextIdx: number;
    if (dir === 1) {
      nextIdx = Math.min(currentIdx + 1, headers.length - 1);
      // If we haven't moved past the current header at all, the user expects
      // to advance to the next one.
      if (currentIdx === -1) nextIdx = 0;
    } else {
      nextIdx = Math.max(currentIdx - 1, 0);
    }
    const target = headers[nextIdx];
    if (target) scroller.scrollTo({ top: target.offsetTop, behavior: "smooth" });
  }, []);

  const shortcuts = useMemo(
    () => ({
      n: () => goToHunk(1),
      p: () => goToHunk(-1),
      "shift+n": () => goToHunk(1),
      "shift+p": () => goToHunk(-1),
    }),
    [goToHunk],
  );
  useShortcuts(shortcuts, view === "diff");

  if (!oid || !file) {
    return (
      <section className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a file from the left to view diff.
      </section>
    );
  }

  const hunkCount = fileDiff?.hunks.length ?? 0;

  return (
    <section ref={containerRef} className="flex h-full min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <span className="truncate font-mono">{file}</span>
        <span className="font-mono text-[10.5px] text-muted-foreground">{oid.slice(0, 7)}</span>
        <div className="ml-2 inline-flex overflow-hidden rounded-md border border-border">
          <SegBtn active={mode === "sbs"} onClick={() => setMode("sbs")}>
            Side-by-side
          </SegBtn>
          <SegBtn active={mode === "unified"} onClick={() => setMode("unified")}>
            Unified
          </SegBtn>
        </div>

        {/* Hunk navigation */}
        <div className="ml-2 inline-flex overflow-hidden rounded-md border border-border">
          <button
            onClick={() => goToHunk(-1)}
            disabled={hunkCount === 0}
            title="Previous change (P)"
            className={cn(
              "flex h-[26px] items-center px-2 text-muted-foreground hover:bg-accent",
              hunkCount === 0 && "cursor-not-allowed opacity-40",
            )}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => goToHunk(1)}
            disabled={hunkCount === 0}
            title="Next change (N)"
            className={cn(
              "flex h-[26px] items-center px-2 text-muted-foreground hover:bg-accent",
              hunkCount === 0 && "cursor-not-allowed opacity-40",
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => file && void openFileHistory(file)}
            disabled={!file}
            className={cn(
              "h-7 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
              !file && "cursor-not-allowed opacity-50",
            )}
            title="Show this file's history (follows renames)"
          >
            History
          </button>
          <button
            onClick={() => file && openBlame(file)}
            disabled={!file}
            className={cn(
              "h-7 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
              !file && "cursor-not-allowed opacity-50",
            )}
            title="Show git blame for this file"
          >
            Blame
          </button>
          <button
            onClick={toggleIgnoreWhitespace}
            className={cn(
              "h-7 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
              ignoreWhitespace && "border-border bg-secondary text-foreground",
            )}
            title="Ignore whitespace changes (recompute diff)"
          >
            Ignore WS
          </button>
          <button
            onClick={toggleWhitespace}
            className={cn(
              "h-7 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
              showWhitespace && "border-border bg-secondary text-foreground",
            )}
            title="Show whitespace (· for space, → for tab)"
          >
            ⌫ Whitespace
          </button>
          {fileDiff && (
            <span className="text-[10.5px] text-muted-foreground">
              {hunkCount} hunk{hunkCount === 1 ? "" : "s"}
            </span>
          )}
          {loading && <span className="text-[10.5px] text-muted-foreground">loading...</span>}
          {error && <span className="text-[10.5px] text-destructive">{error}</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {!fileDiff ? (
          <div className="p-4 text-xs text-muted-foreground">
            {loading ? "Loading diff..." : "No diff."}
          </div>
        ) : mode === "sbs" ? (
          <SideBySide />
        ) : (
          <Unified />
        )}
      </div>
    </section>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-[26px] cursor-pointer border-none bg-transparent px-2.5 text-xs",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
      )}
    >
      {children}
    </button>
  );
}
