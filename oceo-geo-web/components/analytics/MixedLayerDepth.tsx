"use client";

import { useMemo, useEffect } from "react";
import ReactECharts from "echarts-for-react";
import type { Profile, OnContextChange } from "./types";
import { mixedLayerDepth, lightAxis, lightTitle, lightTooltip } from "./oceanUtils";

export default function MixedLayerDepth({
  profiles,
  onContextChange,
}: {
  profiles: Profile[];
  onContextChange?: OnContextChange;
}) {
  const { mldData, hasData } = useMemo(() => {
    const data: [string, number][] = [];
    for (const p of profiles) {
      const mld = mixedLayerDepth(p.measurements);
      if (mld !== null) {
        data.push([p.observed_at, mld]);
      }
    }
    return { mldData: data, hasData: data.length > 0 };
  }, [profiles]);

  useEffect(() => {
    if (!onContextChange || !hasData || mldData.length === 0) return;
    const vals = mldData.map((d) => d[1]);
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);
    const vMean = vals.reduce((s, v) => s + v, 0) / vals.length;
    onContextChange([{
      variable: "mixed layer depth",
      min: Number(vMin.toFixed(1)),
      max: Number(vMax.toFixed(1)),
      mean: Number(vMean.toFixed(1)),
      unit: "dbar",
    }]);
  }, [mldData, hasData, onContextChange]);

  if (!hasData)
    return <p className="text-[#7A8A9A]">Could not compute mixed layer depth from available data.</p>;

  const option = {
    backgroundColor: "transparent",
    title: { text: "Mixed Layer Depth (MLD) over Time", ...lightTitle },
    tooltip: {
      ...lightTooltip,
      trigger: "axis" as const,
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        return `${new Date(p.value[0]).toLocaleDateString()}<br/>MLD: ${p.value?.[1]?.toFixed(1)} dbar`;
      },
    },
    grid: { left: "10%", right: "5%", top: "12%", bottom: "10%", containLabel: true },
    xAxis: { type: "time" as const, ...lightAxis, name: "Date" },
    yAxis: { type: "value" as const, name: "Mixed Layer Depth (dbar)", inverse: true, ...lightAxis },
    series: [
      {
        type: "line",
        data: mldData,
        showSymbol: true,
        symbolSize: 6,
        smooth: true,
        lineStyle: { color: "#a78bfa", width: 2 },
        itemStyle: { color: "#a78bfa" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(167, 139, 250, 0.3)" },
              { offset: 1, color: "rgba(167, 139, 250, 0.02)" },
            ],
          },
        },
      },
    ],
  };

  return (
    <div>
      <p className="text-sm text-[#7A8A9A] mb-4">
        Computed using the temperature threshold method (delta-T = 0.2 degrees C from surface reference).
      </p>
      <div className="rounded-xl p-2 h-[550px]">
        <ReactECharts option={option} lazyUpdate style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}
