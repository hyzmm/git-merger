import { useMemo } from "react";
import { useECharts } from "@/lib/useECharts";
import type { TimelinePoint } from "@/ipc/git";
import type { EChartsCoreOption } from "echarts/core";

export function CommitTrendChart({ data }: { data: TimelinePoint[] }) {
  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!data.length) return null;
    return {
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 600,
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15,15,15,0.9)",
        borderColor: "rgba(255,255,255,0.08)",
        textStyle: { color: "#e5e5e5", fontSize: 12 },
        axisPointer: { type: "cross", crossStyle: { color: "#555" } },
      },
      grid: { left: 46, right: 16, top: 24, bottom: 28 },
      xAxis: {
        type: "category",
        data: data.map((d) => d.period),
        axisLabel: { color: "#888", fontSize: 10 },
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
          type: "line",
          data: data.map((d) => d.commits),
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#60a5fa", width: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(96,165,250,0.35)" },
                { offset: 1, color: "rgba(96,165,250,0)" },
              ],
            },
          },
        },
      ],
    };
  }, [data]);

  const ref = useECharts(option);
  return <div ref={ref} className="h-full w-full" />;
}
