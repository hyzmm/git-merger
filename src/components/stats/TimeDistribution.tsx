import { useMemo, useState } from "react";
import { useECharts } from "@/lib/useECharts";
import type { EChartsCoreOption } from "echarts/core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${i}:00`);

interface Props {
  hourDist: number[];
  weekdayDist: number[];
}

export function TimeDistribution({ hourDist, weekdayDist }: Props) {
  const [mode, setMode] = useState<"hour" | "weekday">("hour");

  const option = useMemo<EChartsCoreOption | null>(() => {
    const isHour = mode === "hour";
    const labels = isHour ? HOURS : WEEKDAYS;
    const values = isHour ? hourDist : weekdayDist;
    if (!values.length) return null;

    const maxVal = Math.max(...values, 1);

    return {
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 600,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(15,15,15,0.9)",
        borderColor: "rgba(255,255,255,0.08)",
        textStyle: { color: "#e5e5e5", fontSize: 12 },
      },
      grid: { left: 40, right: 12, top: 12, bottom: 24 },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: {
          color: "#888",
          fontSize: 9,
          interval: isHour ? 2 : 0,
        },
        axisLine: { lineStyle: { color: "#333" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#888", fontSize: 10 },
        splitLine: { lineStyle: { color: "#222" } },
      },
      series: [
        {
          type: "bar",
          data: values.map((v) => ({
            value: v,
            itemStyle: {
              color:
                v === maxVal
                  ? {
                      type: "linear",
                      x: 0,
                      y: 0,
                      x2: 0,
                      y2: 1,
                      colorStops: [
                        { offset: 0, color: "#fbbf24" },
                        { offset: 1, color: "#f59e0b" },
                      ],
                    }
                  : {
                      type: "linear",
                      x: 0,
                      y: 0,
                      x2: 0,
                      y2: 1,
                      colorStops: [
                        { offset: 0, color: "#6366f1" },
                        { offset: 1, color: "#4f46e5" },
                      ],
                    },
            },
          })),
          barWidth: isHour ? "60%" : "50%",
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [mode, hourDist, weekdayDist]);

  const ref = useECharts(option);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 px-1 pb-1">
        {(["hour", "weekday"] as const).map((m) => (
          <Button
            key={m}
            onClick={() => setMode(m)}
            variant="outline"
            size="sm"
            className={cn(
              mode === m
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "hour" ? "By Hour" : "By Weekday"}
          </Button>
        ))}
      </div>
      <div ref={ref} className="min-h-0 flex-1" />
    </div>
  );
}
