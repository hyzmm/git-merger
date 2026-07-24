import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      <Select
        value={branch ?? ""}
        onValueChange={(v) => onBranchChange(v || null)}
      >
        <SelectTrigger className="h-7 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All Branches</SelectItem>
          {branches.map((b) => (
            <SelectItem key={b} value={b}>
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Author selector */}
      <Select
        value={author ?? ""}
        onValueChange={(v) => onAuthorChange(v || null)}
      >
        <SelectTrigger className="h-7 max-w-44 px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All Authors</SelectItem>
          {uniqueAuthors.map((a) => (
            <SelectItem
              key={mergeByName ? a.name.toLowerCase() : a.email}
              value={mergeByName ? a.name.toLowerCase() : a.email}
            >
              {a.name || a.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
