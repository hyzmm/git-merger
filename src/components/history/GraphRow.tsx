import { memo, type ReactElement } from "react";
import type { RowLayout } from "@/lib/graph";

// Resolve to literal HSL strings so SVG `stroke=` works in all WebViews.
// Keep these in sync with --branch-* tokens in src/styles/globals.css.
const BRANCH_COLORS = [
  "hsl(199 89% 60%)", // branch-1 (cyan/blue)
  "hsl(280 70% 70%)", // branch-2 (purple)
  "hsl(40 95% 60%)", // branch-3 (yellow/gold)
  "hsl(142 70% 55%)", // branch-4 (green)
  "hsl(0 75% 65%)", // branch-5 (red)
  "hsl(170 70% 60%)", // branch-6 (teal — extra fallback)
];

function colorOf(idx: number): string {
  return BRANCH_COLORS[idx % BRANCH_COLORS.length] ?? BRANCH_COLORS[0];
}

const COL_W = 14;
const ROW_H = 28;
const DOT_R = 4.5;

interface Props {
  row: RowLayout;
  cols?: number;
  height?: number;
}

/**
 * Render one row of the commit graph in an SVG of fixed height = ROW_H.
 * Lines from the previous row come in at the top center; lines to the next
 * row go out at the bottom center.
 */
export const GraphRow = memo(function GraphRow({ row, cols, height = ROW_H }: Props) {
  const totalCols = Math.max(cols ?? row.width, row.width, 1);
  const width = totalCols * COL_W;
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
        stroke={colorOf(seg.color)}
        strokeWidth={2}
      />,
    );
  }

  // 2) Upper half of the dot column: visually continues the line from the
  // previous row down to the dot.
  const dotX = xOf(row.dotCol);
  elements.push(
    <line
      key="dot-up"
      x1={dotX}
      y1={top}
      x2={dotX}
      y2={mid}
      stroke={colorOf(row.dotColor)}
      strokeWidth={2}
    />,
  );

  // 3) Lower half: one segment per parent curve.
  for (const c of row.curves) {
    const x1 = xOf(c.fromCol);
    const x2 = xOf(c.toCol);
    const stroke = colorOf(c.color);
    if (c.kind === "straight" || x1 === x2) {
      elements.push(
        <line
          key={`curve-${c.toCol}`}
          x1={x2}
          y1={mid}
          x2={x2}
          y2={bot}
          stroke={stroke}
          strokeWidth={2}
        />,
      );
    } else {
      elements.push(
        <path
          key={`curve-${c.fromCol}-${c.toCol}`}
          d={`M ${x1} ${mid} C ${x1} ${(mid + bot) / 2}, ${x2} ${(mid + bot) / 2}, ${x2} ${bot}`}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
        />,
      );
    }
  }

  // 4) The dot.
  elements.push(
    <circle
      key="dot"
      cx={dotX}
      cy={mid}
      r={DOT_R}
      fill={colorOf(row.dotColor)}
      stroke="hsl(220 13% 9%)"
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
