import { describe, it, expect } from "vitest";
import {
  buildScatter,
  buildLine,
  buildBar,
  buildHistogram,
  buildPie,
  buildArea,
  buildHeatmap,
  buildBoxplot,
  buildEChartsOption,
} from "./buildEChartsOption";
import type { ChartPayload, ChartSpec } from "@/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeSpec(
  overrides: Partial<ChartSpec> & { chart_type: ChartSpec["chart_type"] }
): ChartSpec {
  return {
    result_id: "res_test",
    title: "Test Chart",
    encoding: {},
    ...overrides,
  };
}

function makePayload(
  specOverrides: Partial<ChartSpec> & { chart_type: ChartSpec["chart_type"] },
  data: Record<string, unknown>[]
): ChartPayload {
  return { spec: makeSpec(specOverrides), data };
}

const tempVsPressureData = [
  { temperature: 10.0, pressure: 100.0 },
  { temperature: 12.0, pressure: 200.0 },
  { temperature: 15.0, pressure: 300.0 },
  { temperature: 18.0, pressure: 400.0 },
];

const categoricalData = [
  { cycle_number: 1, profile_count: 12 },
  { cycle_number: 2, profile_count: 15 },
  { cycle_number: 3, profile_count: 8 },
];

const distributionData = Array.from({ length: 100 }, (_, i) => ({
  temperature: 5 + (i * 0.2),
}));

// ── Scatter ─────────────────────────────────────────────────────────────────

describe("buildScatter", () => {
  it("produces a valid ECharts scatter option with x/y data pairs", () => {
    const payload = makePayload(
      {
        chart_type: "scatter",
        title: "Temperature vs Pressure",
        encoding: { x: "temperature", y: "pressure" },
        options: { invert_y: true },
      },
      tempVsPressureData
    );

    const opt = buildScatter({ spec: payload.spec, data: payload.data });

    expect(opt.title).toMatchObject({ text: "Temperature vs Pressure" });
    expect(opt.xAxis).toMatchObject({ type: "value", name: "temperature" });
    expect(opt.yAxis).toMatchObject({ type: "value", name: "pressure", inverse: true });

    const series = opt.series as Record<string, unknown>[];
    expect(series).toHaveLength(1);
    expect(series[0].type).toBe("scatter");
    const data = series[0].data as number[][];
    expect(data).toHaveLength(4);
    expect(data[0]).toEqual([10.0, 100.0]);
  });

  it("throws when encoding.x is missing", () => {
    const payload = makePayload(
      { chart_type: "scatter", encoding: { y: "pressure" } },
      tempVsPressureData
    );
    expect(() => buildScatter({ spec: payload.spec, data: payload.data })).toThrow(
      "encoding.x and encoding.y"
    );
  });

  it("splits data into multiple series when encoding.series is set", () => {
    const data = [
      { temperature: 10, pressure: 100, cycle_number: 1 },
      { temperature: 12, pressure: 200, cycle_number: 1 },
      { temperature: 15, pressure: 300, cycle_number: 2 },
      { temperature: 18, pressure: 400, cycle_number: 2 },
    ];
    const payload = makePayload(
      {
        chart_type: "scatter",
        encoding: { x: "temperature", y: "pressure", series: "cycle_number" },
        options: { show_legend: true },
      },
      data
    );

    const opt = buildScatter({ spec: payload.spec, data: payload.data });
    const series = opt.series as Record<string, unknown>[];
    expect(series).toHaveLength(2);
    expect(series[0].name).toBe("1");
    expect(series[1].name).toBe("2");
    expect(opt.legend).toBeDefined();
  });

  it("uses labels when provided", () => {
    const payload = makePayload(
      {
        chart_type: "scatter",
        encoding: { x: "temperature", y: "pressure" },
        labels: { x: "Temperature (°C)", y: "Pressure (dbar)" },
      },
      tempVsPressureData
    );

    const opt = buildScatter({ spec: payload.spec, data: payload.data });
    expect((opt.xAxis as Record<string, unknown>).name).toBe("Temperature (°C)");
    expect((opt.yAxis as Record<string, unknown>).name).toBe("Pressure (dbar)");
  });

  it("filters out rows with null/NaN values", () => {
    const data = [
      { temperature: 10, pressure: 100 },
      { temperature: null, pressure: 200 },
      { temperature: 15, pressure: NaN },
      { temperature: 18, pressure: 400 },
    ];
    const payload = makePayload(
      { chart_type: "scatter", encoding: { x: "temperature", y: "pressure" } },
      data
    );

    const opt = buildScatter({ spec: payload.spec, data: payload.data });
    const series = opt.series as Record<string, unknown>[];
    const points = series[0].data as number[][];
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual([10, 100]);
    expect(points[1]).toEqual([18, 400]);
  });
});

