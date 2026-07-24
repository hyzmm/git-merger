import { useMemo } from "react";
import { useECharts } from "@/lib/useECharts";
import type { HeatmapDay } from "@/ipc/git";
import type { EChartsCoreOption } from "echarts/core";

export function HeatmapCalendar({ data }: { data: HeatmapDay[] }) {
  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!data.length) return null;

    // Determine the year range from data.
    const dates = data.map((d) => d.date).sort();
    const startYear = dates[0].slice(0, 4);
    const endYear = dates[dates.length - 1].slice(0, 4);

    // Build calendar ranges for each year present.
    const calendars: unknown[] = [];
    const seriesData = data.map((d) => [d.date, d.count] as [string, number]);

    const years: string[] = [];
    for (let y = Number(startYear); y <= Number(endYear); y++) {
      years.push(String(y));
    }

    years.forEach((year, idx) => {
      calendars.push({
        top: 30 + idx * 140,
        left: 30,
        right: 16,
        cellSize: ["auto", 13],
        range: year,
        itemStyle: { borderWidth: 2, borderColor: "transparent" },
        yearLabel: { show: true, color: "#888", fontSize: 11 },
        monthLabel: { color: "#666", fontSize: 10 },
        dayLabel: { color: "#666", fontSize: 9, firstDay: 1 },
        splitLine: { show: false },
      });
    });

    return {
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 600,
      tooltip: {
        backgroundColor: "rgba(15,15,15,0.9)",
        borderColor: "rgba(255,255,255,0.08)",
        textStyle: { color: "#e5e5e5", fontSize: 12 },
        formatter: (p: { data: [string, number] }) =>
          `${p.data[0]}: <b>${p.data[1]}</b> commits`,
      },
      visualMap: {
        min: 0,
        max: Math.max(10, ...data.map((d) => d.count)),
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { color: "#888", fontSize: 10 },
        inRange: {
          color: ["#1a1a2e", "#16302b", "#1a5c3a", "#2ea043", "#56d364"],
        },
      },
      calendar: calendars,
      series: years.map((_, idx) => ({
        type: "heatmap",
        coordinateSystem: "calendar",
        calendarIndex: idx,
        data: seriesData,
      })),
    } as EChartsCoreOption;
  }, [data]);

  const ref = useECharts(option);
  return <div ref={ref} className="h-full w-full" />;
}
