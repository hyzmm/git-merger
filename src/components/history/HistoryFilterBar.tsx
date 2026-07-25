import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemo, useState } from "react";
import { Filter, X, GitBranch, Eye, EyeOff } from "lucide-react";
import { useApp } from "@/stores/app";
import { useSettings, type GraphMode } from "@/stores/settings";
import { Button } from "@/components/ui/button";

/** Filter chip-style row that sits in the CommitList toolbar.
 *  Hosts: text filter, author dropdown, date range, pathspec. */
export function HistoryFilterBar() {
  const filter = useApp((s) => s.history.filter);
  const author = useApp((s) => s.history.authorFilter);
  const since = useApp((s) => s.history.sinceFilter);
  const until = useApp((s) => s.history.untilFilter);
  const pathspec = useApp((s) => s.history.pathspec);
  const commits = useApp((s) => s.history.commits);

  const setFilter = useApp((s) => s.setFilter);
  const setAuthor = useApp((s) => s.setAuthorFilter);
  const setDateRange = useApp((s) => s.setDateRange);
  const setPathspec = useApp((s) => s.setPathspec);
  const resetFilters = useApp((s) => s.resetHistoryFilters);

  // v0.13.6 — Graph display mode (normal / compact / hidden). Cycle on
  // each click of the graph button so dense-fork repos can collapse the
  // lane chart without diving into Settings.
  const graphMode = useSettings((s) => s.graphMode);
  const setSettings = useSettings((s) => s.set);
  const cycleGraphMode = () => {
    const order: GraphMode[] = ["normal", "compact", "hidden"];
    const next = order[(order.indexOf(graphMode) + 1) % order.length];
    setSettings({ graphMode: next });
  };
  const graphLabel = (m: GraphMode) =>
    m === "normal" ? "Graph: full" : m === "compact" ? "Graph: compact" : "Graph: hidden";
  const GraphIcon = graphMode === "hidden" ? EyeOff : graphMode === "compact" ? Eye : GitBranch;

  // Distinct authors, sorted by frequency desc then name.
  const authorList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of commits) {
      counts.set(c.author_name, (counts.get(c.author_name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
  }, [commits]);

  const [advOpen, setAdvOpen] = useState(false);
  // Local pathspec input – we only push to the store on Enter / blur to avoid
  // re-running the backend log on every keystroke.
  const [pathInput, setPathInput] = useState(pathspec);
  // Date inputs are local strings (yyyy-mm-dd) and pushed on change.
  const [sinceInput, setSinceInput] = useState<string>(unixToYmd(since));
  const [untilInput, setUntilInput] = useState<string>(unixToYmd(until));

  const hasAnyFilter =
    !!filter || !!author || since !== null || until !== null || !!pathspec.trim();

  const commitPath = () => {
    const next = pathInput.trim();
    if (next === pathspec) return;
    setPathspec(next);
  };

  const onSinceChange = (v: string) => {
    setSinceInput(v);
    setDateRange(ymdToUnix(v, false), until);
  };
  const onUntilChange = (v: string) => {
    setUntilInput(v);
    // Until is exclusive — bump to end-of-day so the user's last day is included.
    setDateRange(since, ymdToUnix(v, true));
  };

  return (
    <div className="flex flex-col gap-1.5 border-b border-border bg-card px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter commits (message, author, oid, ref)..."
          className="h-7 flex-1 text-xs"
        />
        <Button
          variant={advOpen ? "default" : "outline"}
          size="sm"
          onClick={() => setAdvOpen((v) => !v)}
          title="Advanced filters: author, date range, path"
        >
          <Filter className="h-3 w-3" />
          More
        </Button>
        <Button
          variant={graphMode !== "normal" ? "default" : "outline"}
          size="sm"
          onClick={cycleGraphMode}
          title={`${graphLabel(graphMode)} — click to cycle (full → compact → hidden)`}
        >
          <GraphIcon className="h-3 w-3" />
          {graphMode === "normal" ? "Full" : graphMode === "compact" ? "Compact" : "Hidden"}
        </Button>
        {hasAnyFilter && (
          <Button
            variant="secondary"
            size="sm"
            onClick={resetFilters}
            title="Clear all filters"
          >
            <X className="h-3 w-3" />
            Reset
          </Button>
        )}
      </div>

      {advOpen && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Label>Author</Label>
          <Select value={author ?? ""} onValueChange={(v) => setAuthor(v || null)}>
            <SelectTrigger className="h-7 min-w-[160px] px-1.5 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All authors</SelectItem>
              {authorList.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label>From</Label>
          <Input
            type="date"
            value={sinceInput}
            onChange={(e) => onSinceChange(e.target.value)}
            className="h-7 text-xs"
          />
          <Label>To</Label>
          <Input
            type="date"
            value={untilInput}
            onChange={(e) => onUntilChange(e.target.value)}
            className="h-7 text-xs"
          />

          <Label>Path</Label>
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onBlur={commitPath}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitPath();
              if (e.key === "Escape") {
                setPathInput(pathspec);
              }
            }}
            placeholder="src/git/  ·  README.md"
            title="Only show commits that touch this path (file or directory). Press Enter to apply."
            className="h-7 w-56 font-mono text-xs"
          />
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground">{children}</span>
  );
}

function unixToYmd(t: number | null): string {
  if (t === null) return "";
  const d = new Date(t * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdToUnix(s: string, endOfDay: boolean): number | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return Math.floor(date.getTime() / 1000);
}
