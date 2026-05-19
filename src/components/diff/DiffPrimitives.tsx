import type { ReactNode } from "react";
import { type WordToken } from "@/lib/wordDiff";
import { cn } from "@/lib/utils";

/** Render the visible content of a single diff line. */
function LineContent({
  content,
  showWhitespace,
  tokens,
}: {
  content: string;
  showWhitespace: boolean;
  tokens?: WordToken[];
}) {
  // Strip the trailing newline that git2 includes in line content.
  const text = content.replace(/\r?\n$/, "");

  if (tokens && tokens.length > 0) {
    return (
      <span>
        {tokens.map((t, i) => (
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
  }
  return <span>{showWhitespace ? renderWhitespace(text) : text}</span>;
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
  tokens,
  showWhitespace,
}: {
  origin: " " | "+" | "-" | null;
  lineno: number | null;
  content: string;
  tokens?: WordToken[];
  showWhitespace: boolean;
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

  return (
    <div
      className={cn("grid items-start font-mono leading-[18px]", bg)}
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
        <LineContent content={content} showWhitespace={showWhitespace} tokens={tokens} />
      </span>
    </div>
  );
}
