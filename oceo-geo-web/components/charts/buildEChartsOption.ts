// Pure functions that convert a validated ChartPayload into an ECharts option
// object. Each builder reads `spec.encoding.x` / `.y` / `.z` / `.color` /
// `.series` and the corresponding `labels` / `options`.
//
// These are intentionally pure (no React, no side effects) so they are trivial
// to unit-test in isolation.
//
// See implementation_plan.md §4.1 and §4.3.
//   Phase 3 chart types: scatter, line, bar, histogram
//   Phase 5 chart types: heatmap, pie, area, boxplot (stubs included below
//   so ChartRenderer can route them, but they throw with a clear message until
//   implemented — the error boundary will catch and render a graceful fallback).

import type { ChartEncoding, ChartPayload, ChartSpec } from "@/types";

// ── Shared helpers ──────────────────────────────────────────────────────────

interface BuildContext {
  spec: ChartSpec;
  data: Record<string, unknown>[];
}

function pick(ctx: BuildContext, field: keyof ChartEncoding): {
  key: string;
  label: string;
} | null {
  const key = ctx.spec.encoding[field];
  if (!key) return null;
  // labels may not have an entry for every encoding field (e.g. `series`),
  // so fall back to the key name when the label is absent.
  const label = (ctx.spec.labels as Record<string, string | undefined> | undefined)?.[field] ?? key;
  return { key, label };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toCategory(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function toTime(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const t = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

function getXAxisKind(rows: Record<string, unknown>[], key: string): "value" | "time" | "category" {
  const values = rows
    .map((row) => row[key])
    .filter((value) => value !== null && value !== undefined && value !== "");

  if (values.length === 0) return "value";
  if (values.every((value) => toNumber(value) !== null)) return "value";
  if (values.every((value) => toTime(value) !== null)) return "time";
  return "category";
}

function toXAxisValue(value: unknown, kind: "value" | "time" | "category"): number | string | null {
  if (kind === "value") return toNumber(value);
  if (kind === "time") return toTime(value);
  return toCategory(value);
}

function uniqueCategories(rows: Record<string, unknown>[], key: string): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => toCategory(row[key]))
        .filter((value): value is string => value !== null)
    )
  );
}

const COMMON_STYLE = {
  textStyle: {
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
    color: "#3D4A58",
  },
  grid: {
    left: "8%",
    right: "8%",
    bottom: "12%",
    top: "15%",
    containLabel: true,
  },
  tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
};

function baseTitle(spec: ChartSpec) {
  return {
    text: spec.title,
    left: "center",
    textStyle: {
      fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
      fontSize: 16,
      fontWeight: "normal",
      color: "#1A1F26",
    },
  };
}

// ── Builders ────────────────────────────────────────────────────────────────

export function buildScatter(ctx: BuildContext): Record<string, unknown> {
  const x = pick(ctx, "x");
  const y = pick(ctx, "y");
  if (!x || !y) throw new Error("Scatter chart requires encoding.x and encoding.y");

  const seriesField = pick(ctx, "series");
  const xAxisKind = getXAxisKind(ctx.data, x.key);

  // If a `series` field is set, split the data into one series per unique
  // value of that field (e.g. one line per cycle_number). Otherwise a single
  // series holds everything.
  const buildSeriesData = (rows: Record<string, unknown>[]) =>
    rows
      .map((row) => {
        const xv = toXAxisValue(row[x.key], xAxisKind);
        const yv = toNumber(row[y.key]);
        if (xv === null || yv === null) return null;
        return [xv, yv];
      })
      .filter((p): p is [number | string, number] => p !== null);

  let series: Record<string, unknown>[];
  if (seriesField) {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of ctx.data) {
      const g = toString(row[seriesField.key]);
      const arr = groups.get(g) ?? [];
      arr.push(row);
      groups.set(g, arr);
    }
    series = Array.from(groups.entries()).map(([name, rows]) => ({
      name,
      type: "scatter",
      symbolSize: 5,
      data: buildSeriesData(rows),
    })).filter((s) => (s.data as unknown[]).length > 0);
  } else {
    series = [
      {
        type: "scatter",
        symbolSize: 5,
        data: buildSeriesData(ctx.data),
        itemStyle: { color: "#4A87BE" },
      },
    ];
  }

  return {
    ...COMMON_STYLE,
    title: baseTitle(ctx.spec),
    xAxis: {
      type: xAxisKind,
      name: x.label,
      nameLocation: "middle",
      nameGap: 30,
      scale: true,
      data: xAxisKind === "category" ? uniqueCategories(ctx.data, x.key) : undefined,
      inverse: ctx.spec.options?.invert_x ?? false,
      splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: y.label,
      nameLocation: "middle",
      nameGap: 40,
      scale: true,
      inverse: ctx.spec.options?.invert_y ?? false,
      splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } },
    },
    series,
    legend: ctx.spec.options?.show_legend && seriesField
      ? { bottom: 0, type: "scroll" }
      : undefined,
  };
}

