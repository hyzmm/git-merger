import type { ReactNode } from "react";
import { type WordToken } from "@/lib/wordDiff";
import type { Token } from "@/lib/highlighter";
import { cn } from "@/lib/utils";

/**
 * v0.13.34 — A search hit range inside a single line. Coordinates are
 * char offsets into the post-`stripNL` content. `active` distinguishes
 * the *current* match (orange-ish, the one the prev/next nav points
 * to) from the rest (yellow-ish background hint).
 */
export interface SearchHit {
  start: number;
  end: number;
  active: boolean;
}

/**
 * Render the visible content of a single diff line, with three layered
 * highlighting passes (in priority order, low → high):
 *   1. **syntax tokens** (Shiki) — base coloring for code
 *   2. **word tokens** (wordDiff) — green/red intra-line +/− emphasis
 *   3. **search hits** (v0.13.34) — yellow/orange overlay on top of
 *      whatever was drawn by 1+2
 *
 * Implementation note: search hits are painted as an absolutely-
 * positioned background layer below the text rather than by splicing
 * into the token stream. This keeps the existing tokenization logic
 * untouched (it's already non-trivial) and makes hits work uniformly
 * across the three render branches (word / syntax / plaintext) without
 * having to thread token-merging through each one.
 */
function LineContent({
  content,
  showWhitespace,
  wordTokens,
  syntaxTokens,
  searchHits,
}: {
  content: string;
  showWhitespace: boolean;
  wordTokens?: WordToken[];
  syntaxTokens?: Token[];
  searchHits?: SearchHit[];
}) {
  // Strip the trailing newline that git2 includes in line content.
  const text = content.replace(/\r?\n$/, "");

  // The text body (one of three render branches).
  let body: ReactNode;
  if (wordTokens && wordTokens.length > 0) {
    body = (
      <span>
        {wordTokens.map((t, i) => (
          <span
            key={i}
            className={cn(
              t.kind === "add" && "rounded-sm bg-[hsl(var(--diff-word-add,142_76%_45%/.45))] px-px",
              t.kind === "del" && "rounded-sm bg-[hsl(var(--diff-word-del,0_72%_55%/.5))] px-px",
            )}
          >
            {showWhitespace ? renderWhitespace(t.text) : t.text}
          </span>
        ))}
      </span>
    );
  } else if (syntaxTokens && syntaxTokens.length > 0) {
    body = (
      <span>
        {syntaxTokens.map((t, i) => (
          <span
            key={i}
            style={{
              color: t.color,
              fontStyle: t.italic ? "italic" : undefined,
              fontWeight: t.bold ? 600 : undefined,
            }}
          >
            {showWhitespace ? renderWhitespace(t.text) : t.text}
          </span>
        ))}
      </span>
    );
  } else {
    body = <span>{showWhitespace ? renderWhitespace(text) : text}</span>;
  }

  // No search hits → just emit the body. This is the hot path (no
  // allocation overhead while the search bar isn't open).
  if (!searchHits || searchHits.length === 0) return body;

  // With hits, we wrap in a relative container and paint hit
  // backgrounds underneath. Each hit becomes one absolutely-positioned
  // <span> sized via `ch` units against the monospace text. `ch` is
  // the width of "0" in the current font — for our monospace stack
  // it's an exact 1:1 with column width, so start/end translate to
  // pixel-perfect overlay rectangles.
  return (
    <span className="relative inline-block">
      <span aria-hidden className="pointer-events-none absolute inset-0">
        {searchHits.map((h, i) => (
          <span
            key={i}
            className={cn(
              "absolute top-0 bottom-0 rounded-sm",
              h.active
                ? "bg-[hsl(35_95%_55%/.55)] outline outline-1 outline-[hsl(35_95%_55%)]"
                : "bg-[hsl(50_95%_55%/.35)]",
            )}
            style={{ left: `${h.start}ch`, width: `${h.end - h.start}ch` }}
          />
        ))}
      </span>
      <span className="relative">{body}</span>
    </span>
  );
}

function renderWhitespace(s: string): ReactNode {
  const parts: ReactNode[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === " " || ch === "\t") {
      if (buf) {
        parts.push(buf);
        buf = "";
      }
      parts.push(
        <span key={i} className="text-muted-foreground/50">
          {ch === " " ? "·" : "→\u00A0"}
        </span>,
      );
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push(buf);
  return <>{parts}</>;
}

/** Single line cell for unified or one side of side-by-side. */
export function DiffLineCell({
  origin,
  lineno,
  content,
  wordTokens,
  syntaxTokens,
  showWhitespace,
  selected,
  onClick,
  searchHits,
  dataLineKey,
}: {
  origin: " " | "+" | "-" | null;
  lineno: number | null;
  content: string;
  wordTokens?: WordToken[];
  syntaxTokens?: Token[];
  showWhitespace: boolean;
  /** v0.13.25 — drives the selected-row tinting in the line-level
   *  staging picker. Only meaningful for `+` / `−` rows; ignored
   *  visually on context rows even if accidentally true. */
  selected?: boolean;
  /** v0.13.25 — fired with the native event so the caller can detect
   *  shift-click for range selection. Click is wired by the Unified
   *  view; SideBySide doesn't (yet) participate in line-level staging. */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** v0.13.34 — search match ranges to overlay on this line. */
  searchHits?: SearchHit[];
  /** v0.13.34 — `"hunkIdx:lineIdx"` key so the search bar can locate
   *  the row via querySelector and scrollIntoView. Optional because
   *  not every renderer (e.g. ImageDiff) wants this. */
  dataLineKey?: string;
}) {
  const bg =
    origin === "+"
      ? "bg-[hsl(var(--diff-added-bg))]"
      : origin === "-"
        ? "bg-[hsl(var(--diff-removed-bg))]"
        : origin === null
          ? "bg-[hsl(var(--card)/.4)]"
          : "";
  const markerColor =
    origin === "+"
      ? "text-[hsl(var(--diff-added-fg))]"
      : origin === "-"
        ? "text-[hsl(var(--diff-removed-fg))]"
        : "text-muted-foreground";

  // The selection ring sits inside the row so it doesn't disturb the
  // grid columns. Indicate selection with both a left-edge accent bar
  // and a slight bg shift, mirroring how IntelliJ marks staged-line
  // candidates.
  const isSelectable = onClick !== undefined && (origin === "+" || origin === "-");
  return (
    <div
      onClick={onClick}
      data-diff-line={dataLineKey}
      className={cn(
        "grid items-start font-mono leading-[18px]",
        bg,
        isSelectable && "cursor-pointer",
        selected &&
          "ring-1 ring-inset ring-[hsl(var(--branch-1)/.7)] bg-[hsl(var(--branch-1)/.18)]",
      )}
      style={{ gridTemplateColumns: "50px 14px 1fr", columnGap: 8 }}
    >
      <span
        className="select-none bg-[hsl(var(--diff-gutter,220_13%_13%))] pr-2 text-right text-muted-foreground"
        style={{ paddingRight: 8 }}
      >
        {lineno ?? ""}
      </span>
      <span className={cn("select-none text-center", markerColor)}>
        {origin === " " ? "" : (origin ?? "")}
      </span>
      <span className="overflow-x-auto whitespace-pre pr-3">
        <LineContent
          content={content}
          showWhitespace={showWhitespace}
          wordTokens={wordTokens}
          syntaxTokens={syntaxTokens}
          searchHits={searchHits}
        />
      </span>
    </div>
  );
}
