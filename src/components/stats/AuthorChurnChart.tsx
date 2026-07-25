import { useMemo, useState } from "react";
import { useECharts } from "@/lib/useECharts";
import { Button } from "@/components/ui/button";
import type { AuthorChurn, AuthorOverview } from "@/ipc/git";
import type { EChartsCoreOption } from "echarts/core";

export function AuthorChurnChart({
  data,
  authors,
  mergeByName,
}: {
  data: AuthorChurn[];
  authors: AuthorOverview[];
  mergeByName?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [stacked, setStacked] = useState(false);

  // Stable key: when merging by name, use lowercase name; otherwise use email.
  const getKey = (a: AuthorChurn) =>
    mergeByName ? a.name.toLowerCase() : a.email;

  // Build key -> display name lookup. Also index by email for backwards compat.
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of authors) {
      m.set(a.email, a.name || a.email.split("@")[0]);
      m.set(a.name.toLowerCase(), a.name || a.email.split("@")[0]);
    }
    for (const a of data) {
      if (!m.has(getKey(a))) {
        m.set(getKey(a), a.name || a.email.split("@")[0]);
      }
    }
    return m;
  }, [authors, data]);

  // Sort all authors by net (insertions - deletions) descending.
  const sorted = useMemo(
    () =>
      [...data].sort(
        (a, b) =>
          b.insertions - b.deletions - (a.insertions - a.deletions),
      ),
    [data],
  );

  // Filter out hidden authors.
  const visible = useMemo(
    () => sorted.filter((a) => !hidden.has(getKey(a))),
    [sorted, hidden],
  );

  const toggle = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Dynamic height: 32px per visible author row, min 160px.
  const chartHeight = Math.max(visible.length * 32, 160);

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!visible.length) return null;

    const names = visible.map(
      (a) => nameMap.get(getKey(a)) ?? a.email.split("@")[0],
    );

    return {
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 400,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(15,15,15,0.92)",
        borderColor: "rgba(255,255,255,0.08)",
        textStyle: { color: "#e5e5e5", fontSize: 12 },
        formatter(params: unknown) {
          const arr = params as Array<{
            axisValue: string;
            seriesName: string;
            value: number | number[];
            marker: string;
          }>;
          if (!arr.length) return "";
          const name = arr[0].axisValue;
          let ins = 0;
          let del = 0;
          for (const p of arr) {
            const v = Array.isArray(p.value) ? p.value[0] : p.value;
            if (p.seriesName === "Insertions") ins = v;
            if (p.seriesName === "Deletions") del = Math.abs(v);
          }
          const net = ins - del;
          const netColor = net >= 0 ? "#4ade80" : "#f87171";
          return [
            `<b>${name}</b>`,
            `<span style="color:#4ade80">+${ins.toLocaleString()}</span> insertions`,
            `<span style="color:#f87171">-${del.toLocaleString()}</span> deletions`,
            `<span style="color:${netColor}">Net: ${net >= 0 ? "+" : ""}${net.toLocaleString()}</span>`,
            `Total: ${(ins + del).toLocaleString()}`,
          ].join("<br/>");
        },
      },
      legend: {
        data: ["Insertions", "Deletions", "Net"],
        top: 0,
        right: 8,
        textStyle: { color: "#aaa", fontSize: 11 },
        itemWidth: 14,
        itemHeight: 8,
      },
      grid: { left: 110, right: 32, top: 28, bottom: 8 },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#888",
          fontSize: 10,
          formatter: (v: number) =>
            Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v),
        },
        splitLine: { lineStyle: { color: "#222" } },
      },
      yAxis: {
        type: "category",
        data: names,
        inverse: true,
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
          name: "Insertions",
          type: "bar",
          stack: "churn",
          data: visible.map((a) => a.insertions),
          barMaxWidth: 16,
          itemStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: "#22c55e" },
                { offset: 1, color: "#4ade80" },
              ],
            },
            borderRadius: [0, 3, 3, 0],
          },
        },
        {
          name: "Deletions",
          type: "bar",
          stack: "churn",
          data: visible.map((a) => (stacked ? a.deletions : -a.deletions)),
          barMaxWidth: 16,
          itemStyle: {
            color: {
              type: "linear",
              x: stacked ? 0 : 1,
              y: 0,
              x2: stacked ? 1 : 0,
              y2: 0,
              colorStops: [
                { offset: 0, color: "#ef4444" },
                { offset: 1, color: "#f87171" },
              ],
            },
            borderRadius: stacked ? [0, 3, 3, 0] : [3, 0, 0, 3],
          },
        },
        {
          name: "Net",
          type: "scatter",
          symbol: "diamond",
          symbolSize: 12,
          // Scatter on category axis requires [xValue, yCategoryIndex] pairs.
          data: visible.map((a, i) => [
            stacked ? a.insertions + a.deletions : a.insertions - a.deletions,
            i,
          ]),
          itemStyle: {
            color: "#facc15",
            borderColor: "#854d0e",
            borderWidth: 1,
          },
          z: 10,
        },
      ],
    };
  }, [visible, nameMap, stacked]);

  const ref = useECharts(option);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Custom per-author toggle chips */}
      <div className="mb-1 flex flex-wrap items-center gap-1 overflow-y-auto px-1 max-h-14">
        {sorted.map((a) => {
          const key = getKey(a);
          const name = nameMap.get(key) ?? a.email.split("@")[0];
          const isHidden = hidden.has(key);
          return (
            <Button
              key={key}
              onClick={() => toggle(key)}
              variant="outline"
              size="xs"
              className={`rounded-full ${
                isHidden
                  ? "border-border/40 text-muted-foreground/40 line-through"
                  : "bg-muted/60"
              }`}
              title={a.email}
            >
              {name}
            </Button>
          );
        })}
        <Button
          onClick={() => setStacked((v) => !v)}
          variant="outline"
          size="xs"
          className={`rounded-full ${
            stacked
              ? "border-primary bg-primary/20 text-primary"
              : "text-muted-foreground"
          }`}
        >
          Stack
        </Button>
      </div>
      {/* Chart area with dynamic height */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={ref} style={{ width: "100%", height: chartHeight, minHeight: 160 }} />
      </div>
    </div>
  );
}