export function buildLine(ctx: BuildContext): Record<string, unknown> {
  const x = pick(ctx, "x");
  const y = pick(ctx, "y");
  if (!x || !y) throw new Error("Line chart requires encoding.x and encoding.y");

  const seriesField = pick(ctx, "series");
  const xAxisKind = getXAxisKind(ctx.data, x.key);

  // For line charts, sort by the x value so the line renders correctly.
  const sorted = [...ctx.data].sort((a, b) => {
    const av = toXAxisValue(a[x.key], xAxisKind);
    const bv = toXAxisValue(b[x.key], xAxisKind);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv));
    }
    return av - bv;
  });

  const buildSeriesData = (rows: Record<string, unknown>[]) =>
    rows
      .map((row) => {
        const xv = toXAxisValue(row[x.key], xAxisKind);
        const yv = toNumber(row[y.key]);
        if (xv === null || yv === null) return null;
        return [xv, yv];
      })
      .filter((p): p is [number | string, number] => p !== null);

  let series: Record<string, unknown>[];
  if (seriesField) {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of sorted) {
      const g = toString(row[seriesField.key]);
      const arr = groups.get(g) ?? [];
      arr.push(row);
      groups.set(g, arr);
    }
    series = Array.from(groups.entries()).map(([name, rows]) => ({
      name,
      type: "line",
      smooth: false,
      symbol: "circle",
      symbolSize: 4,
      data: buildSeriesData(rows),
    })).filter((s) => (s.data as unknown[]).length > 0);
  } else {
    series = [
      {
        type: "line",
        smooth: false,
        symbol: "circle",
        symbolSize: 4,
        data: buildSeriesData(sorted),
        itemStyle: { color: "#4A87BE" },
      },
    ];
  }

  return {
    ...COMMON_STYLE,
    title: baseTitle(ctx.spec),
    xAxis: {
      type: xAxisKind,
      name: x.label,
      nameLocation: "middle",
      nameGap: 30,
      scale: true,
      data: xAxisKind === "category" ? uniqueCategories(sorted, x.key) : undefined,
      inverse: ctx.spec.options?.invert_x ?? false,
      splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: y.label,
      nameLocation: "middle",
      nameGap: 40,
      scale: true,
      inverse: ctx.spec.options?.invert_y ?? false,
      splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } },
    },
    series,
    legend: ctx.spec.options?.show_legend && seriesField
      ? { bottom: 0, type: "scroll" }
      : undefined,
  };
}

export function buildBar(ctx: BuildContext): Record<string, unknown> {
  const x = pick(ctx, "x");
  const y = pick(ctx, "y");
  if (!x || !y) throw new Error("Bar chart requires encoding.x and encoding.y");

  // For bar charts, x is typically categorical. We keep the order of the
  // incoming rows (the SQL query's natural order) rather than sorting.
  const rows = ctx.data.filter(
    (row) => toCategory(row[x.key]) !== null && toNumber(row[y.key]) !== null
  );
  const labels = rows.map((row) => toString(row[x.key]));
  const values = rows.map((row) => toNumber(row[y.key]));

  return {
    ...COMMON_STYLE,
    title: baseTitle(ctx.spec),
    xAxis: {
      type: "category",
      name: x.label,
      nameLocation: "middle",
      nameGap: 30,
      data: labels,
      axisLabel: { color: "#3D4A58" },
      inverse: ctx.spec.options?.invert_x ?? false,
    },
    yAxis: {
      type: "value",
      name: y.label,
      nameLocation: "middle",
      nameGap: 40,
      inverse: ctx.spec.options?.invert_y ?? false,
      splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: values,
        itemStyle: { color: "#4A87BE" },
      },
    ],
  };
}

