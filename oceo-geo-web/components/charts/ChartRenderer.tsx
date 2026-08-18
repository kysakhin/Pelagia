"use client";

import { Component, ErrorInfo, ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import type { ChartPayload } from "@/types";
import { buildEChartsOption } from "./buildEChartsOption";

// ── Error boundary ──────────────────────────────────────────────────────────
// If the chart spec is malformed, the builder throws, or the data doesn't
// contain the referenced fields, the boundary renders a graceful message and
// the raw spec for debugging — it never crashes the chat UI.
// See implementation_plan.md §4.1 / §7.4.

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error, retry: () => void) => ReactNode;
}
interface ErrorBoundaryState {
  error: Error | null;
}

class ChartErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("ChartRenderer error:", error, info);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.retry);
    }
    return this.props.children;
  }
}

// ── Fallback UI ─────────────────────────────────────────────────────────────

function ErrorFallback({
  error,
  payload,
}: {
  error: Error;
  payload: ChartPayload;
}) {
  return (
    <div
      style={{
        border: "1px solid #E8C8C8",
        background: "#FDF4F4",
        color: "#8A3A3A",
        padding: "16px",
        borderRadius: "2px",
        fontSize: "13px",
        fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "8px" }}>
        Could not render chart
      </div>
      <div style={{ marginBottom: "8px", color: "#7A2A2A" }}>{error.message}</div>
      <details style={{ marginTop: "8px" }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#8A3A3A",
          }}
        >
          Show raw chart spec
        </summary>
        <pre
          style={{
            marginTop: "8px",
            background: "#F0F2F4",
            border: "1px solid #DDE1E6",
            borderRadius: "2px",
            padding: "12px",
            fontSize: "12px",
            fontFamily: "monospace",
            color: "#3D4A58",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(payload.spec, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ── ChartRenderer ───────────────────────────────────────────────────────────

export interface ChartRendererProps {
  payload: ChartPayload;
  // Optional override for the ECharts style (height, etc.)
  style?: React.CSSProperties;
}

export default function ChartRenderer({ payload, style }: ChartRendererProps) {
  const defaultStyle: React.CSSProperties = {
    width: "100%",
    height: "380px",
    ...style,
  };

  return (
    <ChartErrorBoundary
      fallback={(error) => (
        <ErrorFallback error={error} payload={payload} />
      )}
    >
      <ReactECharts
        option={buildEChartsOption(payload)}
        style={defaultStyle}
        opts={{ renderer: "canvas" }}
        notMerge={true}
        lazyUpdate={true}
      />
    </ChartErrorBoundary>
  );
}