// ── Line ────────────────────────────────────────────────────────────────────

describe("buildLine", () => {
  it("sorts data by x value before rendering", () => {
    const data = [
      { temperature: 18, pressure: 400 },
      { temperature: 10, pressure: 100 },
      { temperature: 15, pressure: 300 },
      { temperature: 12, pressure: 200 },
    ];
    const payload = makePayload(
      { chart_type: "line", encoding: { x: "temperature", y: "pressure" } },
      data
    );

    const opt = buildLine({ spec: payload.spec, data: payload.data });
    const series = opt.series as Record<string, unknown>[];
    const points = series[0].data as number[][];
    // Should be sorted by x (temperature) ascending
    expect(points[0]).toEqual([10, 100]);
    expect(points[3]).toEqual([18, 400]);
  });

  it("throws when encoding.y is missing", () => {
    const payload = makePayload(
      { chart_type: "line", encoding: { x: "temperature" } },
      tempVsPressureData
    );
    expect(() => buildLine({ spec: payload.spec, data: payload.data })).toThrow(
      "encoding.x and encoding.y"
    );
  });
});

// ── Bar ─────────────────────────────────────────────────────────────────────

describe("buildBar", () => {
  it("produces a category x-axis with bar series", () => {
    const payload = makePayload(
      {
        chart_type: "bar",
        title: "Profiles per Cycle",
        encoding: { x: "cycle_number", y: "profile_count" },
      },
      categoricalData
    );

    const opt = buildBar({ spec: payload.spec, data: payload.data });

    expect((opt.xAxis as Record<string, unknown>).type).toBe("category");
    const xData = (opt.xAxis as Record<string, unknown>).data as unknown[];
    expect(xData).toEqual(["1", "2", "3"]); // cycle_number converted to string

    const series = opt.series as Record<string, unknown>[];
    expect(series[0].type).toBe("bar");
    expect(series[0].data).toEqual([12, 15, 8]);
  });

  it("throws when encoding.x is missing", () => {
    const payload = makePayload(
      { chart_type: "bar", encoding: { y: "profile_count" } },
      categoricalData
    );
    expect(() => buildBar({ spec: payload.spec, data: payload.data })).toThrow(
      "encoding.x and encoding.y"
    );
  });
});

// ── Histogram ───────────────────────────────────────────────────────────────

