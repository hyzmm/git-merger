import { DateRangePicker, type DateRange } from "./DateRangePicker";

interface Props {
  dateRange: DateRange | undefined;
  onDateRangeChange: (r: DateRange | undefined) => void;
  branch: string | null;
  onBranchChange: (b: string | null) => void;
  branches: string[];
  author: string | null;
  onAuthorChange: (a: string | null) => void;
  authors: { name: string; email: string }[];
  mergeByName?: boolean;
}

export function StatsFilterBar({
  dateRange,
  onDateRangeChange,
  branch,
  onBranchChange,
  branches,
  author,
  onAuthorChange,
  authors,
  mergeByName,
}: Props) {
  // When merging by name, deduplicate authors by name (case-insensitive).
  const uniqueAuthors = mergeByName
    ? (() => {
        const seen = new Set<string>();
        return authors.filter((a) => {
          const key = a.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })()
    : authors;
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      {/* Date range picker */}
      <DateRangePicker value={dateRange} onChange={onDateRangeChange} />

      {/* Branch selector */}
      <select
        value={branch ?? ""}
        onChange={(e) => onBranchChange(e.target.value || null)}
        className="h-7 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All Branches</option>
        {branches.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>

      {/* Author selector */}
      <select
        value={author ?? ""}
        onChange={(e) => onAuthorChange(e.target.value || null)}
        className="h-7 max-w-44 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All Authors</option>
        {uniqueAuthors.map((a) => (
          <option key={mergeByName ? a.name.toLowerCase() : a.email} value={mergeByName ? a.name.toLowerCase() : a.email}>
            {a.name || a.email}
          </option>
        ))}
      </select>
    </div>
  );
}
