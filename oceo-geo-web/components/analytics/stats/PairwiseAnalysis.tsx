"use client";

import ReactECharts from "echarts-for-react";
import { lightAxis, lightTitle, lightTooltip } from "../oceanUtils";
import type { StatsPayload } from "./types";

export default function PairwiseAnalysis({ pairwise }: { pairwise: StatsPayload["pairwise"] }) {
  if (!pairwise || pairwise.warning) {
    return <p className="text-[#7A8A9A]">{pairwise?.warning ?? "Pairwise analysis unavailable."}</p>;
  }

  const option = {
    backgroundColor: "transparent",
    title: { text: `${pairwise.y} vs ${pairwise.x}`, ...lightTitle },
    tooltip: { ...lightTooltip },
    grid: { left: "10%", right: "6%", top: "12%", bottom: "12%" },
    xAxis: { type: "value" as const, name: pairwise.x, ...lightAxis, scale: true },
    yAxis: { type: "value" as const, name: pairwise.y, ...lightAxis, scale: true },
    series: [
      {
        type: "scatter" as const,
        data: pairwise.points ?? [],
        symbolSize: 4,
        itemStyle: { color: "#4A87BE" },
      },
      {
        type: "line" as const,
        data: pairwise.curve ?? [],
        showSymbol: false,
        smooth: true,
        lineStyle: { color: "#D66A3D", width: 2 },
      },
    ],
  };

  return (
    <div className="space-y-4">
      <ReactECharts option={option} lazyUpdate style={{ height: "430px", width: "100%" }} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-4 py-3">
          <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-1">Polynomial Equation</p>
          <p className="text-[#1A1F26] wrap-break-word">{pairwise.equation ?? "N/A"}</p>
        </div>
        <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-4 py-3">
          <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-1">Model Fit</p>
          <p className="text-[#1A1F26]">R²: {pairwise.r2 == null ? "N/A" : pairwise.r2.toFixed(4)} • n: {pairwise.n}</p>
        </div>
      </div>
    </div>
  );
}
