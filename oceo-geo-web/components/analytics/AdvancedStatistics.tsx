"use client";

import { useEffect, useMemo, useState } from "react";
import CorrelationHeatmap from "./stats/CorrelationHeatmap";
import PairwiseAnalysis from "./stats/PairwiseAnalysis";
import RegressionAnalysis from "./stats/RegressionAnalysis";
import type { CorrMethod, StatsPayload } from "./stats/types";
import ReactECharts from "echarts-for-react";
import { lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

const PAIR_OPTIONS = [
  { value: "salinity:temperature", label: "Temperature vs Salinity" },
  { value: "pressure:temperature", label: "Temperature vs Depth" },
  { value: "pressure:salinity", label: "Salinity vs Depth" },
] as const;

export default function AdvancedStatistics({
  projectId,
}: {
  projectId: number;
}) {
  const [corrMethod, setCorrMethod] = useState<CorrMethod>("pearson");
  const [pairValue, setPairValue] = useState<(typeof PAIR_OPTIONS)[number]["value"]>(
    "salinity:temperature"
  );
  const [polyDegree, setPolyDegree] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<StatsPayload | null>(null);

  useEffect(() => {
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const [pairX, pairY] = pairValue.split(":");

        const res = await fetch("/api/stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            pair_x: pairX,
            pair_y: pairY,
            poly_degree: polyDegree,
            corr_method: corrMethod,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Stats request failed");
        }
        setPayload(json as StatsPayload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to compute statistics");
      } finally {
        setLoading(false);
      }
    }

    run();
  }, [pairValue, polyDegree, corrMethod, projectId]);

  const trendOption = useMemo(() => {
    const trend = payload?.trend;
    if (!trend || trend.warning || !trend.series || !trend.theil_sen?.line) return null;
    return {
      backgroundColor: "transparent",
      title: { text: "Trend Analysis (Mann-Kendall + Theil-Sen)", ...lightTitle },
      tooltip: { ...lightTooltip },
      grid: { left: "10%", right: "6%", top: "12%", bottom: "12%" },
      xAxis: { type: "value" as const, name: "Index", ...lightAxis, scale: true },
      yAxis: { type: "value" as const, name: trend.variable, ...lightAxis, scale: true },
      series: [
        { type: "line" as const, data: trend.series, symbolSize: 3, lineStyle: { color: "#7B9BB8" } },
        {
          type: "line" as const,
          data: trend.theil_sen.line,
          showSymbol: false,
          lineStyle: { color: "#D66A3D", width: 2 },
        },
      ],
    };
  }, [payload]);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#C8CDD4] p-5">
        <p className="text-[11px] uppercase tracking-widest text-[#3D4A58] mb-4 font-bold">Statistics Controls</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            value={corrMethod}
            onChange={(e) => setCorrMethod(e.target.value as CorrMethod)}
            className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2 text-sm text-[#1A1F26]"
          >
            <option value="pearson">Pearson</option>
            <option value="spearman">Spearman</option>
            <option value="kendall">Kendall</option>
          </select>
          <select
            value={pairValue}
            onChange={(e) => setPairValue(e.target.value as (typeof PAIR_OPTIONS)[number]["value"])}
            className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2 text-sm text-[#1A1F26]"
          >
            {PAIR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={polyDegree}
            onChange={(e) => setPolyDegree(Number(e.target.value))}
            className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2 text-sm text-[#1A1F26]"
          >
            <option value={1}>Polynomial Degree 1</option>
            <option value={2}>Polynomial Degree 2</option>
            <option value={3}>Polynomial Degree 3</option>
            <option value={4}>Polynomial Degree 4</option>
          </select>
          <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2 text-sm text-[#3D4A58]">
            Samples: {payload?.summary?.rows ?? "-"}
          </div>
        </div>
      </div>

      {loading && <p className="text-[#7A8A9A]">Computing advanced statistics...</p>}
      {error && <p className="text-[#A63A3A]">{error}</p>}
      {payload?.warning && <p className="text-[#A63A3A]">{payload.warning}</p>}

      {!loading && payload && (
        <>
          <section className="bg-white border border-[#C8CDD4] p-5">
            <p className="text-[11px] uppercase tracking-widest text-[#3D4A58] mb-4 font-bold">Robust Association</p>
            <CorrelationHeatmap correlation={payload.correlation} method={corrMethod} />
          </section>

          <section className="bg-white border border-[#C8CDD4] p-5">
            <p className="text-[11px] uppercase tracking-widest text-[#3D4A58] mb-4 font-bold">Pairwise Relationship</p>
            <PairwiseAnalysis pairwise={payload.pairwise} />
          </section>

          <section className="bg-white border border-[#C8CDD4] p-5">
            <p className="text-[11px] uppercase tracking-widest text-[#3D4A58] mb-4 font-bold">Regression Analysis</p>
            <RegressionAnalysis single={payload.regression_single} multiple={payload.regression_multiple} />
          </section>

          <section className="bg-white border border-[#C8CDD4] p-5 space-y-4">
            <p className="text-[11px] uppercase tracking-widest text-[#3D4A58] font-bold">Trend Tests Bundle</p>
            {trendOption ? (
              <ReactECharts option={trendOption} lazyUpdate style={{ height: "360px", width: "100%" }} />
            ) : (
              <p className="text-[#7A8A9A]">{payload.trend?.warning ?? "Trend analysis unavailable."}</p>
            )}
            {payload.trend?.mann_kendall && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2">Tau: {payload.trend.mann_kendall.tau.toFixed(4)}</div>
                <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2">p-value: {payload.trend.mann_kendall.p_value.toExponential(2)}</div>
                <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2">Trend: {payload.trend.mann_kendall.trend}</div>
                <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2">Sen Slope: {payload.trend.sen_slope == null ? "N/A" : payload.trend.sen_slope.toFixed(6)}</div>
              </div>
            )}
          </section>

          <section className="bg-white border border-[#C8CDD4] p-5 space-y-4">
            <p className="text-[11px] uppercase tracking-widest text-[#3D4A58] font-bold">Normality Tests Bundle</p>
            {payload.normality?.warning ? (
              <p className="text-[#7A8A9A]">{payload.normality.warning}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2">
                  Shapiro-Wilk: {payload.normality?.shapiro_wilk?.statistic.toFixed(4)} / p={payload.normality?.shapiro_wilk?.p_value.toExponential(2)}
                </div>
                <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2">
                  Kolmogorov-Smirnov: {payload.normality?.kolmogorov_smirnov?.statistic.toFixed(4)} / p={payload.normality?.kolmogorov_smirnov?.p_value.toExponential(2)}
                </div>
                <div className="bg-[#F8F9FA] border border-[#C8CDD4] px-3 py-2">
                  Anderson-Darling: {payload.normality?.anderson_darling?.statistic.toFixed(4)}
                </div>
              </div>
            )}

            {payload.normality?.anderson_darling && (
              <div className="border border-[#C8CDD4] overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F8F9FA] text-[#3D4A58] text-[11px] uppercase tracking-widest">
                    <tr>
                      <th className="px-3 py-2 text-left">Significance (%)</th>
                      <th className="px-3 py-2 text-left">Critical Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.normality.anderson_darling.significance_levels.map((level, i) => (
                      <tr key={level} className="border-t border-[#E8EAED]">
                        <td className="px-3 py-2 text-[#1A1F26]">{level.toFixed(1)}</td>
                        <td className="px-3 py-2 text-[#3D4A58]">{payload.normality?.anderson_darling?.critical_values[i].toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
