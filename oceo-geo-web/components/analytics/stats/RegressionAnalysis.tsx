"use client";

import ReactECharts from "echarts-for-react";
import { lightAxis, lightTitle, lightTooltip } from "../oceanUtils";
import type { StatsPayload } from "./types";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-4 py-3">
      <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-1">{label}</p>
      <p className="text-[#1A1F26] text-sm">{value}</p>
    </div>
  );
}

export default function RegressionAnalysis({
  single,
  multiple,
}: {
  single: StatsPayload["regression_single"];
  multiple: StatsPayload["regression_multiple"];
}) {
  if (!single || single.warning) {
    return <p className="text-[#7A8A9A]">{single?.warning ?? "Regression data unavailable."}</p>;
  }

  const ovp = single.observed_vs_predicted ?? [];
  const option = {
    backgroundColor: "transparent",
    title: { text: "Observed vs Predicted (Single Regression)", ...lightTitle },
    tooltip: { ...lightTooltip },
    grid: { left: "10%", right: "6%", top: "12%", bottom: "12%" },
    xAxis: { type: "value" as const, name: "Observed", ...lightAxis, scale: true },
    yAxis: { type: "value" as const, name: "Predicted", ...lightAxis, scale: true },
    series: [
      {
        type: "scatter" as const,
        data: ovp,
        symbolSize: 4,
        itemStyle: { color: "#5C7A96" },
      },
    ],
  };

  return (
    <div className="space-y-4">
      <ReactECharts option={option} lazyUpdate style={{ height: "360px", width: "100%" }} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard label="Single R²" value={single.r2 == null ? "N/A" : single.r2.toFixed(4)} />
        <StatCard label="Single AIC" value={single.aic == null ? "N/A" : single.aic.toFixed(2)} />
        <StatCard label="Single BIC" value={single.bic == null ? "N/A" : single.bic.toFixed(2)} />
        <StatCard
          label="Durbin-Watson"
          value={
            single.residual_diagnostics?.durbin_watson == null
              ? "N/A"
              : single.residual_diagnostics.durbin_watson.toFixed(3)
          }
        />
      </div>

      <div className="border border-[#C8CDD4] overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#F8F9FA] text-[#3D4A58] text-[11px] uppercase tracking-widest">
            <tr>
              <th className="px-3 py-2 text-left">Term</th>
              <th className="px-3 py-2 text-left">Coefficient</th>
              <th className="px-3 py-2 text-left">Std Err</th>
              <th className="px-3 py-2 text-left">t</th>
              <th className="px-3 py-2 text-left">p</th>
            </tr>
          </thead>
          <tbody>
            {(multiple?.coefficients ?? []).map((c) => (
              <tr key={c.name} className="border-t border-[#E8EAED]">
                <td className="px-3 py-2 text-[#1A1F26]">{c.name}</td>
                <td className="px-3 py-2 text-[#3D4A58]">{c.coef.toFixed(6)}</td>
                <td className="px-3 py-2 text-[#3D4A58]">{c.std_err.toFixed(6)}</td>
                <td className="px-3 py-2 text-[#3D4A58]">{c.t.toFixed(4)}</td>
                <td className="px-3 py-2 text-[#3D4A58]">{c.p_value.toExponential(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard label="Multiple R²" value={multiple?.r2 == null ? "N/A" : multiple.r2.toFixed(4)} />
        <StatCard
          label="Adjusted R²"
          value={multiple?.adjusted_r2 == null ? "N/A" : multiple.adjusted_r2.toFixed(4)}
        />
        <StatCard label="Multiple AIC" value={multiple?.aic == null ? "N/A" : multiple.aic.toFixed(2)} />
        <StatCard label="Multiple BIC" value={multiple?.bic == null ? "N/A" : multiple.bic.toFixed(2)} />
      </div>
    </div>
  );
}
