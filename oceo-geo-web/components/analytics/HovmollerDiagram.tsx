"use client";

import { useState, useMemo, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import type { Profile, OnContextChange } from "./types";
import { linearInterpolate, lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

type Variable = "temperature" | "salinity";
type SpaceAxis = "latitude" | "longitude";

export default function HovmollerDiagram({
  profiles,
  onContextChange,
}: {
  profiles: Profile[];
  onContextChange?: OnContextChange;
}) {
  const [variable, setVariable] = useState<Variable>("temperature");
  const [spaceAxis, setSpaceAxis] = useState<SpaceAxis>("latitude");
  const [selectedDepth, setSelectedDepth] = useState(100);

  // Find global depth range for slider
  const depthRange = useMemo(() => {
    let minD = Infinity,
      maxD = -Infinity;
    for (const p of profiles) {
      for (const m of p.measurements) {
        if (m.pressure < minD) minD = m.pressure;
        if (m.pressure > maxD) maxD = m.pressure;
      }
    }
    return [isFinite(minD) ? Math.floor(minD) : 0, isFinite(maxD) ? Math.ceil(maxD) : 2000];
  }, [profiles]);

  const { option, hasData } = useMemo(() => {
    if (profiles.length < 2) return { option: {}, hasData: false };

    const points: { time: string; space: number; value: number }[] = [];
    for (const p of profiles) {
      const val = linearInterpolate(p.measurements, selectedDepth, variable);
      if (val !== null) {
        points.push({
          time: new Date(p.observed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          space: spaceAxis === "latitude" ? p.latitude : p.longitude,
          value: val,
        });
      }
    }

    if (points.length === 0) return { option: {}, hasData: false };

    const spaceValues = [...new Set(points.map((p) => p.space))].sort((a, b) => a - b);
    const timeValues = [...new Set(points.map((p) => p.time))];

    const data: [number, number, number][] = [];
    let min = Infinity,
      max = -Infinity;

    for (const pt of points) {
      const xi = spaceValues.indexOf(pt.space);
      const yi = timeValues.indexOf(pt.time);
      if (xi >= 0 && yi >= 0) {
        data.push([xi, yi, pt.value]);
        if (pt.value < min) min = pt.value;
        if (pt.value > max) max = pt.value;
      }
    }

    return {
      hasData: data.length > 0,
      option: {
        backgroundColor: "transparent",
        title: {
          text: `Hovmoller: ${variable === "temperature" ? "Temp" : "Sal"} at ${selectedDepth} dbar`,
          ...lightTitle,
        },
        tooltip: {
          ...lightTooltip,
          formatter: (p: any) =>
            `${spaceAxis}: ${spaceValues[p.value[0]]?.toFixed(2)}\u00b0<br/>Time: ${timeValues[p.value[1]]}<br/>Value: ${p.value[2]?.toFixed(2)}`,
        },
        grid: { left: "10%", right: "14%", top: "12%", bottom: "12%" },
        xAxis: { 
          type: "category" as const, 
          data: spaceValues.map((s) => s.toFixed(2) + "\u00b0"), 
          ...lightAxis, 
          name: spaceAxis === "latitude" ? "Latitude" : "Longitude",
        },
        yAxis: {
          type: "category" as const,
          data: timeValues,
          ...lightAxis,
          name: "Time",
          inverse: true,
        },
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
                ? ["#313695", "#4575b4", "#74add1", "#fee090", "#fdae61", "#d73027"]
                : ["#f7fcf0", "#ccebc5", "#7bccc4", "#4eb3d3", "#2b8cbe", "#08589e"],
          },
          textStyle: { color: "#7A8A9A" },
        },
        series: [{ type: "heatmap", data }],
      },
    };
  }, [profiles, variable, spaceAxis, selectedDepth]);

  useEffect(() => {
    if (!onContextChange || !hasData) return;
    const raw = (option as any)?.series?.[0]?.data as [number, number, number][] | undefined;
    if (!raw || raw.length === 0) return;
    const vals = raw.map((d) => d[2]);
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);
    const vMean = vals.reduce((s, v) => s + v, 0) / vals.length;
    onContextChange([{
      variable: variable === "temperature" ? "temperature" : "salinity",
      min: Number(vMin.toFixed(3)),
      max: Number(vMax.toFixed(3)),
      mean: Number(vMean.toFixed(3)),
      unit: variable === "temperature" ? "°C" : "PSU",
    }]);
  }, [option, hasData, variable, onContextChange]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex gap-2">
          {(["temperature", "salinity"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVariable(v)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                variable === v
                  ? "bg-[#4A87BE] text-white"
                  : "bg-white border-[#C8CDD4] text-[#3D4A58] hover:bg-[#F0F2F4]"
              }`}
            >
              {v === "temperature" ? "Temp" : "Salinity"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {(["latitude", "longitude"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setSpaceAxis(a)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                spaceAxis === a
                  ? "bg-[#4A87BE] text-white"
                  : "bg-white border-[#C8CDD4] text-[#3D4A58] hover:bg-[#F0F2F4]"
              }`}
            >
              {a === "latitude" ? "Lat" : "Lon"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#7A8A9A]">Depth:</label>
          <input
            type="range"
            min={depthRange[0]}
            max={depthRange[1]}
            step={10}
            value={selectedDepth}
            onChange={(e) => setSelectedDepth(Number(e.target.value))}
            className="w-32 accent-blue-500"
          />
          <span className="text-xs text-[#7A8A9A] w-16">{selectedDepth} dbar</span>
        </div>
      </div>

      {hasData ? (
        <div className="rounded-xl p-2 h-[550px]">
          <ReactECharts option={option} lazyUpdate style={{ height: "100%", width: "100%" }} />
        </div>
      ) : (
        <p className="text-[#7A8A9A]">No data at depth {selectedDepth} dbar. Try adjusting the depth slider.</p>
      )}
    </div>
  );
}
