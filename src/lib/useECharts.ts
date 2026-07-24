import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import {
  BarChart,
  HeatmapChart,
  LineChart,
  ScatterChart,
} from "echarts/charts";
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import type { EChartsCoreOption } from "echarts/core";

// Register only what we need — keeps the bundle lean.
echarts.use([
  CanvasRenderer,
  BarChart,
  HeatmapChart,
  LineChart,
  ScatterChart,
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
]);

/**
 * Lightweight React hook wrapping an ECharts instance.
 *
 * - Initialises on mount, disposes on unmount.
 * - Re-applies `option` whenever it changes (shallow ref equality).
 * - Handles container resize via ResizeObserver.
 *
 * Usage:
 * ```tsx
 * const ref = useECharts(option);
 * return <div ref={ref} className="h-64" />;
 * ```
 */
export function useECharts(option: EChartsCoreOption | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Init + dispose
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, "dark", { renderer: "canvas" });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Update option
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !option) return;
    chart.setOption(option, { notMerge: true });
    // Ensure the chart re-measures its container after data/size changes.
    requestAnimationFrame(() => chart.resize());
  }, [option]);

  return containerRef;
}
