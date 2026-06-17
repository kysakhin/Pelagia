"use client";

import { useState, useEffect, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { Profile, OnContextChange } from "./types";
import { lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

type Mode = "temp-depth" | "sal-depth" | "ts";

export default function TimeSeriesAnimation({
  profiles,
  onContextChange,
}: {
  profiles: Profile[];
  onContextChange?: OnContextChange;
}) {
  const [mode, setMode] = useState<Mode>("temp-depth");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev < profiles.length - 1 ? prev + 1 : 0));
    }, 800);
    return () => clearInterval(timer);
  }, [playing, profiles.length]);

  // Compute global stats across all profiles to report context
  const allStats = useMemo(() => {
    let tMin = Infinity, tMax = -Infinity, tSum = 0, tCount = 0;
    let sMin = Infinity, sMax = -Infinity, sSum = 0, sCount = 0;
    for (const p of profiles) {
      for (const m of p.measurements) {
        if (!isNaN(m.temperature)) { tMin = Math.min(tMin, m.temperature); tMax = Math.max(tMax, m.temperature); tSum += m.temperature; tCount++; }
        if (!isNaN(m.salinity))    { sMin = Math.min(sMin, m.salinity);    sMax = Math.max(sMax, m.salinity);    sSum += m.salinity;    sCount++; }
      }
    }
    return { tMin, tMax, tMean: tCount ? tSum / tCount : 0, sMin, sMax, sMean: sCount ? sSum / sCount : 0 };
  }, [profiles]);

  useEffect(() => {
    if (!onContextChange) return;
    const t = { variable: "temperature", min: Number(allStats.tMin.toFixed(3)), max: Number(allStats.tMax.toFixed(3)), mean: Number(allStats.tMean.toFixed(3)), unit: "\u00b0C" };
    const s = { variable: "salinity",    min: Number(allStats.sMin.toFixed(3)), max: Number(allStats.sMax.toFixed(3)), mean: Number(allStats.sMean.toFixed(3)), unit: "PSU" };
    if (mode === "temp-depth") onContextChange([t]);
    else if (mode === "sal-depth") onContextChange([s]);
    else onContextChange([t, s]); // ts mode shows both
  }, [allStats, mode, onContextChange]);

  const profile = profiles[index];
  if (!profile) return <p className="text-[#7A8A9A]">No profiles available for animation.</p>;

  const option = useMemo(() => {
    const ms = profiles[index]?.measurements ?? [];
    const dateObj = new Date(profiles[index]?.observed_at ?? "");
    const dateSuffix = isNaN(dateObj.getTime()) ? "" : ` -- ${dateObj.toLocaleString()}`;

    if (mode === "ts") {
      return {
        backgroundColor: "transparent",
        title: { text: `T-S Diagram${dateSuffix}`, ...lightTitle },
        tooltip: {
          ...lightTooltip,
          formatter: (p: any) =>
            `S: ${p.value?.[0]?.toFixed(2)} PSU<br/>T: ${p.value?.[1]?.toFixed(2)} \u00b0C`,
        },
        grid: { left: "8%", right: "5%", top: "12%", bottom: "10%", containLabel: true },
        xAxis: { type: "value", name: "Salinity (PSU)", ...lightAxis, scale: true },
        yAxis: { type: "value", name: "Temperature (\u00b0C)", ...lightAxis, scale: true },
        series: [
          {
            type: "scatter",
            data: ms
              .filter((m) => !isNaN(m.salinity) && !isNaN(m.temperature))
              .map((m) => [m.salinity, m.temperature]),
            symbolSize: 6,
            itemStyle: { color: "#60a5fa" },
          },
        ],
      };
    }

    const isTemp = mode === "temp-depth";
    // FIX: the date suffix is not showing up in the title for some reason - investigate
    return {
      backgroundColor: "transparent",
      title: {
        text: `${isTemp ? "Temperature" : "Salinity"} vs Depth${dateSuffix}`,
        ...lightTitle,
      },
      tooltip: { ...lightTooltip },
      grid: { left: "8%", right: "5%", top: "12%", bottom: "10%", containLabel: true },
      xAxis: {
        type: "value",
        name: isTemp ? "Temperature (\u00b0C)" : "Salinity (PSU)",
        ...lightAxis,
        scale: true,
      },
      yAxis: { type: "value", name: "Depth (dbar)", inverse: true, ...lightAxis, scale: true },
      series: [
        {
          type: "line",
          data: ms
            .filter((m) => !isNaN(isTemp ? m.temperature : m.salinity))
            .map((m) => [isTemp ? m.temperature : m.salinity, m.pressure]),
          showSymbol: true,
          symbolSize: 4,
          smooth: true,
          lineStyle: { color: isTemp ? "#f97316" : "#38bdf8", width: 2 },
          itemStyle: { color: isTemp ? "#f97316" : "#38bdf8" },
        },
      ],
    };
  }, [profiles, index, mode]);

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-2">
          {(
            [
              ["temp-depth", "Temp vs Depth"],
              ["sal-depth", "Sal vs Depth"],
              ["ts", "T-S Diagram"],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setMode(val as Mode)}
              className={`px-3 py-1.5 rounded-xs text-xs font-medium transition ${
                mode === val
                  ? "bg-[#4A87BE] text-white"
                  : "bg-white border-[#C8CDD4] text-[#3D4A58] hover:bg-[#F0F2F4]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl p-2 h-[550px]">
        <ReactECharts option={option} lazyUpdate style={{ height: "100%", width: "100%" }} />
      </div>

      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={() => setPlaying(!playing)}
          className="px-4 py-2 rounded bg-[#2E6DA4] hover:bg-[#4A87BE] text-white text-sm font-medium transition"
        >
          {playing ? "Pause" : "Play"}
        </button>

        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={profiles.length - 1}
            value={index}
            onChange={(e) => {
              setIndex(Number(e.target.value));
              setPlaying(false);
            }}
            className="w-full accent-blue-500"
          />
          {/* Tick markers */}
          <div className="relative mt-1" style={{ height: profiles.length <= 12 ? "2.5rem" : "0.75rem" }}>
            {profiles.map((p, i) => {
              const pct = profiles.length > 1 ? (i / (profiles.length - 1)) * 100 : 0;
              const showLabel = profiles.length <= 12;
              const d = new Date(p.observed_at ?? "");
              const label = !isNaN(d.getTime())
                ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                : `#${i + 1}`;
              return (
                <div
                  key={i}
                  className="absolute flex flex-col items-center"
                  style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
                >
                  <div className={`w-px ${i === index ? "bg-[#4A87BE]" : "bg-[#C8CDD4]"}`} style={{ height: "6px" }} />
                  {showLabel && (
                    <span
                      className={`text-[9px] mt-0.5 whitespace-nowrap select-none ${
                        i === index ? "text-[#4A87BE] font-bold" : "text-[#7A8A9A]"
                      }`}
                    >
                      {label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <span className="text-[#7A8A9A] text-sm whitespace-nowrap">
          {index + 1} / {profiles.length}
        </span>
      </div>
    </div>
  );
}
