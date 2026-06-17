"use client";

import { useMemo, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import type { Profile, OnContextChange } from "./types";
import { soundVelocity, lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

const PROFILE_COLORS = [
  "#60a5fa", "#f97316", "#a78bfa", "#34d399", "#f472b6",
  "#facc15", "#38bdf8", "#fb923c", "#818cf8", "#4ade80",
];

export default function SoundVelocityProfile({
  profiles,
  onContextChange,
}: {
  profiles: Profile[];
  onContextChange?: OnContextChange;
}) {
  const allSV = useMemo(() => {
    const vals: number[] = [];
    profiles.forEach(p => {
      p.measurements
        .filter(m => !isNaN(m.temperature) && !isNaN(m.salinity))
        .forEach(m => vals.push(soundVelocity(m.temperature, m.salinity, m.pressure)));
    });
    return vals;
  }, [profiles]);

  useEffect(() => {
    if (!onContextChange || allSV.length === 0) return;
    const min = Math.min(...allSV);
    const max = Math.max(...allSV);
    const mean = allSV.reduce((s, v) => s + v, 0) / allSV.length;
    onContextChange([{
      variable: "sound velocity",
      min: Number(min.toFixed(2)),
      max: Number(max.toFixed(2)),
      mean: Number(mean.toFixed(2)),
      unit: "m/s",
    }]);
  }, [allSV, onContextChange]);

  const option = useMemo(() => {
    // Sample up to 10 evenly spaced profiles
    const selected =
      profiles.length <= 10
        ? profiles
        : profiles.filter((_, i) => i % Math.ceil(profiles.length / 10) === 0).slice(0, 10);

    const series = selected.map((profile, idx) => {
      const data = profile.measurements
        .filter((m) => !isNaN(m.temperature) && !isNaN(m.salinity))
        .map((m) => [soundVelocity(m.temperature, m.salinity, m.pressure), m.pressure]);

      return {
        type: "line" as const,
        name: new Date(profile.observed_at).toLocaleDateString(),
        data,
        showSymbol: false,
        smooth: true,
        lineStyle: { color: PROFILE_COLORS[idx % PROFILE_COLORS.length], width: 2 },
        itemStyle: { color: PROFILE_COLORS[idx % PROFILE_COLORS.length] },
      };
    });

    return {
      backgroundColor: "transparent",
      title: { text: "Sound Velocity Profiles", ...lightTitle },
      tooltip: {
        ...lightTooltip,
        trigger: "axis" as const,
        formatter: (params: any) => {
          if (!Array.isArray(params)) return "";
          return params
            .map(
              (p: any) =>
                `<span style="color:${p.color}">\u25cf</span> ${p.seriesName}: ${p.value?.[0]?.toFixed(1)} m/s at ${p.value?.[1]?.toFixed(0)} dbar`
            )
            .join("<br/>");
        },
      },
      legend: {
        show: selected.length > 1,
        bottom: 0,
        textStyle: { color: "#7A8A9A", fontSize: 10 },
      },
      grid: {
        left: "10%",
        right: "5%",
        top: "10%",
        bottom: selected.length > 1 ? "15%" : "8%",
        containLabel: true,
      },
      xAxis: { type: "value" as const, name: "Sound Velocity (m/s)", ...lightAxis, scale: true },
      yAxis: { type: "value" as const, name: "Depth (dbar)", inverse: true, ...lightAxis, scale: true },
      series,
    };
  }, [profiles]);

  if (profiles.length === 0) return <p className="text-[#7A8A9A]">No data available.</p>;

  return (
    <div>
      <p className="text-sm text-[#7A8A9A] mb-4">
        Computed using the Mackenzie (1981) empirical equation from temperature, salinity, and depth.
      </p>
      <div className="rounded-xl p-2 h-[550px]">
        <ReactECharts option={option} lazyUpdate style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}
