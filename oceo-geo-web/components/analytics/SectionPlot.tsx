"use client";

import { useState, useMemo, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import type { Profile, OnContextChange } from "./types";
import { haversineDistance, linearInterpolate, lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

type Variable = "temperature" | "salinity";

export default function SectionPlot({
  profiles,
  onContextChange,
}: {
  profiles: Profile[];
  onContextChange?: OnContextChange;
}) {
  const [variable, setVariable] = useState<Variable>("temperature");

  const { option, hasData } = useMemo(() => {
    if (profiles.length < 2) return { option: {}, hasData: false };

    const lats = profiles.map((p) => p.latitude);
    const lons = profiles.map((p) => p.longitude);
    const latRange = Math.max(...lats) - Math.min(...lats);
    const lonRange = Math.max(...lons) - Math.min(...lons);
    const sortByLat = latRange >= lonRange;

    const sorted = [...profiles].sort((a, b) =>
      sortByLat ? a.latitude - b.latitude : a.longitude - b.longitude
    );

    const distances: number[] = [0];
    for (let i = 1; i < sorted.length; i++) {
      distances.push(
        distances[i - 1] +
          haversineDistance(sorted[i - 1].latitude, sorted[i - 1].longitude, sorted[i].latitude, sorted[i].longitude)
      );
    }

    let minDepth = Infinity,
      maxDepth = -Infinity;
    for (const p of sorted) {
      for (const m of p.measurements) {
        if (m.pressure < minDepth) minDepth = m.pressure;
        if (m.pressure > maxDepth) maxDepth = m.pressure;
      }
    }

    const numBins = 60;
    const depthStep = (maxDepth - minDepth) / numBins;
    const depthBins = Array.from({ length: numBins }, (_, i) => minDepth + i * depthStep);

    const data: [number, number, number][] = [];
    let min = Infinity,
      max = -Infinity;

    sorted.forEach((profile, xi) => {
      depthBins.forEach((depth, yi) => {
        const val = linearInterpolate(profile.measurements, depth, variable);
        if (val !== null) {
          if (val < min) min = val;
          if (val > max) max = val;
          data.push([xi, yi, val]);
        }
      });
    });

    const xLabels = sorted.map((_, i) => distances[i].toFixed(1));
    const yLabels = depthBins.map((d) => d.toFixed(0));

    return {
      hasData: data.length > 0,
      option: {
        backgroundColor: "transparent",
        title: {
          text: `${variable === "temperature" ? "Temperature" : "Salinity"} Section (${sortByLat ? "Lat" : "Lon"} transect)`,
          ...lightTitle,
        },
        tooltip: {
          ...lightTooltip,
          formatter: (p: any) =>
            `Distance: ${xLabels[p.value[0]]} km<br/>Depth: ${yLabels[p.value[1]]} dbar<br/>Value: ${p.value[2]?.toFixed(2)}`,
        },
        grid: { left: "10%", right: "14%", top: "12%", bottom: "12%" },
        xAxis: { type: "category" as const, data: xLabels, ...lightAxis, name: "Distance (km)" },
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
        series: [{ type: "heatmap", data }],
      },
    };
  }, [profiles, variable]);

  useEffect(() => {
    if (!onContextChange || !hasData) return;
    // Extract the values from the computed data array inside option
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

  if (!hasData)
    return <p className="text-[#7A8A9A]">Need at least 2 profiles with different locations for a section plot.</p>;

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
