import { useState, useCallback, useMemo } from "react";
import { format, startOfMonth, endOfMonth, subMonths, subDays } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface DateRange {
  from: Date;
  to?: Date;
}

interface Props {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}

type Preset = "7d" | "30d" | "thisMonth" | "lastMonth" | "custom";

const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom" },
];

const DATE_FMT = "yyyy-MM-dd";

function computeRange(preset: Preset): DateRange {
  const now = new Date();
  switch (preset) {
    case "7d":
      return { from: subDays(now, 7), to: now };
    case "30d":
      return { from: subDays(now, 30), to: now };
    case "thisMonth":
      return { from: startOfMonth(now), to: now };
    case "lastMonth": {
      const lm = subMonths(now, 1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
    default:
      return { from: subDays(now, 30), to: now };
  }
}

/** Detect which preset best matches the current date range. */
function detectPreset(range: DateRange | undefined): Preset {
  if (!range) return "thisMonth";
  const fmt = (d: Date) => format(d, DATE_FMT);
  const candidates: Preset[] = ["7d", "30d", "thisMonth", "lastMonth"];
  for (const p of candidates) {
    const r = computeRange(p);
    if (fmt(r.from) === fmt(range.from) && (!r.to || !range.to || fmt(r.to) === fmt(range.to))) {
      return p;
    }
  }
  return "custom";
}

export function DateRangePicker({ value, onChange }: Props) {
  const [preset, setPreset] = useState<Preset>(() => detectPreset(value));
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handlePresetChange = useCallback(
    (newPreset: Preset) => {
      setPreset(newPreset);
      if (newPreset !== "custom") {
        onChange(computeRange(newPreset));
      }
    },
    [onChange],
  );

  const handleCalendarSelect = useCallback(
    (range: { from?: Date; to?: Date } | undefined) => {
      if (!range?.from) return;
      const next: DateRange = { from: range.from, to: range.to };
      onChange(next);
      if (range.to) setCalendarOpen(false);
    },
    [onChange],
  );

  const calendarSelected = useMemo(
    () => (value ? { from: value.from, to: value.to } : undefined),
    [value],
  );

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={preset}
        onChange={(e) => handlePresetChange(e.target.value as Preset)}
        className="h-7 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
      >
        {PRESET_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {preset === "custom" && (
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger render={
            <Button variant="outline" size="icon" className="h-7 w-7 shrink-0">
              <CalendarIcon className="h-3.5 w-3.5" />
            </Button>
          } />
          <PopoverContent className="w-auto p-3" align="start">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={calendarSelected}
              onSelect={handleCalendarSelect}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
