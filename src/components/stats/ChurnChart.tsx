import { useMemo } from "react";
import { useECharts } from "@/lib/useECharts";
import type { ChurnPoint } from "@/ipc/git";
import type { EChartsCoreOption } from "echarts/core";

export function ChurnChart({ data }: { data: ChurnPoint[] }) {
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
      legend: {
        data: ["Insertions", "Deletions"],
        top: 0,
        right: 8,
        textStyle: { color: "#aaa", fontSize: 11 },
        itemWidth: 14,
        itemHeight: 8,
      },
      grid: { left: 50, right: 16, top: 30, bottom: 28 },
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
          name: "Insertions",
          type: "line",
          stack: "churn",
          data: data.map((d) => d.insertions),
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#4ade80", width: 1.5 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(74,222,128,0.3)" },
                { offset: 1, color: "rgba(74,222,128,0)" },
              ],
            },
          },
        },
        {
          name: "Deletions",
          type: "line",
          stack: "churn",
          data: data.map((d) => -d.deletions),
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#f87171", width: 1.5 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(248,113,113,0)" },
                { offset: 1, color: "rgba(248,113,113,0.3)" },
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
