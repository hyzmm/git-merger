import { useMemo } from "react";
import { useECharts } from "@/lib/useECharts";
import type { BranchStats } from "@/ipc/git";
import type { EChartsCoreOption } from "echarts/core";

export function BranchChart({ data }: { data: BranchStats[] }) {
  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!data.length) return null;
    const top = data.slice(0, 10);
    const names = top.map((b) => b.name);
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
      grid: { left: 110, right: 24, top: 12, bottom: 12 },
      xAxis: {
        type: "value",
        axisLabel: { color: "#888", fontSize: 10 },
        splitLine: { lineStyle: { color: "#222" } },
      },
      yAxis: {
        type: "category",
        data: [...names].reverse(),
        axisLabel: {
          color: "#ccc",
          fontSize: 11,
          width: 98,
          overflow: "truncate",
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: [...top].reverse().map((b) => b.commits),
          barWidth: 14,
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: "#0891b2" },
                { offset: 1, color: "#22d3ee" },
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
