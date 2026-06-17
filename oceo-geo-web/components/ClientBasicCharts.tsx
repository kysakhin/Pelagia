"use client";

import ReactECharts from "echarts-for-react";

interface DataRow {
  profile_id: number;
  pressure: number;
  temperature: number;
  salinity: number;
  latitude: number;
  longitude: number;
  date: string;
}

export default function ClientBasicCharts({ data }: { data: DataRow[] }) {
  if (!data || data.length === 0) {
    return <p className="text-gray-500">No data available for charts.</p>;
  }

  // Common tooltips and styling
  const commonEchartsOption = {
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    grid: { left: "10%", right: "10%", bottom: "12%", top: "12%", containLabel: true },
  };

  // Temperature Profile (X=Temperature, Y=Depth/Pressure reverse)
  const tempProfileOption = {
    ...commonEchartsOption,
    title: { text: "Temperature vs. Depth Profile", left: "center", textStyle: { fontFamily: "Helvetica Neue, sans-serif", fontSize: 16, fontWeight: "normal", color: "#1A1F26" } },
    xAxis: { type: "value", name: "Temperature (°C)", nameLocation: "middle", nameGap: 30, scale: true, splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } }, axisLabel: { color: "#3D4A58" } },
    yAxis: { type: "value", name: "Pressure/Depth (dbar)", inverse: true, nameLocation: "middle", nameGap: 40, scale: true, splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } }, axisLabel: { color: "#3D4A58" } },
    series: [
      {
        data: data.map((d) => [d.temperature, d.pressure]),
        type: "scatter",
        symbolSize: 4,
        itemStyle: { color: "#4A87BE" },
      },
    ],
  };

  // Salinity Profile
  const salinityProfileOption = {
    ...commonEchartsOption,
    title: { text: "Salinity vs. Depth Profile", left: "center", textStyle: { fontFamily: "Helvetica Neue, sans-serif", fontSize: 16, fontWeight: "normal", color: "#1A1F26" } },
    xAxis: { type: "value", name: "Salinity (PSU)", nameLocation: "middle", nameGap: 30, scale: true, splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } }, axisLabel: { color: "#3D4A58" } },
    yAxis: { type: "value", name: "Pressure/Depth (dbar)", inverse: true, nameLocation: "middle", nameGap: 40, scale: true, splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } }, axisLabel: { color: "#3D4A58" } },
    series: [
      {
        data: data.map((d) => [d.salinity, d.pressure]),
        type: "scatter",
        symbolSize: 4,
        itemStyle: { color: "#5C7A96" },
      },
    ],
  };

  // T-S Diagram
  const tsOption = {
    tooltip: { formatter: "Salinity: {c[0]} PSU<br/>Temperature: {c[1]} °C<br/>Depth: {c[2]} dbar" },
    title: { text: "Temperature-Salinity (T-S) Diagram", left: "center", textStyle: { fontFamily: "Helvetica Neue, sans-serif", fontSize: 16, fontWeight: "normal", color: "#1A1F26" } },
    xAxis: { type: "value", name: "Salinity (PSU)", scale: true, splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } }, axisLabel: { color: "#3D4A58" } },
    yAxis: { type: "value", name: "Temperature (°C)", scale: true, splitLine: { lineStyle: { color: "#C8CDD4", type: "dashed" } }, axisLabel: { color: "#3D4A58" } },
    visualMap: {
      min: Math.min(...data.map(d => d.pressure)),
      max: Math.max(...data.map(d => d.pressure)),
      dimension: 2,
      orient: "vertical",
      right: 10,
      top: "center",
      text: ["Deep", "Surface"],
      calculable: true,
      inRange: {
        color: ["#171c42", "#2E6DA4", "#4A87BE", "#7B9BB8", "#C8CDD4"],
      },
      textStyle: { color: "#3D4A58" }
    },
    series: [
      {
        data: data.map((d) => [d.salinity, d.temperature, d.pressure]),
        type: "scatter",
        symbolSize: 5,
      },
    ],
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl h-[500px] w-full p-2">
          <ReactECharts option={tempProfileOption} style={{ height: "100%", width: "100%" }} />
        </div>
        <div className="bg-white rounded-xl h-[500px] w-full p-2">
          <ReactECharts option={salinityProfileOption} style={{ height: "100%", width: "100%" }} />
        </div>
      </div>
      
      <div className="bg-white rounded-xl h-[600px] w-full p-2">
        <ReactECharts option={tsOption} style={{ height: "100%", width: "100%" }} />
      </div>
      <p className="text-gray-400 text-sm text-center mt-4">Plotting randomly sampled rows (Max 2,500)</p>
    </div>
  );
}