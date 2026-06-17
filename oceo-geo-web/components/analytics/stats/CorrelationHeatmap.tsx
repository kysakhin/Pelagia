"use client";

import ReactECharts from "echarts-for-react";
import { lightAxis, lightTitle, lightTooltip } from "../oceanUtils";
import type { CorrMethod, StatsPayload } from "./types";

function fmt(v: number | null | undefined) {
  return v == null ? "-" : v.toFixed(3);
}

export default function CorrelationHeatmap({
  correlation,
  method,
}: {
  correlation: StatsPayload["correlation"];
  method: CorrMethod;
}) {
  if (!correlation || !correlation[method]) {
    return <p className="text-[#7A8A9A]">Correlation data unavailable.</p>;
  }

  const m = correlation[method];
  const vars = m.variables;
  const heatData: [number, number, number][] = [];
  vars.forEach((_, i) => {
    vars.forEach((__, j) => {
      heatData.push([j, i, m.coefficients[i][j] ?? 0]);
    });
  });

  const option = {
    backgroundColor: "transparent",
    title: { text: `Correlation Matrix (${method})`, ...lightTitle },
    tooltip: {
      ...lightTooltip,
      formatter: (p: any) => {
        const row = p.value[1];
        const col = p.value[0];
        const coef = m.coefficients[row][col];
        const pval = m.p_values[row][col];
        const n = m.sample_sizes[row][col];
        return `${vars[row]} vs ${vars[col]}<br/>r: ${fmt(coef)}<br/>p: ${fmt(pval)}<br/>n: ${n}`;
      },
    },
    grid: { left: "16%", right: "8%", top: "12%", bottom: "10%" },
    xAxis: { type: "category" as const, data: vars, ...lightAxis },
    yAxis: { type: "category" as const, data: vars, ...lightAxis },
    visualMap: {
      min: -1,
      max: 1,
      orient: "vertical" as const,
      right: 0,
      top: "center",
      calculable: true,
      inRange: { color: ["#2E6DA4", "#F0F2F4", "#D66A3D"] },
      textStyle: { color: "#7A8A9A" },
    },
    series: [
      {
        type: "heatmap" as const,
        data: heatData,
        label: {
          show: true,
          formatter: (p: any) => fmt(p.value[2]),
          color: "#1A1F26",
          fontSize: 11,
        },
      },
    ],
  };

  return <ReactECharts option={option} lazyUpdate style={{ height: "420px", width: "100%" }} />;
}
