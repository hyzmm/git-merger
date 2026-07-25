import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
      <NativeSelect
        size="sm"
        value={branch ?? ""}
        onChange={(e) => onBranchChange(e.target.value || null)}
      >
        <NativeSelectOption value="">All Branches</NativeSelectOption>
        {branches.map((b) => (
          <NativeSelectOption key={b} value={b}>
            {b}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      {/* Author selector */}
      <NativeSelect
        size="sm"
        value={author ?? ""}
        onChange={(e) => onAuthorChange(e.target.value || null)}
      >
        <NativeSelectOption value="">All Authors</NativeSelectOption>
        {uniqueAuthors.map((a) => (
          <NativeSelectOption
            key={mergeByName ? a.name.toLowerCase() : a.email}
            value={mergeByName ? a.name.toLowerCase() : a.email}
          >
            {a.name || a.email}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
