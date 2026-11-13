"use client";

import { Component, ErrorInfo, ReactNode, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { ChartPayload } from "@/types";
import { buildEChartsOption } from "./buildEChartsOption";
import { ensureWorldMap } from "./worldMap";

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
  const columns = payload.data.length > 0 ? Object.keys(payload.data[0]) : [];

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
      {columns.length > 0 && (
        <div style={{ marginTop: "12px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", color: "#3D4A58" }}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    style={{
                      borderBottom: "1px solid #DDE1E6",
                      fontSize: "11px",
                      padding: "6px 8px",
                      textAlign: "left",
                      textTransform: "uppercase",
                    }}
                  >
                    {column.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.data.slice(0, 10).map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td
                      key={column}
                      style={{
                        borderBottom: "1px solid #F0F2F4",
                        fontFamily: "monospace",
                        fontSize: "12px",
                        padding: "6px 8px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row[column] === null || row[column] === undefined
                        ? "null"
                        : String(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ color: "#7A8A9A", fontSize: "11px", marginTop: "8px" }}>
            Showing {Math.min(payload.data.length, 10)} of {payload.data.length} rows.
          </div>
        </div>
      )}
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

function ChartCanvas({ payload, style }: ChartRendererProps) {
  const option = useMemo(() => buildEChartsOption(payload), [payload]);

  return (
    <ReactECharts
      option={option}
      style={style}
      opts={{ renderer: "canvas" }}
      notMerge={true}
      lazyUpdate={true}
    />
  );
}

// Map charts need the world geometry registered first; it is fetched lazily
// so non-map charts never pay for it. Errors propagate to the boundary.
function MapCanvas({ payload, style }: ChartRendererProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureWorldMap()
      .then(() => !cancelled && setReady(true))
      .catch((err: unknown) =>
        !cancelled && setError(err instanceof Error ? err : new Error(String(err)))
      );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) throw new Error(`Could not load world map: ${error.message}`);
  if (!ready) {
    return (
      <div
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#7A8A9A",
          fontSize: "12px",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        Loading map…
      </div>
    );
  }
  return <ChartCanvas payload={payload} style={style} />;
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
      {payload.spec.chart_type === "map" ? (
        <MapCanvas payload={payload} style={{ ...defaultStyle, height: style?.height ?? "440px" }} />
      ) : (
        <ChartCanvas payload={payload} style={defaultStyle} />
      )}
    </ChartErrorBoundary>
  );
}
