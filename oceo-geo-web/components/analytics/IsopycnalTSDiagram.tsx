"use client";

import { useMemo, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import type { Profile, OnContextChange } from "./types";
import { potentialDensity, lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

export default function IsopycnalTSDiagram({
  profiles,
  onContextChange,
}: {
  profiles: Profile[];
  onContextChange?: OnContextChange;
}) {
  const tsStats = useMemo(() => {
    let sMin = Infinity, sMax = -Infinity;
    let tMin = Infinity, tMax = -Infinity;
    let sSum = 0, tSum = 0, count = 0;
    for (const p of profiles) {
      for (const m of p.measurements) {
        if (!isNaN(m.temperature) && !isNaN(m.salinity)) {
          if (m.salinity < sMin) sMin = m.salinity;
          if (m.salinity > sMax) sMax = m.salinity;
          if (m.temperature < tMin) tMin = m.temperature;
          if (m.temperature > tMax) tMax = m.temperature;
          sSum += m.salinity;
          tSum += m.temperature;
          count += 1;
        }
      }
    }
    if (count === 0) return null;
    return {
      sMin, sMax, sMean: sSum / count,
      tMin, tMax, tMean: tSum / count,
      count,
    };
  }, [profiles]);

  useEffect(() => {
    if (!onContextChange || !tsStats) return;
    onContextChange([
      { variable: "temperature", min: Number(tsStats.tMin.toFixed(3)), max: Number(tsStats.tMax.toFixed(3)), mean: Number(tsStats.tMean.toFixed(3)), unit: "\u00b0C" },
      { variable: "salinity",    min: Number(tsStats.sMin.toFixed(3)), max: Number(tsStats.sMax.toFixed(3)), mean: Number(tsStats.sMean.toFixed(3)), unit: "PSU" },
    ]);
  }, [tsStats, onContextChange]);

  const option = useMemo(() => {
    const points: [number, number, number][] = [];
    let sMin = Infinity, sMax = -Infinity,
        tMin = Infinity, tMax = -Infinity;

    for (const p of profiles) {
      for (const m of p.measurements) {
        if (!isNaN(m.temperature) && !isNaN(m.salinity)) {
          points.push([m.salinity, m.temperature, m.pressure]);
          if (m.salinity < sMin) sMin = m.salinity;
          if (m.salinity > sMax) sMax = m.salinity;
          if (m.temperature < tMin) tMin = m.temperature;
          if (m.temperature > tMax) tMax = m.temperature;
        }
      }
    }

    if (points.length === 0) return {};

    const sPad = (sMax - sMin) * 0.1 || 1;
    const tPad = (tMax - tMin) * 0.1 || 1;
    sMin -= sPad;
    sMax += sPad;
    tMin -= tPad;
    tMax += tPad;

    // Compute which isopycnal levels fall within the visible T-S range
    const allSigmaLevels = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
    const midS = (sMin + sMax) / 2;
    const sigmaLevels = allSigmaLevels.filter(
      (s) => potentialDensity(tMax, midS) <= s && potentialDensity(tMin, midS) >= s
    );

    // For each sigma level, sweep T and binary-search S
    const isopycnalSeries = sigmaLevels.map((sigma) => {
      const linePoints: [number, number][] = [];
      const steps = 80;
      const tStep = (tMax - tMin) / steps;

      for (let i = 0; i <= steps; i++) {
        const T = tMin + i * tStep;
        let lo = sMin,
          hi = sMax;
        for (let j = 0; j < 40; j++) {
          const mid = (lo + hi) / 2;
          if (potentialDensity(T, mid) < sigma) lo = mid;
          else hi = mid;
        }
        const S = (lo + hi) / 2;
        if (S > sMin + 0.05 && S < sMax - 0.05) {
          linePoints.push([S, T]);
        }
      }

      return {
        type: "line" as const,
        data: linePoints,
        showSymbol: false,
        lineStyle: { color: "#C8CDD4", width: 1, type: "dashed" as const },
        z: 1,
        endLabel: {
          show: true,
          formatter: `\u03c3\u2080=${sigma}`,
          color: "#7A8A9A",
          fontSize: 10,
        },
      };
    });

    const pressures = points.map((p) => p[2]);

    return {
      backgroundColor: "transparent",
      title: { text: "T-S Diagram with Isopycnal Overlays", ...lightTitle },
      tooltip: {
        ...lightTooltip,
        formatter: (p: any) => {
          if (p.seriesIndex === 0) {
            return `S: ${p.value?.[0]?.toFixed(2)} PSU<br/>T: ${p.value?.[1]?.toFixed(2)} \u00b0C<br/>Depth: ${p.value?.[2]?.toFixed(0)} dbar<br/>\u03c3\u2080: ${potentialDensity(p.value?.[1], p.value?.[0]).toFixed(2)} kg/m\u00b3`;
          }
          return "";
        },
      },
      grid: { left: "8%", right: "8%", top: "12%", bottom: "10%", containLabel: true },
      xAxis: { type: "value" as const, name: "Salinity (PSU)", min: sMin, max: sMax, ...lightAxis },
      yAxis: { type: "value" as const, name: "Temperature (\u00b0C)", min: tMin, max: tMax, ...lightAxis },
      visualMap: {
        min: Math.min(...pressures),
        max: Math.max(...pressures),
        dimension: 2,
        orient: "vertical" as const,
        right: 0,
        top: "center",
        text: ["Deep", "Surface"],
        inRange: { color: ["#171c42", "#223f9a", "#287cb2", "#4bc5a3", "#a8e562"] },
        textStyle: { color: "#7A8A9A" },
      },
      series: [{ type: "scatter" as const, data: points, symbolSize: 4, z: 2 }, ...isopycnalSeries],
    };
  }, [profiles]);

  if (profiles.length === 0) return <p className="text-[#7A8A9A]">No data available.</p>;

  return (
    <div>
      <p className="text-sm text-[#7A8A9A] mb-4">
        Scatter points colored by depth with isopycnal lines (constant potential density surfaces) overlaid.
      </p>
      <div className="rounded-xl p-2 h-[600px]">
        <ReactECharts option={option} lazyUpdate style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}
