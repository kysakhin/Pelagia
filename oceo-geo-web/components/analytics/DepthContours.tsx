"use client";

import { useState, useMemo, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import type { Profile, OnContextChange } from "./types";
import { buildHeatmapGrid, lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

type Variable = "temperature" | "salinity";

export default function DepthContours({
  profiles,
  onContextChange,
}: {
  profiles: Profile[];
  onContextChange?: OnContextChange;
}) {
  const [variable, setVariable] = useState<Variable>("temperature");

  const { data, xLabels, yLabels, min, max } = useMemo(
    () => buildHeatmapGrid(profiles, variable, 80),
    [profiles, variable]
  );

  useEffect(() => {
    if (!onContextChange) return;
    const values = data.map((d) => d[2]);
    if (values.length === 0) return;
    const dMean = values.reduce((s, v) => s + v, 0) / values.length;
    onContextChange([{
      variable: variable === "temperature" ? "temperature" : "salinity",
      min: Number(min.toFixed(3)),
      max: Number(max.toFixed(3)),
      mean: Number(dMean.toFixed(3)),
      unit: variable === "temperature" ? "°C" : "PSU",
    }]);
  }, [data, min, max, variable, onContextChange]);

  if (data.length === 0) return <p className="text-[#7A8A9A]">No data available for contours.</p>;

  const numLevels = 12;
  const step = (max - min) / numLevels;
  const pieces = Array.from({ length: numLevels }, (_, i) => ({
    gte: +(min + i * step).toFixed(2),
    lt: +(min + (i + 1) * step).toFixed(2),
    label: `${(min + i * step).toFixed(1)} -- ${(min + (i + 1) * step).toFixed(1)}`,
  }));

  const contourColors =
    variable === "temperature"
      ? ["#08306b", "#08519c", "#2171b5", "#4292c6", "#6baed6", "#9ecae1", "#fee08b", "#fdae61", "#f46d43", "#d73027", "#a50026", "#67001f"]
      : ["#f7fcfd", "#e5f5f9", "#ccece6", "#99d8c9", "#66c2a4", "#41ae76", "#238b45", "#006d2c", "#00441b", "#003318", "#002211", "#001a0a"];

  const option = {
    backgroundColor: "transparent",
    title: {
      text: `${variable === "temperature" ? "Temperature" : "Salinity"} Depth Contours`,
      ...lightTitle,
    },
    tooltip: {
      ...lightTooltip,
      formatter: (p: any) =>
        `Time: ${xLabels[p.value[0]]}<br/>Depth: ${yLabels[p.value[1]]} dbar<br/>Value: ${p.value[2]?.toFixed(2) ?? "N/A"}`,
    },
    grid: { left: "10%", right: "16%", top: "12%", bottom: "12%" },
    xAxis: { type: "category" as const, data: xLabels, ...lightAxis, name: "Time" },
    yAxis: { type: "category" as const, data: yLabels, inverse: true, ...lightAxis, name: "Depth (dbar)" },
    visualMap: {
      type: "piecewise" as const,
      pieces,
      orient: "vertical" as const,
      right: 0,
      top: "center",
      inRange: { color: contourColors },
      textStyle: { color: "#7A8A9A", fontSize: 10 },
    },
    series: [
      {
        type: "heatmap",
        data,
        emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 1 } },
      },
    ],
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {(["temperature", "salinity"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setVariable(v)}
            className={`px-3 py-1.5 rounded-xs text-xs font-medium transition ${
              variable === v
                ? "bg-[#4A87BE] text-white"
                : "bg-white border-[#C8CDD4] text-[#3D4A58] hover:bg-[#F0F2F4]"
            }`}
          >
            {v === "temperature" ? "Temperature" : "Salinity"}
          </button>
        ))}
      </div>
      <div className="rounded-xl p-2 h-[600px]">
        <ReactECharts option={option} lazyUpdate style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}