export function buildHistogram(ctx: BuildContext): Record<string, unknown> {
  const x = pick(ctx, "x");
  if (!x) throw new Error("Histogram requires encoding.x");

  const values = ctx.data
    .map((row) => toNumber(row[x.key]))
    .filter((v): v is number => v !== null);

  if (values.length === 0) {
    throw new Error(`No numeric values found for column '${x.key}'`);
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const binCount = ctx.spec.options?.bin_count ?? 20;
  const range = max - min || 1;
  const binWidth = range / binCount;

  // Build bins: [min, min+w), [min+w, min+2w), ..., [max-w, max]
  const counts = new Array(binCount).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1; // include max in the last bin
    if (idx < 0) idx = 0;
    counts[idx]++;
  }

  const labels = Array.from({ length: binCount }, (_, i) => {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;
    return `${lo.toFixed(2)}–${hi.toFixed(2)}`;
  });

  return {
    ...COMMON_STYLE,
    title: baseTitle(ctx.spec),
    xAxis: {
      type: "category",
      name: x.label,
      nameLocation: "middle",
      nameGap: 30,
      data: labels,
      axisLabel: { color: "#3D4A58", rotate: 30 },
    },
    yAxis: {
      type: "value",
      name: "Count",
      nameLocation: "middle",
      nameGap: 40,
      splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: counts,
        itemStyle: { color: "#5C7A96" },
      },
    ],
  };
}

// ── Phase 5 stubs (heatmap, pie, area, boxplot) ─────────────────────────────
// These are routed by ChartRenderer but not yet implemented. They throw so
// the error boundary renders a graceful "chart not yet supported" message
// instead of silently rendering nothing. Phase 5 will fill them in.

export function buildHeatmap(_ctx: BuildContext): Record<string, unknown> {
  void _ctx;
  throw new Error("Heatmap charts are not yet implemented (planned for Phase 5).");
}

export function buildPie(ctx: BuildContext): Record<string, unknown> {
  const color = pick(ctx, "color");
  const y = pick(ctx, "y");
  if (!color || !y) {
    throw new Error("Pie chart requires encoding.color (category) and encoding.y (value)");
  }

  const data = ctx.data
    .map((row) => ({
      name: toString(row[color.key]),
      value: toNumber(row[y.key]),
    }))
    .filter((d) => d.value !== null);

  return {
    ...COMMON_STYLE,
    title: baseTitle(ctx.spec),
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: "55%",
        center: ["50%", "50%"],
        data,
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
      },
    ],
  };
}

export function buildArea(ctx: BuildContext): Record<string, unknown> {
  // Area is a line chart with `areaStyle` set. Reuse buildLine and decorate.
  const lineOpt = buildLine(ctx);
  const series = lineOpt.series as Record<string, unknown>[];
  for (const s of series) {
    s.areaStyle = { opacity: 0.2 };
  }
  return lineOpt;
}

export function buildBoxplot(_ctx: BuildContext): Record<string, unknown> {
  void _ctx;
  throw new Error("Boxplot charts are not yet implemented (planned for Phase 5).");
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export function buildEChartsOption(
  payload: ChartPayload
): Record<string, unknown> {
  const ctx: BuildContext = { spec: payload.spec, data: payload.data };
  switch (payload.spec.chart_type) {
    case "scatter":
      return buildScatter(ctx);
    case "line":
      return buildLine(ctx);
    case "bar":
      return buildBar(ctx);
    case "histogram":
      return buildHistogram(ctx);
    case "heatmap":
      return buildHeatmap(ctx);
    case "pie":
      return buildPie(ctx);
    case "area":
      return buildArea(ctx);
    case "boxplot":
      return buildBoxplot(ctx);
    default:
      throw new Error(
        `Unknown chart_type: ${(payload.spec as { chart_type: string }).chart_type}`
      );
  }
}
