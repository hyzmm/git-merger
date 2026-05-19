import { Fragment, useMemo } from "react";
import { useApp } from "@/stores/app";
import { type Chunk, type ConflictChunk, chunkSummary } from "@/lib/conflictParser";
import { cn } from "@/lib/utils";

const COL_BASE = "flex min-w-0 flex-col bg-background";
const HEAD_BASE = "flex h-8 shrink-0 items-center gap-2 border-b bg-card px-3 text-xs";

export function ThreeWayEditor() {
  const file = useApp((s) => s.merge.selectedFile);
  const chunks = useApp((s) => s.merge.chunks);
  const content = useApp((s) => s.merge.content);
  const loading = useApp((s) => s.merge.loading);
  const error = useApp((s) => s.merge.error);
  const applyResolution = useApp((s) => s.applyResolution);
  const setResultText = useApp((s) => s.setResultText);
  const resolveCurrentFile = useApp((s) => s.resolveCurrentFile);

  const summary = useMemo(() => chunkSummary(chunks), [chunks]);

  if (!file) {
    return (
      <section className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a conflict file from the left.
      </section>
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs">
        <span className="truncate font-mono">{file}</span>
        <span className="text-[10.5px] text-muted-foreground">
          {summary.resolved}/{summary.total} resolved
        </span>
        <div className="ml-auto flex items-center gap-2">
          {loading && <span className="text-[10.5px] text-muted-foreground">loading...</span>}
          {error && <span className="text-[10.5px] text-destructive">{error}</span>}
          <button
            disabled={summary.pending > 0 || summary.total === 0}
            onClick={resolveCurrentFile}
            className={cn(
              "h-7 rounded-md px-3 text-xs font-medium",
              summary.pending === 0 && summary.total > 0
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "cursor-not-allowed bg-secondary text-muted-foreground opacity-60",
            )}
          >
            Mark resolved &amp; stage
          </button>
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1 grid-cols-3 font-mono text-[12px]"
        style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
      >
        {/* LEFT (ours) */}
        <div className={cn(COL_BASE, "border-r border-border")}>
          <div className={cn(HEAD_BASE)} style={{ borderBottomColor: "hsl(199 89% 60% / .35)" }}>
            <span className="font-semibold" style={{ color: "hsl(199 89% 60%)" }}>
              LEFT — ours
            </span>
            <span className="text-[10.5px] text-muted-foreground">{abbreviate(content?.ours)}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <RenderColumn chunks={chunks} side="ours" />
          </div>
        </div>

        {/* CENTER (result) */}
        <div className={cn(COL_BASE, "border-r border-border")}>
          <div className={cn(HEAD_BASE)} style={{ borderBottomColor: "hsl(142 70% 55% / .4)" }}>
            <span className="font-semibold" style={{ color: "hsl(142 70% 55%)" }}>
              RESULT
            </span>
            <span className="text-[10.5px] text-muted-foreground">working tree</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <RenderResult chunks={chunks} onAccept={applyResolution} onEdit={setResultText} />
          </div>
        </div>

        {/* RIGHT (theirs) */}
        <div className={COL_BASE}>
          <div className={cn(HEAD_BASE)} style={{ borderBottomColor: "hsl(280 70% 70% / .35)" }}>
            <span className="font-semibold" style={{ color: "hsl(280 70% 70%)" }}>
              RIGHT — theirs
            </span>
            <span className="text-[10.5px] text-muted-foreground">
              {abbreviate(content?.theirs)}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <RenderColumn chunks={chunks} side="theirs" />
          </div>
        </div>
      </div>
    </section>
  );
}

function abbreviate(s: string | null | undefined): string {
  if (!s) return "(empty)";
  const lines = s.split("\n").length;
  return `${lines} lines · ${s.length} chars`;
}

/** Render LEFT or RIGHT column. */
function RenderColumn({ chunks, side }: { chunks: Chunk[]; side: "ours" | "theirs" }) {
  return (
    <div>
      {chunks.map((c, i) => {
        if (c.kind === "clean") {
          return <CleanText key={`clean-${i}`} text={c.text} />;
        }
        const text = side === "ours" ? c.ours : c.theirs;
        const cls = side === "ours" ? "bg-[hsl(199_89%_60%/.14)]" : "bg-[hsl(280_70%_70%/.14)]";
        return (
          <Fragment key={`conf-${c.index}`}>
            <ConflictMarker chunk={c} side={side} />
            <pre className={cn("m-0 whitespace-pre px-2 py-0", cls)}>{text || "\u00A0"}</pre>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Render center column with action toolbar per conflict block. */
function RenderResult({
  chunks,
  onAccept,
  onEdit,
}: {
  chunks: Chunk[];
  onAccept: (idx: number, choice: "left" | "right" | "both") => void;
  onEdit: (idx: number, text: string) => void;
}) {
  return (
    <div>
      {chunks.map((c, i) => {
        if (c.kind === "clean") return <CleanText key={`clean-${i}`} text={c.text} />;
        return (
          <Fragment key={`conf-${c.index}`}>
            <div className="flex items-center gap-1.5 border-y border-[hsl(38_92%_50%/.35)] bg-[hsl(38_92%_50%/.14)] px-2 py-1 text-[11px] text-[hsl(38_92%_60%)]">
              <span>Conflict #{c.index + 1}</span>
              <span className="text-muted-foreground">— {c.resolution}</span>
              <div className="ml-auto flex gap-1">
                <ActionBtn
                  onClick={() => onAccept(c.index, "left")}
                  active={c.resolution === "left"}
                >
                  Accept Left
                </ActionBtn>
                <ActionBtn
                  onClick={() => onAccept(c.index, "right")}
                  active={c.resolution === "right"}
                >
                  Accept Right
                </ActionBtn>
                <ActionBtn
                  onClick={() => onAccept(c.index, "both")}
                  active={c.resolution === "both"}
                >
                  Accept Both
                </ActionBtn>
              </div>
            </div>
            <textarea
              value={c.result}
              onChange={(e) => onEdit(c.index, e.target.value)}
              spellCheck={false}
              className={cn(
                "block w-full resize-none border-0 bg-transparent px-2 py-1 font-mono text-[12px] leading-[18px] outline-none",
                c.resolution === "pending" && "bg-[hsl(0_72%_51%/.10)]",
                c.resolution === "left" && "bg-[hsl(199_89%_60%/.14)]",
                c.resolution === "right" && "bg-[hsl(280_70%_70%/.14)]",
                c.resolution === "both" && "bg-[hsl(142_70%_55%/.14)]",
                c.resolution === "manual" && "bg-[hsl(38_92%_50%/.10)]",
              )}
              style={{ height: Math.max(2, lineCount(c.result)) * 18 + 16 }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

function lineCount(s: string): number {
  if (!s) return 1;
  return s.split("\n").length;
}

function CleanText({ text }: { text: string }) {
  return <pre className="m-0 whitespace-pre px-2 py-0">{text || "\u00A0"}</pre>;
}

function ConflictMarker({ chunk, side }: { chunk: ConflictChunk; side: "ours" | "theirs" }) {
  return (
    <div className="border-y border-[hsl(38_92%_50%/.35)] bg-[hsl(38_92%_50%/.14)] px-2 py-1 text-[10.5px] italic text-[hsl(38_92%_60%)]">
      ◀ Conflict #{chunk.index + 1} — {side === "ours" ? chunk.oursLabel : chunk.theirsLabel}
    </div>
  );
}

function ActionBtn({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-5 rounded border px-2 text-[10.5px]",
        active
          ? "border-[hsl(142_70%_55%/.5)] bg-[hsl(142_70%_55%/.18)] text-[hsl(142_70%_55%)]"
          : "border-border bg-secondary text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
