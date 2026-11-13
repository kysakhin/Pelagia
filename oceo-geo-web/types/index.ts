export interface FileScanResult {
  filename: string;
  status: "success" | "error";
  error?: string;
  core_params?: string[];
  bgc_params?: string[];
  available_extras?: string[];
}

export interface ScanSummary {
  core_params: string[];
  bgc_params: string[];
  available_extras: string[];
  files_scanned: number;
  files_failed: number;
  file_errors: { file: string; error: string }[];
}

export interface FileResult {
  filename: string;
  status: "success" | "error";
  error?: string;
  file_id?: number;
  profiles_inserted?: number;
  measurements_inserted?: number;
}

// ── Chart types ─────────────────────────────────────────────────────────────
// Mirrors the backend ChartSpec schema in implementation_plan.md §3.3.
// The AI emits a chart_spec referencing a SQL result_id; the backend
// ChartPayloadService validates it and composes { spec, data, meta }.

export type ChartType =
  | "scatter"
  | "line"
  | "bar"
  | "histogram"
  | "heatmap"
  | "pie"
  | "area"
  | "boxplot"
  | "map";      // x = longitude, y = latitude

export interface ChartEncoding {
  x?: string;       // must match a column id from the SQL result metadata
  y?: string;       // must match a column id from the SQL result metadata
  z?: string;       // heatmap or 3D-style encodings
  color?: string;
  series?: string;
}

export interface ChartSpec {
  result_id: string;
  chart_type: ChartType;
  title: string;
  encoding: ChartEncoding;
  labels?: {
    x?: string;
    y?: string;
    z?: string;
    color?: string;
  };
  options?: {
    invert_x?: boolean;
    invert_y?: boolean;     // set true for depth/pressure on Y (deeper = larger)
    show_legend?: boolean;
    show_regression?: boolean;
    bin_count?: number;     // histogram only
    show_track?: boolean;   // map only: connect points in row order (default true)
  };
}

export interface ChartPayloadMeta {
  row_count: number;
  displayed_row_count: number;
  truncated: boolean;
}

export interface ChartPayload {
  spec: ChartSpec;
  data: Record<string, unknown>[];
  meta?: ChartPayloadMeta;
}

// Column metadata returned by the SQL tool (run_sql_query result.columns).
export interface ColumnMeta {
  id: string;
  type: "number" | "integer" | "string" | "boolean" | "datetime" | "object";
}

// ── Ontology provenance (see OceoGeoAPI/core/concept_linker.py) ────────────
export interface ConceptRef {
  id: string;
  label: string;
  kind: "variable" | "coordinate" | "derived" | "feature" | "water_mass" | "region";
}

/** What the answer was based on: matched concepts, methods, data warnings. */
export interface AnswerMetadata {
  concepts?: ConceptRef[];
  methods?: string[];
  quality_flags?: string[];
}
