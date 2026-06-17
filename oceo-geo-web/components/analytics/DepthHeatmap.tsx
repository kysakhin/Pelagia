"use client";

import { useState, useMemo, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import type { Profile, OnContextChange } from "./types";
import { buildHeatmapGrid, lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

type Variable = "temperature" | "salinity";

export default function DepthHeatmap({
  profiles,
  onContextChange,
}: {
  profiles: Profile[];
  onContextChange?: OnContextChange;
}) {
  const [variable, setVariable] = useState<Variable>("temperature");

  const { data, xLabels, yLabels, min, max } = useMemo(
    () => buildHeatmapGrid(profiles, variable, 60),
    [profiles, variable]
  );

  useEffect(() => {
    if (!onContextChange) return;
    const unit = variable === "temperature" ? "°C" : "PSU";
    const values = data.map((d) => d[2]);
    if (values.length === 0) return;
    const dMin = Math.min(...values);
    const dMax = Math.max(...values);
    const dMean = values.reduce((s, v) => s + v, 0) / values.length;
    onContextChange([{
      variable: variable === "temperature" ? "temperature" : "salinity",
      min: Number(dMin.toFixed(3)),
      max: Number(dMax.toFixed(3)),
      mean: Number(dMean.toFixed(3)),
      unit,
    }]);
  }, [data, variable, onContextChange]);

  if (data.length === 0) return <p className="text-[#7A8A9A]">No data available for heatmap.</p>;

  const option = {
    backgroundColor: "transparent",
    title: {
      text: `${variable === "temperature" ? "Temperature" : "Salinity"} vs Depth over Time`,
      ...lightTitle,
    },
    tooltip: {
      ...lightTooltip,
      formatter: (p: any) =>
        `Time: ${xLabels[p.value[0]]}<br/>Depth: ${yLabels[p.value[1]]} dbar<br/>${
          variable === "temperature" ? "Temp" : "Sal"
        }: ${p.value[2]?.toFixed(2) ?? "N/A"} ${variable === "temperature" ? "\u00b0C" : "PSU"}`,
    },
    grid: { left: "10%", right: "14%", top: "12%", bottom: "12%" },
    xAxis: { type: "category" as const, data: xLabels, ...lightAxis, name: "Time" },
    yAxis: { type: "category" as const, data: yLabels, inverse: true, ...lightAxis, name: "Depth (dbar)" },
    visualMap: {
      min,
      max,
      calculable: true,
      orient: "vertical" as const,
      right: 0,
      top: "center",
      inRange: {
        color:
          variable === "temperature"
            ? ["#313695", "#4575b4", "#74add1", "#abd9e9", "#fee090", "#fdae61", "#f46d43", "#d73027"]
            : ["#f7fcf0", "#e0f3db", "#ccebc5", "#a8ddb5", "#7bccc4", "#4eb3d3", "#2b8cbe", "#08589e"],
      },
      textStyle: { color: "#7A8A9A" },
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
      <div className="rounded-xl p-2 h-[550px]">
        <ReactECharts option={option} lazyUpdate style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}
