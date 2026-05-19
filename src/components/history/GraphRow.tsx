import { memo, type ReactElement } from "react";
import type { RowLayout } from "@/lib/graph";

const HUE_VARS = [
  "var(--branch-1)",
  "var(--branch-2)",
  "var(--branch-3)",
  "var(--branch-4)",
  "var(--branch-5)",
];

const COL_W = 14;
const ROW_H = 28;
const DOT_R = 4.5;

interface Props {
  row: RowLayout;
  height?: number;
}

/**
 * Render one row of the commit graph in an SVG of fixed height = ROW_H.
 * Lines from the previous row come in at the top center; lines to the next
 * row go out at the bottom center.
 */
export const GraphRow = memo(function GraphRow({ row, height = ROW_H }: Props) {
  const width = Math.max(2, row.width) * COL_W;
  const xOf = (col: number) => col * COL_W + COL_W / 2;
  const top = 0;
  const mid = height / 2;
  const bot = height;

  const elements: ReactElement[] = [];

  // 1) Through (straight) segments — full vertical line spanning the row.
  for (const seg of row.through) {
    const x = xOf(seg.col);
    elements.push(
      <line
        key={`thru-${seg.col}`}
        x1={x}
        y1={top}
        x2={x}
        y2={bot}
        stroke={`hsl(${HUE_VARS[seg.color]})`}
        strokeWidth={2}
      />,
    );
  }

  // 2) Curves: from dot to parents (lower half) and incoming line (upper half).
  // We always draw the *upper* half of the dot column from top to mid using the
  // dot's color so the line is visually continuous from the previous row.
  const dotX = xOf(row.dotCol);
  elements.push(
    <line
      key="dot-up"
      x1={dotX}
      y1={top}
      x2={dotX}
      y2={mid}
      stroke={`hsl(${HUE_VARS[row.dotColor]})`}
      strokeWidth={2}
    />,
  );

  // Lower half: one segment per curve (commit -> parent).
  for (const c of row.curves) {
    const x1 = xOf(c.fromCol);
    const x2 = xOf(c.toCol);
    const color = `hsl(${HUE_VARS[c.color]})`;
    if (c.kind === "straight" || x1 === x2) {
      elements.push(
        <line
          key={`curve-${c.toCol}`}
          x1={x2}
          y1={mid}
          x2={x2}
          y2={bot}
          stroke={color}
          strokeWidth={2}
        />,
      );
    } else {
      // Cubic curve from (x1, mid) to (x2, bot).
      elements.push(
        <path
          key={`curve-${c.fromCol}-${c.toCol}`}
          d={`M ${x1} ${mid} C ${x1} ${(mid + bot) / 2}, ${x2} ${(mid + bot) / 2}, ${x2} ${bot}`}
          fill="none"
          stroke={color}
          strokeWidth={2}
        />,
      );
    }
  }

  // 3) The dot.
  elements.push(
    <circle
      key="dot"
      cx={dotX}
      cy={mid}
      r={DOT_R}
      fill={`hsl(${HUE_VARS[row.dotColor]})`}
      stroke="hsl(var(--background))"
      strokeWidth={2}
    />,
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      style={{ minWidth: width }}
    >
      {elements}
    </svg>
  );
});
