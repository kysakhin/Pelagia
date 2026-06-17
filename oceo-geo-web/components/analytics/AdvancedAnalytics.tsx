"use client";

import { useState, useMemo, useCallback } from "react";
import type { DataPoint, ChartContext, ChartStat } from "./types";
import { groupByProfile } from "./oceanUtils";
import TimeSeriesAnimation from "./TimeSeriesAnimation";
import DepthHeatmap from "./DepthHeatmap";
import DepthContours from "./DepthContours";
import IsopycnalTSDiagram from "./IsopycnalTSDiagram";
import SectionPlot from "./SectionPlot";
import HovmollerDiagram from "./HovmollerDiagram";
import SoundVelocityProfile from "./SoundVelocityProfile";
import MixedLayerDepth from "./MixedLayerDepth";
import AdvancedStatistics from "./AdvancedStatistics";
import AnalyticsChatPanel from "./AnalyticsChatPanel";

const CHARTS = [
  { id: "animation", label: "Profile Animation" },
  { id: "heatmap", label: "Depth Heatmaps" },
  { id: "contours", label: "Depth Contours" },
  { id: "isopycnal", label: "T-S Isopycnals" },
  { id: "section", label: "Section / Transect" },
  { id: "hovmoller", label: "Hovmoller Diagram" },
  { id: "svp", label: "Sound Velocity" },
  { id: "mld", label: "Mixed Layer Depth" },
  { id: "stats", label: "Advanced Statistics" },
] as const;

type ChartId = (typeof CHARTS)[number]["id"];

export default function AdvancedAnalytics({
  data,
  projectId,
  initialView,
}: {
  data: DataPoint[];
  projectId: number;
  initialView?: ChartId;
}) {
  const [active, setActive] = useState<ChartId>(initialView ?? "animation");
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Stores whatever stats the currently-active chart last reported via onContextChange
  const [reportedStats, setReportedStats] = useState<ChartStat[]>([]);

  const profiles = useMemo(() => groupByProfile(data), [data]);
  const currentLabel = CHARTS.find((c) => c.id === active)?.label || "View";

  // Generic handler — any chart calls this. AdvancedAnalytics doesn't need to know which chart it is.
  const handleContextChange = useCallback((stats: ChartStat[]) => {
    setReportedStats(stats);
  }, []);

  // When the user switches charts, clear the previous chart's context until the new one reports.
  const handleChartSwitch = (id: ChartId) => {
    setActive(id);
    setReportedStats([]);
  };

  const currentContext: ChartContext | null =
    profiles.length === 0
      ? null
      : {
          chartId: active,
          chartLabel: currentLabel,
          variables: reportedStats.map((s) => s.variable),
          stats: reportedStats,
          profileCount: profiles.length,
        };

  if (profiles.length === 0) {
    return (
      <div className="text-center py-20 text-[#7A8A9A]">
        <p className="text-lg font-medium">No measurement data found</p>
        <p className="text-sm mt-2">Upload NetCDF files to your project to see visualizations.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      <nav className="w-52 shrink-0 space-y-1">
        {CHARTS.map((c) => (
          <button
            key={c.id}
            onClick={() => handleChartSwitch(c.id)}
            className={`w-full text-left px-4 py-2.5 rounded-xs text-sm font-medium transition ${
              active === c.id
                ? "bg-[#2E6DA4] text-white"
                : "text-[#3D4A58] hover:text-[#1A1F26] hover:bg-[#F0F2F4]"
            }`}
          >
            {c.label}
          </button>
        ))}
        <div className="pt-4 mt-4 border-t border-[#C8CDD4]">
          <p className="text-xs text-[#7A8A9A] px-4">{profiles.length} profiles loaded</p>
        </div>
      </nav>

      <div className="flex-1 min-w-0 relative flex gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-light text-[#1A1F26]">{currentLabel}</h2>
            {!isChatOpen && (
              <button
                onClick={() => setIsChatOpen(true)}
                className="flex items-center gap-2 text-sm text-[#4A87BE] hover:text-[#2E6DA4] hover:bg-[#F4F8FC] px-3 py-1.5 rounded-sm transition-colors border border-transparent hover:border-[#4A87BE]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                Ask AI Copilot
              </button>
            )}
          </div>
          <div className="bg-white border border-[#DDE1E6] rounded-sm p-4">
            {/* Each chart that supports context reporting accepts onContextChange.
                Charts without it simply omit the prop — no breakage, no if blocks here. */}
            {active === "animation" && <TimeSeriesAnimation profiles={profiles} onContextChange={handleContextChange} />}
            {active === "heatmap" && <DepthHeatmap profiles={profiles} onContextChange={handleContextChange} />}
            {active === "contours" && <DepthContours profiles={profiles} onContextChange={handleContextChange} />}
            {active === "isopycnal" && <IsopycnalTSDiagram profiles={profiles} onContextChange={handleContextChange} />}
            {active === "section" && <SectionPlot profiles={profiles} onContextChange={handleContextChange} />}
            {active === "hovmoller" && <HovmollerDiagram profiles={profiles} onContextChange={handleContextChange} />}
            {active === "svp" && <SoundVelocityProfile profiles={profiles} onContextChange={handleContextChange} />}
            {active === "mld" && <MixedLayerDepth profiles={profiles} onContextChange={handleContextChange} />}
            {active === "stats" && <AdvancedStatistics projectId={projectId} />}
          </div>
        </div>

        {isChatOpen && (
          <div className="w-80 lg:w-96 shrink-0 h-[calc(100vh-200px)] sticky top-6">
            <AnalyticsChatPanel
              projectId={projectId}
              projectName="Copilot"
              context={currentContext}
              onClose={() => setIsChatOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
