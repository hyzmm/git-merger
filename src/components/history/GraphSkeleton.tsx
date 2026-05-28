/**
 * v0.13.32 — placeholder rendered while the first page of history is
 * loading and `commits.length === 0`. Once the first batch lands the
 * real virtualised list takes over and this component unmounts; we
 * never render skeletons *and* real rows at the same time, so layout
 * thrash is impossible.
 *
 * Visual goals:
 *   - Match the real row's geometry (height, grid columns) so the
 *     transition to populated state isn't a layout jump.
 *   - Subtly animated shimmer on each placeholder bar so the user
 *     can tell the UI is alive vs. wedged on a slow git command.
 *   - One faint coloured dot per row in the graph track to telegraph
 *     "the graph column is here, just waiting" — matches the v0.13.30
 *     dot geometry without any actual layout work.
 *
 * Deliberately NOT animated by JS — pure CSS keyframes ride the
 * compositor and don't fight React renders during the actual load.
 */

import { GRAPH_LANE_WIDTH } from "./GraphRow";

const ROW_HEIGHT = 28;
const PLACEHOLDER_ROWS = 12;

interface Props {
  /** Match CommitList's `gridCols` so columns line up perfectly. */
  gridCols: string;
  /** Pixel width reserved for the graph track in the parent's grid. */
  trackGraphW: number;
  /** Whether the parent is in compact graph mode (smaller dot). */
  compact?: boolean;
  /** Whether the parent has hidden the graph column entirely. */
  hidden?: boolean;
}

export function GraphSkeleton({ gridCols, trackGraphW, compact, hidden }: Props) {
  const laneW = compact ? GRAPH_LANE_WIDTH.compact : GRAPH_LANE_WIDTH.normal;
  const dotR = compact ? 3 : 4.5;
  const dotX = laneW / 2;
  const dotY = ROW_HEIGHT / 2;

  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading history">
      {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
        <div
          key={i}
          className="grid w-full items-center gap-3 border-b border-border/40 px-3 text-[12.5px]"
          style={{ height: ROW_HEIGHT, gridTemplateColumns: gridCols }}
        >
          {!hidden && (
            <svg
              width={trackGraphW}
              height={ROW_HEIGHT}
              viewBox={`0 0 ${trackGraphW} ${ROW_HEIGHT}`}
              className="shrink-0"
              aria-hidden="true"
            >
              {/* Vertical lane line — single hint that "the column is here". */}
              <line
                x1={dotX}
                y1={0}
                x2={dotX}
                y2={ROW_HEIGHT}
                stroke="hsl(var(--muted-foreground) / 0.18)"
                strokeWidth={2}
              />
              <circle cx={dotX} cy={dotY} r={dotR} fill="hsl(var(--muted-foreground) / 0.25)" />
            </svg>
          )}
          {/* Summary placeholder — pseudo-random widths so the column
              doesn't read as a stack of identical bars. */}
          <div
            className="h-2 animate-pulse rounded bg-muted-foreground/15"
            style={{ width: `${55 + ((i * 13) % 35)}%` }}
          />
          {/* Author */}
          <div className="h-2 animate-pulse rounded bg-muted-foreground/12" />
          {/* Time */}
          <div className="h-2 animate-pulse rounded bg-muted-foreground/12" />
          {/* Short oid */}
          <div className="h-2 animate-pulse rounded bg-muted-foreground/12" />
        </div>
      ))}
    </div>
  );
}
