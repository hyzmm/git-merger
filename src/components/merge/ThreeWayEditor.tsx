import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { ChevronUp, ChevronDown, Eye, EyeOff } from "lucide-react";
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
  const applyAllResolutions = useApp((s) => s.applyAllResolutions);
  const resetAllResolutions = useApp((s) => s.resetAllResolutions);
  const setResultText = useApp((s) => s.setResultText);
  const resolveCurrentFile = useApp((s) => s.resolveCurrentFile);

  const summary = useMemo(() => chunkSummary(chunks), [chunks]);

  // v0.13.18 — show the BASE (common-ancestor) column. Only meaningful when
  // (a) the index has an ancestor blob and (b) the conflict was recorded
  // with diff3 markers. We expose the toggle unconditionally but disable
  // it (with a tooltip) when there's nothing to show.
  const hasAncestor = !!content?.ancestor;
  const [showBase, setShowBase] = useState(false);

  // v0.13.18 — Prev / Next conflict navigation. Find the next pending block
  // first, falling back to the next conflict regardless of state. Bound to
  // F7 / F8 (IDEA-friendly).
  const conflictBlocks = useMemo(
    () => chunks.filter((c): c is ConflictChunk => c.kind === "conflict"),
    [chunks],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeConflict, setActiveConflict] = useState<number>(0);

  const focusConflict = useCallback((idx: number) => {
    setActiveConflict(idx);
    const root = containerRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-conflict-idx="${idx}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const navigate = useCallback(
    (dir: 1 | -1) => {
      if (conflictBlocks.length === 0) return;
      // Try to land on the nearest *pending* block first; fall back to any
      // block if everything is resolved (so the user can still review).
      const order =
        dir === 1
          ? conflictBlocks.map((c) => c.index)
          : [...conflictBlocks.map((c) => c.index)].reverse();
      const cur = activeConflict;
      const pendingHit = order.find((i) =>
        dir === 1
          ? i > cur && conflictBlocks.find((b) => b.index === i)?.resolution === "pending"
          : i < cur && conflictBlocks.find((b) => b.index === i)?.resolution === "pending",
      );
      if (pendingHit !== undefined) {
        focusConflict(pendingHit);
        return;
      }
      const anyHit = order.find((i) => (dir === 1 ? i > cur : i < cur));
      focusConflict(anyHit ?? (dir === 1 ? order[0] : order[order.length - 1]) ?? cur);
    },
    [activeConflict, conflictBlocks, focusConflict],
  );

  // Bind F7 (prev) / F8 (next) inside the merge view. We attach to the
  // section's onKeyDown so the shortcuts only fire when the user has
  // focus inside the merge editor, not globally.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "F8") {
      e.preventDefault();
      navigate(1);
    } else if (e.key === "F7") {
      e.preventDefault();
      navigate(-1);
    }
  }

  if (!file) {
    return (
      <section className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a conflict file from the left.
      </section>
    );
  }

  const allResolved = summary.pending === 0 && summary.total > 0;
  const hasPending = summary.pending > 0;

  return (
    <section
      className="flex h-full min-w-0 flex-col"
      // tabIndex makes the section keyboard-focusable so F7/F8 hit reliably
      // after the user clicks any of the buttons or scrolls the panes.
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs">
        <span className="truncate font-mono">{file}</span>
        <span className="text-[10.5px] text-muted-foreground">
          {summary.resolved}/{summary.total} resolved
        </span>
        <div className="ml-auto flex items-center gap-2">
          {loading && <span className="text-[10.5px] text-muted-foreground">loading...</span>}
          {error && <span className="text-[10.5px] text-destructive">{error}</span>}

          {/* v0.13.18 — Prev / Next conflict navigation. Disabled when the
              file has no conflict blocks (e.g. resolved-only review). */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-secondary">
            <button
              onClick={() => navigate(-1)}
              disabled={conflictBlocks.length === 0}
              title="Previous conflict (F7)"
              className="flex h-7 items-center px-1.5 hover:bg-accent disabled:opacity-50"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => navigate(1)}
              disabled={conflictBlocks.length === 0}
              title="Next conflict (F8)"
              className="flex h-7 items-center px-1.5 hover:bg-accent disabled:opacity-50"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* v0.13.18 — Bulk accept / reset. */}
          <button
            onClick={() => applyAllResolutions("left")}
            disabled={summary.total === 0}
            title="Accept all blocks from the LEFT (ours) side"
            className="h-7 rounded-md border border-border bg-secondary px-2 text-[10.5px] hover:bg-accent disabled:opacity-50"
          >
            All ◄
          </button>
          <button
            onClick={() => applyAllResolutions("right")}
            disabled={summary.total === 0}
            title="Accept all blocks from the RIGHT (theirs) side"
            className="h-7 rounded-md border border-border bg-secondary px-2 text-[10.5px] hover:bg-accent disabled:opacity-50"
          >
            All ►
          </button>
          <button
            onClick={() => applyAllResolutions("both")}
            disabled={summary.total === 0}
            title="Accept BOTH sides for every conflict block (ours then theirs)"
            className="h-7 rounded-md border border-border bg-secondary px-2 text-[10.5px] hover:bg-accent disabled:opacity-50"
          >
            All ◄►
          </button>
          <button
            onClick={resetAllResolutions}
            disabled={summary.total === 0 || (!allResolved && !hasPending)}
            title="Reset every block back to pending (drops applied choices and manual edits)"
            className="h-7 rounded-md border border-border bg-secondary px-2 text-[10.5px] hover:bg-accent disabled:opacity-50"
          >
            Reset
          </button>

          {/* v0.13.18 — Show / hide the BASE column. */}
          <button
            onClick={() => setShowBase((v) => !v)}
            disabled={!hasAncestor}
            title={
              hasAncestor
                ? "Show the common-ancestor (base) column"
                : "No common ancestor available for this conflict"
            }
            className={cn(
              "flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[10.5px] hover:bg-accent disabled:opacity-50",
              showBase && hasAncestor && "bg-secondary text-foreground",
            )}
          >
            {showBase ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            Base
          </button>

          <button
            disabled={hasPending || summary.total === 0}
            onClick={resolveCurrentFile}
            className={cn(
              "h-7 rounded-md px-3 text-xs font-medium",
              !hasPending && summary.total > 0
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "cursor-not-allowed bg-secondary text-muted-foreground opacity-60",
            )}
          >
            Mark resolved &amp; stage
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="grid min-h-0 flex-1 font-mono text-[12px]"
        style={{
          gridTemplateColumns: showBase && hasAncestor ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr",
        }}
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
            <RenderColumn chunks={chunks} side="ours" activeIdx={activeConflict} />
          </div>
        </div>

        {/* BASE (common ancestor) — v0.13.18, optional 4th column */}
        {showBase && hasAncestor && (
          <div className={cn(COL_BASE, "border-r border-border")}>
            <div className={cn(HEAD_BASE)} style={{ borderBottomColor: "hsl(0 0% 60% / .35)" }}>
              <span className="font-semibold text-muted-foreground">BASE — common ancestor</span>
              <span className="text-[10.5px] text-muted-foreground">
                {abbreviate(content?.ancestor)}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <RenderBase chunks={chunks} activeIdx={activeConflict} />
            </div>
          </div>
        )}

        {/* CENTER (result) */}
        <div className={cn(COL_BASE, "border-r border-border")}>
          <div className={cn(HEAD_BASE)} style={{ borderBottomColor: "hsl(142 70% 55% / .4)" }}>
            <span className="font-semibold" style={{ color: "hsl(142 70% 55%)" }}>
              RESULT
            </span>
            <span className="text-[10.5px] text-muted-foreground">working tree</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <RenderResult
              chunks={chunks}
              onAccept={applyResolution}
              onEdit={setResultText}
              onFocus={setActiveConflict}
              activeIdx={activeConflict}
            />
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
            <RenderColumn chunks={chunks} side="theirs" activeIdx={activeConflict} />
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
function RenderColumn({
  chunks,
  side,
  activeIdx,
}: {
  chunks: Chunk[];
  side: "ours" | "theirs";
  activeIdx: number;
}) {
  return (
    <div>
      {chunks.map((c, i) => {
        if (c.kind === "clean") {
          return <CleanText key={`clean-${i}`} text={c.text} />;
        }
        const text = side === "ours" ? c.ours : c.theirs;
        const cls = side === "ours" ? "bg-[hsl(199_89%_60%/.14)]" : "bg-[hsl(280_70%_70%/.14)]";
        const active = c.index === activeIdx;
        return (
          <Fragment key={`conf-${c.index}`}>
            <ConflictMarker chunk={c} side={side} active={active} />
            <pre
              data-conflict-idx={c.index}
              className={cn(
                "m-0 whitespace-pre px-2 py-0",
                cls,
                active && "ring-1 ring-inset ring-[hsl(38_92%_50%/.6)]",
              )}
            >
              {text || "\u00A0"}
            </pre>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Render the BASE column when diff3 markers are available. v0.13.18. */
function RenderBase({ chunks, activeIdx }: { chunks: Chunk[]; activeIdx: number }) {
  return (
    <div>
      {chunks.map((c, i) => {
        if (c.kind === "clean") return <CleanText key={`clean-${i}`} text={c.text} />;
        const baseText = c.base;
        const active = c.index === activeIdx;
        return (
          <Fragment key={`conf-${c.index}`}>
            <div
              className={cn(
                "border-y border-[hsl(0_0%_50%/.3)] bg-[hsl(0_0%_30%/.18)] px-2 py-1 text-[10.5px] italic text-muted-foreground",
                active && "bg-[hsl(38_92%_50%/.14)] text-[hsl(38_92%_60%)]",
              )}
            >
              ◇ Conflict #{c.index + 1} — common ancestor
            </div>
            <pre
              className={cn(
                "m-0 whitespace-pre bg-[hsl(0_0%_50%/.06)] px-2 py-0",
                active && "ring-1 ring-inset ring-[hsl(38_92%_50%/.6)]",
              )}
            >
              {baseText !== undefined
                ? baseText || "\u00A0"
                : "(no diff3 markers — base unavailable)"}
            </pre>
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
  onFocus,
  activeIdx,
}: {
  chunks: Chunk[];
  onAccept: (idx: number, choice: "left" | "right" | "both") => void;
  onEdit: (idx: number, text: string) => void;
  onFocus: (idx: number) => void;
  activeIdx: number;
}) {
  return (
    <div>
      {chunks.map((c, i) => {
        if (c.kind === "clean") return <CleanText key={`clean-${i}`} text={c.text} />;
        const active = c.index === activeIdx;
        return (
          <Fragment key={`conf-${c.index}`}>
            <div
              data-conflict-idx={c.index}
              className={cn(
                "flex items-center gap-1.5 border-y border-[hsl(38_92%_50%/.35)] bg-[hsl(38_92%_50%/.14)] px-2 py-1 text-[11px] text-[hsl(38_92%_60%)]",
                active && "ring-1 ring-inset ring-[hsl(38_92%_50%/.6)]",
              )}
              onClick={() => onFocus(c.index)}
            >
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
              onFocus={() => onFocus(c.index)}
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

function ConflictMarker({
  chunk,
  side,
  active,
}: {
  chunk: ConflictChunk;
  side: "ours" | "theirs";
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-y border-[hsl(38_92%_50%/.35)] bg-[hsl(38_92%_50%/.14)] px-2 py-1 text-[10.5px] italic text-[hsl(38_92%_60%)]",
        active && "ring-1 ring-inset ring-[hsl(38_92%_50%/.6)]",
      )}
    >
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
