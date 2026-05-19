import { useMemo } from "react";
import { useApp } from "@/stores/app";
import { DiffLineCell } from "./DiffPrimitives";
import { pairLines } from "@/lib/pairLines";
import { cn } from "@/lib/utils";

export function SideBySide() {
  const fileDiff = useApp((s) => s.diff.fileDiff);
  const showWhitespace = useApp((s) => s.diff.showWhitespace);

  const hunks = useMemo(() => {
    if (!fileDiff) return [];
    return fileDiff.hunks.map((h) => ({
      header: h.header,
      pairs: pairLines(h.lines),
    }));
  }, [fileDiff]);

  if (!fileDiff) return null;
  if (fileDiff.is_binary) {
    return <div className="p-4 text-xs text-muted-foreground">Binary file — no preview.</div>;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-2 overflow-auto bg-background text-[12px]">
      <div className="min-w-0 border-r border-border">
        {hunks.map((h, hi) => (
          <div key={hi}>
            <HunkHeader text={h.header} />
            {h.pairs.map((p, i) => (
              <DiffLineCell
                key={`L${hi}-${i}`}
                origin={p.oldOrigin}
                lineno={p.oldLineno}
                content={p.oldContent}
                tokens={p.leftTokens}
                showWhitespace={showWhitespace}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="min-w-0">
        {hunks.map((h, hi) => (
          <div key={hi}>
            <HunkHeader text={h.header} />
            {h.pairs.map((p, i) => (
              <DiffLineCell
                key={`R${hi}-${i}`}
                origin={p.newOrigin}
                lineno={p.newLineno}
                content={p.newContent}
                tokens={p.rightTokens}
                showWhitespace={showWhitespace}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Unified() {
  const fileDiff = useApp((s) => s.diff.fileDiff);
  const showWhitespace = useApp((s) => s.diff.showWhitespace);

  if (!fileDiff) return null;
  if (fileDiff.is_binary) {
    return <div className="p-4 text-xs text-muted-foreground">Binary file — no preview.</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-auto bg-background text-[12px]">
      {fileDiff.hunks.map((h, hi) => (
        <div key={hi}>
          <HunkHeader text={h.header} />
          {h.lines.map((ln, i) => (
            <DiffLineCell
              key={`U${hi}-${i}`}
              origin={ln.origin}
              lineno={ln.origin === "-" ? ln.old_lineno : ln.new_lineno}
              content={ln.content}
              showWhitespace={showWhitespace}
            />
          ))}
        </div>
      ))}
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
