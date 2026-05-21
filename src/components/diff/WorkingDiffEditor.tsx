/**
 * Side-by-side editable view for the working tree.
 *
 * Engaged when the Diff view's `oid === WORKING_OID` and the user has flipped
 * the **Edit** toggle on the Diff toolbar. The left pane is the read-only
 * HEAD blob; the right pane is a `<textarea>` bound to `diff.edit.buffer`.
 * Both panes share row height and scroll together so visual alignment stays
 * roughly intact even as the user edits.
 *
 * Why a `<textarea>` rather than per-line editing inside the diff hunk
 * structure: keeping a per-line model in sync with edits requires re-running
 * a diff after every keystroke and rebuilding the alignment table — an
 * accidentally-quadratic interactive cost. A plain textarea + post-save diff
 * refresh is the IDE-grade convention (VS Code's Compare Editor uses the
 * same approach) and keeps the typing path trivially fast.
 */
import { useCallback, useEffect, useRef } from "react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";

const ROW_PX = 18; // matches the inline `lineHeight` below
const FONT_FAMILY =
  '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, "Courier New", monospace';

export function WorkingDiffEditor() {
  const headText = useApp((s) => s.diff.edit.headText);
  const buffer = useApp((s) => s.diff.edit.buffer);
  const savedText = useApp((s) => s.diff.edit.savedText);
  const busy = useApp((s) => s.diff.edit.busy);
  const error = useApp((s) => s.diff.edit.error);
  const setEditBuffer = useApp((s) => s.setEditBuffer);

  const headRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<HTMLTextAreaElement>(null);

  const dirty = buffer !== null && savedText !== null && buffer !== savedText;

  const onScrollHead = useCallback(() => {
    const head = headRef.current;
    const buf = bufferRef.current;
    if (!head || !buf) return;
    if (Math.abs(buf.scrollTop - head.scrollTop) > 1) {
      buf.scrollTop = head.scrollTop;
    }
  }, []);
  const onScrollBuf = useCallback(() => {
    const head = headRef.current;
    const buf = bufferRef.current;
    if (!head || !buf) return;
    if (Math.abs(head.scrollTop - buf.scrollTop) > 1) {
      head.scrollTop = buf.scrollTop;
    }
  }, []);

  // When the buffer is reloaded externally (Reset or Save), make sure both
  // panes scroll to the same anchor so the user doesn't see an offset jump.
  useEffect(() => {
    const head = headRef.current;
    const buf = bufferRef.current;
    if (!head || !buf) return;
    head.scrollTop = buf.scrollTop;
  }, [savedText]);

  if (headText === null || buffer === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        {busy ? "Loading file…" : "No working-tree file loaded."}
      </div>
    );
  }

  const headLines = headText.split("\n");
  const bufferLines = buffer.split("\n");

  return (
    <div className="grid h-full min-h-0 grid-cols-2 overflow-hidden bg-background text-[12px]">
      {/* LEFT — read-only HEAD reference with line gutter. */}
      <div
        ref={headRef}
        onScroll={onScrollHead}
        className="min-w-0 overflow-auto border-r border-border"
      >
        <div className="flex">
          <Gutter
            count={headLines.length}
            className="border-r border-border bg-card text-muted-foreground"
          />
          <pre
            className="m-0 flex-1 select-text whitespace-pre px-2 py-0 text-foreground"
            style={{ fontFamily: FONT_FAMILY, lineHeight: `${ROW_PX}px` }}
          >
            {headText.length === 0 ? (
              <span className="text-muted-foreground">(empty / not in HEAD)</span>
            ) : (
              headText
            )}
          </pre>
        </div>
      </div>

      {/* RIGHT — editable working-tree buffer. */}
      <div className="flex min-w-0 flex-col">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Gutter
            count={bufferLines.length}
            className={cn(
              "shrink-0 overflow-auto border-r border-border bg-card text-muted-foreground",
              dirty && "bg-[hsl(var(--diff-modified-bg))]/40",
            )}
            scrollSync={bufferRef}
          />
          <textarea
            ref={bufferRef}
            value={buffer}
            spellCheck={false}
            wrap="off"
            onChange={(e) => setEditBuffer(e.target.value)}
            onScroll={onScrollBuf}
            disabled={busy}
            className="flex-1 resize-none border-0 bg-transparent px-2 py-0 text-foreground outline-none"
            style={{ fontFamily: FONT_FAMILY, lineHeight: `${ROW_PX}px` }}
          />
        </div>
        {error ? (
          <div className="border-t border-border bg-destructive/10 px-3 py-1 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Vertical line-number gutter. Matches `ROW_PX` so it lines up with the
 * adjacent text pane row-for-row. When `scrollSync` is provided, the gutter
 * auto-tracks that element's scrollTop (textarea doesn't fire onScroll on
 * its own children, so we need this manual sync for the right pane).
 */
function Gutter({
  count,
  className,
  scrollSync,
}: {
  count: number;
  className?: string;
  scrollSync?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = scrollSync?.current;
    const gutter = ref.current;
    if (!target || !gutter) return;
    const handler = () => {
      gutter.scrollTop = target.scrollTop;
    };
    target.addEventListener("scroll", handler, { passive: true });
    return () => target.removeEventListener("scroll", handler);
  }, [scrollSync]);

  const numbers: string[] = [];
  for (let i = 1; i <= count; i++) numbers.push(String(i));

  return (
    <div
      ref={ref}
      className={cn("select-none px-2 text-right text-[11px] tabular-nums", className)}
      style={{ minWidth: 44, lineHeight: `${ROW_PX}px` }}
      aria-hidden
    >
      {numbers.map((n) => (
        <div key={n}>{n}</div>
      ))}
    </div>
  );
}
