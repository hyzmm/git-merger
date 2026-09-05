/**
 * Full-screen diff dialog for viewing file changes at a specific commit.
 * Renders the diff inline (Unified or Side-by-Side) without navigating
 * away from the current view — replaces the old standalone Diff View page.
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/stores/app";
import { git, type FileChange, type FileDiff } from "@/ipc/git";
import { SideBySide, Unified } from "@/components/diff/DiffViews";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

export interface DiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Commit oid to diff against its parent(s). */
  oid: string;
  /** Currently selected file path. */
  filename: string;
  /** All files changed in this commit (for prev/next navigation). */
  allFiles: FileChange[];
  /** Called when the user navigates to a different file via prev/next. */
  onNavigate: (file: FileChange) => void;
}

export function DiffDialog({
  open,
  onOpenChange,
  oid,
  filename,
  allFiles,
  onNavigate,
}: DiffDialogProps) {
  const repoPath = useApp((s) => s.repo?.path ?? null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"unified" | "sbs">("unified");

  // Current index in allFiles for prev/next navigation.
  const fileIndex = useMemo(
    () => allFiles.findIndex((f) => f.path === filename),
    [allFiles, filename],
  );
  const prevFile = fileIndex > 0 ? allFiles[fileIndex - 1] : null;
  const nextFile = fileIndex < allFiles.length - 1 ? allFiles[fileIndex + 1] : null;

  // Load diff whenever the dialog opens with a new file.
  useEffect(() => {
    if (!open || !repoPath || !oid || !filename) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFileDiff(null);
    void (async () => {
      try {
        const fd = await git.fileDiff(repoPath, oid, filename);
        if (!cancelled) {
          setFileDiff(fd);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, repoPath, oid, filename]);

  const shortOid = oid.length > 7 ? oid.slice(0, 7) : oid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-0 p-0 sm:max-w-[95vw]"
        showCloseButton={false}
      >
        {/* ---- Header ---- */}
        <DialogHeader className="shrink-0 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-3">
            <DialogTitle className="flex-1 truncate font-mono text-sm">
              {filename}
            </DialogTitle>

            {/* File navigation */}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!prevFile}
                title={prevFile ? `Previous: ${prevFile.path}` : undefined}
                onClick={() => prevFile && onNavigate(prevFile)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {fileIndex + 1}/{allFiles.length}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!nextFile}
                title={nextFile ? `Next: ${nextFile.path}` : undefined}
                onClick={() => nextFile && onNavigate(nextFile)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Commit oid badge */}
            <span className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {shortOid}
            </span>

            {/* Mode toggle */}
            <div className="flex shrink-0 items-center gap-0 rounded-md border border-border bg-secondary p-0.5">
              <Button
                onClick={() => setMode("unified")}
                variant={mode === "unified" ? "default" : "ghost"}
                size="xs"
              >
                Unified
              </Button>
              <Button
                onClick={() => setMode("sbs")}
                variant={mode === "sbs" ? "default" : "ghost"}
                size="xs"
              >
                Side-by-side
              </Button>
            </div>

            {/* Close */}
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => onOpenChange(false)}
            >
              <span className="sr-only">Close</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </Button>
          </div>
        </DialogHeader>

        {/* ---- Body ---- */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading diff…
            </div>
          )}
          {error && (
            <div className="flex h-full items-center justify-center text-xs text-destructive">
              {error}
            </div>
          )}
          {!loading && !error && fileDiff && (
            <>
              {mode === "sbs" ? (
                <SideBySide fileDiff={fileDiff} filename={filename} />
              ) : (
                <Unified fileDiff={fileDiff} filename={filename} />
              )}
            </>
          )}
          {!loading && !error && !fileDiff && (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No diff available.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
