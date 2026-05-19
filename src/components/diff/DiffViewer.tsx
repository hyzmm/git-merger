import { useApp } from "@/stores/app";
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
  const openBlame = useApp((s) => s.openBlame);

  if (!oid || !file) {
    return (
      <section className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a file from the left to view diff.
      </section>
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-col">
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
        <div className="ml-auto flex items-center gap-2">
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
            onClick={toggleWhitespace}
            className={cn(
              "h-7 rounded-md border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent",
              showWhitespace && "border-border bg-secondary",
            )}
            title="Show whitespace (· for space, → for tab)"
          >
            ⌫ Whitespace
          </button>
          {fileDiff && (
            <span className="text-[10.5px] text-muted-foreground">
              {fileDiff.hunks.length} hunk{fileDiff.hunks.length === 1 ? "" : "s"}
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
