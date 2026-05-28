import { useMemo } from "react";
import { useApp, WORKING_OID } from "@/stores/app";
import { DiffLineCell } from "./DiffPrimitives";
import { pairLines, type PairedLine } from "@/lib/pairLines";
import { unifiedWordTokens } from "@/lib/unifiedWordTokens";
import { useHighlight } from "@/lib/useHighlight";
import { selectionKey } from "@/lib/subsetPatch";
import { cn } from "@/lib/utils";
import type { DiffHunk, FileDiff } from "@/ipc/git";

function stripNL(s: string): string {
  return s.replace(/\r?\n$/, "");
}

/** Build per-side full source lines for syntax highlighting from a list of
 *  paired lines. Empty (alignment) cells become empty strings so token
 *  arrays stay 1:1 with rows. */
function extractSidesFromPairs(pairs: PairedLine[]) {
  const left: string[] = [];
  const right: string[] = [];
  for (const p of pairs) {
    left.push(p.oldOrigin === null ? "" : stripNL(p.oldContent));
    right.push(p.newOrigin === null ? "" : stripNL(p.newContent));
  }
  return { left, right };
}

function extractUnifiedSource(hunks: DiffHunk[]) {
  // Each line independently. Context + add lines reflect the new file; del
  // lines reflect the old file. For coloring purposes either is fine — we
  // only need plausible language structure inside a hunk.
  return hunks.flatMap((h) => h.lines.map((ln) => stripNL(ln.content)));
}

interface DiffViewProps {
  /** Optional override; falls back to s.diff.fileDiff. */
  fileDiff?: FileDiff | null;
  /** Filename for syntax-highlighting language detection. */
  filename?: string;
}