describe("buildHistogram", () => {
  it("bins numeric data into a bar-chart histogram", () => {
    const payload = makePayload(
      {
        chart_type: "histogram",
        title: "Temperature Distribution",
        encoding: { x: "temperature" },
        options: { bin_count: 10 },
      },
      distributionData
    );

    const opt = buildHistogram({ spec: payload.spec, data: payload.data });

    expect((opt.xAxis as Record<string, unknown>).type).toBe("category");
    const xLabels = (opt.xAxis as Record<string, unknown>).data as string[];
    expect(xLabels).toHaveLength(10);

    const series = opt.series as Record<string, unknown>[];
    expect(series[0].type).toBe("bar");
    const counts = series[0].data as number[];
    // Sum of all bin counts should equal the number of data points
    expect(counts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("uses default bin count when not specified", () => {
    const payload = makePayload(
      { chart_type: "histogram", encoding: { x: "temperature" } },
      distributionData
    );

    const opt = buildHistogram({ spec: payload.spec, data: payload.data });
    const xLabels = (opt.xAxis as Record<string, unknown>).data as string[];
    expect(xLabels).toHaveLength(20); // default bin_count
  });

  it("throws when encoding.x is missing", () => {
    const payload = makePayload(
      { chart_type: "histogram", encoding: {} },
      distributionData
    );
    expect(() => buildHistogram({ spec: payload.spec, data: payload.data })).toThrow(
      "encoding.x"
    );
  });

  it("throws when no numeric values are found", () => {
    const payload = makePayload(
      { chart_type: "histogram", encoding: { x: "temperature" } },
      [{ temperature: null }, { temperature: "abc" }]
    );
    expect(() => buildHistogram({ spec: payload.spec, data: payload.data })).toThrow(
      "No numeric values"
    );
  });
});

// ── Pie ─────────────────────────────────────────────────────────────────────

describe("buildPie", () => {
  it("produces a pie series with name/value pairs", () => {
    const data = [
      { file_type: "CORE", count: 5 },
      { file_type: "BGC", count: 3 },
    ];
    const payload = makePayload(
      {
        chart_type: "pie",
        title: "File Types",
        encoding: { color: "file_type", y: "count" },
      },
      data
    );

    const opt = buildPie({ spec: payload.spec, data: payload.data });
    const series = opt.series as Record<string, unknown>[];
    expect(series[0].type).toBe("pie");
    const pieData = series[0].data as { name: string; value: number | null }[];
    expect(pieData).toHaveLength(2);
    expect(pieData[0]).toEqual({ name: "CORE", value: 5 });
    expect(pieData[1]).toEqual({ name: "BGC", value: 3 });
  });

  it("throws when encoding.color is missing", () => {
    const payload = makePayload(
      { chart_type: "pie", encoding: { y: "count" } },
      [{ count: 5 }]
    );
    expect(() => buildPie({ spec: payload.spec, data: payload.data })).toThrow(
      "encoding.color"
    );
  });
});

// ── Area ────────────────────────────────────────────────────────────────────

describe("buildArea", () => {
  it("produces a line chart with areaStyle", () => {
    const payload = makePayload(
      {
        chart_type: "area",
        title: "Temperature Over Time",
        encoding: { x: "temperature", y: "pressure" },
      },
      tempVsPressureData
    );

    const opt = buildArea({ spec: payload.spec, data: payload.data });
    const series = opt.series as Record<string, unknown>[];
    expect(series[0].type).toBe("line");
    expect(series[0].areaStyle).toBeDefined();
    expect((series[0].areaStyle as Record<string, unknown>).opacity).toBe(0.2);
  });
});

// ── Phase 5 stubs ───────────────────────────────────────────────────────────

describe("buildHeatmap (Phase 5 stub)", () => {
  it("throws with a clear not-yet-implemented message", () => {
    const payload = makePayload(
      {
        chart_type: "heatmap",
        encoding: { x: "latitude", y: "longitude", z: "temperature" },
      },
      []
    );
    expect(() => buildHeatmap({ spec: payload.spec, data: payload.data })).toThrow(
      "not yet implemented"
    );
  });
});

describe("buildBoxplot (Phase 5 stub)", () => {
  it("throws with a clear not-yet-implemented message", () => {
    const payload = makePayload(
      { chart_type: "boxplot", encoding: { x: "cycle_number", y: "temperature" } },
      []
    );
    expect(() => buildBoxplot({ spec: payload.spec, data: payload.data })).toThrow(
      "not yet implemented"
    );
  });
});

// ── Dispatcher (buildEChartsOption) ─────────────────────────────────────────

describe("buildEChartsOption", () => {
  it("dispatches to the correct builder based on chart_type", () => {
    const payload = makePayload(
      { chart_type: "scatter", encoding: { x: "temperature", y: "pressure" } },
      tempVsPressureData
    );
    const opt = buildEChartsOption(payload);
    const series = opt.series as Record<string, unknown>[];
    expect(series[0].type).toBe("scatter");
  });

  it("throws for unknown chart_type", () => {
    const payload = makePayload(
      // Force an invalid chart_type via cast
      { chart_type: "violin" as unknown as ChartSpec["chart_type"], encoding: {} },
      []
    );
    expect(() => buildEChartsOption(payload)).toThrow("Unknown chart_type");
  });
});
