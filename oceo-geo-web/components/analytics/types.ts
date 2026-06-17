export interface DataPoint {
  profile_id: number;
  latitude: number | null;
  longitude: number | null;
  observed_at: string | null;
  cycle_number: number | null;
  pressure: number | null;
  temperature: number | null;
  salinity: number | null;
}

export interface Profile {
  profile_id: number;
  latitude: number;
  longitude: number;
  observed_at: string;
  cycle_number: number | null;
  measurements: Measurement[];
}

export interface Measurement {
  pressure: number;
  temperature: number;
  salinity: number;
}

export interface ChartContext {
  chartId: string;
  chartLabel: string;
  variables: string[];
  stats: ChartStat[];
  depthRange?: [number, number];
  timeRange?: [string, string];
  profileCount?: number;
}

// A single observable variable's computed bounds — charts self-declare these
export interface ChartStat {
  variable: string;
  min: number;
  max: number;
  mean: number;
  unit: string;
}

// Callback type that chart components accept to report their observable context upward
export type OnContextChange = (stats: ChartStat[]) => void;