export function SideBySide({ fileDiff: fdProp, filename: nameProp }: DiffViewProps = {}) {
  const fdStore = useApp((s) => s.diff.fileDiff);
  const showWhitespace = useApp((s) => s.diff.showWhitespace);
  const fnStore = useApp((s) => s.diff.selectedFile ?? "");
  const fileDiff = fdProp !== undefined ? fdProp : fdStore;
  const filename = nameProp ?? fnStore;

  const hunks = useMemo(() => {
    if (!fileDiff) return [];
    return fileDiff.hunks.map((h) => ({
      header: h.header,
      pairs: pairLines(h.lines),
    }));
  }, [fileDiff]);

  // Concatenate all hunks side-by-side; tokens come back as a flat 2D array
  // and we slice it back per hunk.
  const { leftLines, rightLines, hunkOffsets } = useMemo(() => {
    const left: string[] = [];
    const right: string[] = [];
    const offsets: number[] = [];
    for (const h of hunks) {
      offsets.push(left.length);
      const sides = extractSidesFromPairs(h.pairs);
      left.push(...sides.left);
      right.push(...sides.right);
    }
    return { leftLines: left, rightLines: right, hunkOffsets: offsets };
  }, [hunks]);

  const leftTokens = useHighlight(leftLines, filename);
  const rightTokens = useHighlight(rightLines, filename);

  if (!fileDiff) return null;
  if (fileDiff.is_binary) {
    return <div className="p-4 text-xs text-muted-foreground">Binary file — no preview.</div>;
  }

  return (
    <div
      data-diff-scroll
      className="grid h-full min-h-0 grid-cols-2 overflow-auto bg-background text-[12px]"
    >
      <div className="min-w-0 border-r border-border">
        {hunks.map((h, hi) => (
          <div key={hi} data-hunk-index={hi}>
            <HunkHeader text={h.header} />
            {h.pairs.map((p, i) => {
              const tokRow = leftTokens?.[hunkOffsets[hi] + i];
              return (
                <DiffLineCell
                  key={`L${hi}-${i}`}
                  origin={p.oldOrigin}
                  lineno={p.oldLineno}
                  content={p.oldContent}
                  wordTokens={p.leftTokens}
                  syntaxTokens={p.oldOrigin !== null ? tokRow : undefined}
                  showWhitespace={showWhitespace}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="min-w-0">
        {hunks.map((h, hi) => (
          <div key={hi}>
            <HunkHeader text={h.header} />
            {h.pairs.map((p, i) => {
              const tokRow = rightTokens?.[hunkOffsets[hi] + i];
              return (
                <DiffLineCell
                  key={`R${hi}-${i}`}
                  origin={p.newOrigin}
                  lineno={p.newLineno}
                  content={p.newContent}
                  wordTokens={p.rightTokens}
                  syntaxTokens={p.newOrigin !== null ? tokRow : undefined}
                  showWhitespace={showWhitespace}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Unified({ fileDiff: fdProp, filename: nameProp }: DiffViewProps = {}) {
  const fdStore = useApp((s) => s.diff.fileDiff);
  const showWhitespace = useApp((s) => s.diff.showWhitespace);
  const fnStore = useApp((s) => s.diff.selectedFile ?? "");
  const fileDiff = fdProp !== undefined ? fdProp : fdStore;
  const filename = nameProp ?? fnStore;

  // v0.13.25 — line-level staging is only meaningful for the live
  // working-tree diff (HEAD diffs are read-only history). Drive the
  // selection UI off the same store slice that the action buttons in
  // DiffViewer's toolbar dispatch into. When `fdProp` is provided we're
  // being rendered as someone else's preview (e.g. the StashPage)
  // — keep the picker disabled there too.
  const oid = useApp((s) => s.diff.oid);
  const selectedLines = useApp((s) => s.diff.selectedLines);
  const toggleDiffLine = useApp((s) => s.toggleDiffLine);
  const extendDiffLineRangeTo = useApp((s) => s.extendDiffLineRangeTo);
  const linePickerActive = oid === WORKING_OID && fdProp === undefined;

  const hunks = useMemo(() => fileDiff?.hunks ?? [], [fileDiff]);
  const flatLines = useMemo(() => extractUnifiedSource(hunks), [hunks]);
  const tokens = useHighlight(flatLines, filename);
  // Pre-compute the per-line word-token overlay for each hunk. Indexed by
  // the line's position **within its own hunk** so the lookup below is
  // independent of any global offsetting.
  const wordTokensByHunk = useMemo(() => hunks.map((h) => unifiedWordTokens(h.lines)), [hunks]);

  if (!fileDiff) return null;
  if (fileDiff.is_binary) {
    return <div className="p-4 text-xs text-muted-foreground">Binary file — no preview.</div>;
  }

  let cursor = 0;
  return (
    <div data-diff-scroll className="h-full min-h-0 overflow-auto bg-background text-[12px]">
      {hunks.map((h, hi) => {
        const wt = wordTokensByHunk[hi];
        return (
          <div key={hi} data-hunk-index={hi}>
            <HunkHeader text={h.header} />
            {h.lines.map((ln, i) => {
              const tokRow = tokens?.[cursor++];
              const key = selectionKey(hi, i);
              const isSel = linePickerActive && selectedLines.has(key);
              const onClick =
                linePickerActive && (ln.origin === "+" || ln.origin === "-")
                  ? (e: React.MouseEvent<HTMLDivElement>) => {
                      if (e.shiftKey) extendDiffLineRangeTo(hi, i);
                      else toggleDiffLine(hi, i);
                    }
                  : undefined;
              return (
                <DiffLineCell
                  key={`U${hi}-${i}`}
                  origin={ln.origin}
                  lineno={ln.origin === "-" ? ln.old_lineno : ln.new_lineno}
                  content={ln.content}
                  wordTokens={wt[i]}
                  syntaxTokens={tokRow}
                  showWhitespace={showWhitespace}
                  selected={isSel}
                  onClick={onClick}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function HunkHeader({ text }: { text: string }) {
  return (
    <div
      className={cn(
        "border-y border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground",
      )}
    >
      {text.replace(/\r?\n$/, "")}
    </div>
  );
}
