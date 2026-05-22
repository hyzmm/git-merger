import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ClipboardCopy } from "lucide-react";
import { useApp, WORKING_OID } from "@/stores/app";
import { useShortcuts } from "@/lib/useShortcuts";
import { git } from "@/ipc/git";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { SideBySide, Unified } from "./DiffViews";
import { WorkingDiffEditor } from "./WorkingDiffEditor";

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
  const repo = useApp((s) => s.repo);
  const editActive = useApp((s) => s.diff.edit.active);
  const editBusy = useApp((s) => s.diff.edit.busy);
  const editBuffer = useApp((s) => s.diff.edit.buffer);
  const editSaved = useApp((s) => s.diff.edit.savedText);
  const setEditActive = useApp((s) => s.setEditActive);
  const saveEditBuffer = useApp((s) => s.saveEditBuffer);
  const resetEditBuffer = useApp((s) => s.resetEditBuffer);

  const isWorking = oid === WORKING_OID;
  const dirty = isWorking && editBuffer !== null && editSaved !== null && editBuffer !== editSaved;

  // v0.13.9 — "Copy patch" feedback (the button briefly shows "Copied!"
  // so the user knows the clipboard write succeeded; reverts after ~1.5s).
  const [copied, setCopied] = useState(false);
  const copyPatch = useCallback(async () => {
    if (!repo || !file) return;
    try {
      const patch =
        oid === WORKING_OID
          ? await git.formatWorkingFilePatch(repo.path, file)
          : oid
            ? await git.formatCommitFilePatch(repo.path, oid, file)
            : "";
      if (!patch.trim()) {
        toast.warning("No diff content to copy.");
        return;
      }
      await navigator.clipboard.writeText(patch);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast.error(`Failed to copy patch: ${String(e)}`);
    }
  }, [repo, file, oid]);

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
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {isWorking ? "working tree" : oid.slice(0, 7)}
        </span>
        {dirty && (
          <span
            className="rounded bg-[hsl(var(--diff-modified-bg))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--diff-modified-fg))]"
            title="Unsaved edits"
          >
            ● dirty
          </span>
        )}
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
          {isWorking && mode === "sbs" && (
            <>
              <button
                onClick={() => void setEditActive(!editActive)}
                disabled={editBusy}
                className={cn(
                  "h-7 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
                  editActive && "border-border bg-secondary text-foreground",
                  editBusy && "cursor-not-allowed opacity-50",
                )}
                title="Toggle bidirectional editing of the working-tree file"
              >
                ✎ Edit
              </button>
              {editActive && (
                <>
                  <button
                    onClick={() => void saveEditBuffer()}
                    disabled={editBusy || !dirty}
                    className={cn(
                      "h-7 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
                      dirty && !editBusy && "text-foreground",
                      (editBusy || !dirty) && "cursor-not-allowed opacity-50",
                    )}
                    title="Save the buffer to the working tree"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => void resetEditBuffer()}
                    disabled={editBusy || !dirty}
                    className={cn(
                      "h-7 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
                      (editBusy || !dirty) && "cursor-not-allowed opacity-50",
                    )}
                    title="Discard buffer edits and reload from disk"
                  >
                    Reset
                  </button>
                </>
              )}
            </>
          )}
          <button
            onClick={() => void copyPatch()}
            disabled={!file || loading}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
              (!file || loading) && "cursor-not-allowed opacity-50",
              copied && "text-[hsl(var(--branch-4))]",
            )}
            title="Copy this file's diff as a unified-patch string (the format git apply / git am consume)"
          >
            <ClipboardCopy className="h-3 w-3" />
            {copied ? "Copied!" : "Copy patch"}
          </button>
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
        {isWorking && editActive && mode === "sbs" ? (
          <WorkingDiffEditor />
        ) : !fileDiff ? (
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
