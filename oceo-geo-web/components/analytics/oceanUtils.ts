import type { DataPoint, Profile, Measurement } from "./types";

// ─── Data Grouping ──────────────────────────────────────────────────────

export function groupByProfile(data: DataPoint[]): Profile[] {
  const map = new Map<number, { meta: Omit<Profile, "measurements">; measurements: Measurement[] }>();

  for (const d of data) {
    if (d.pressure == null || (d.temperature == null && d.salinity == null)) continue;

    if (!map.has(d.profile_id)) {
      map.set(d.profile_id, {
        meta: {
          profile_id: d.profile_id,
          latitude: d.latitude ?? 0,
          longitude: d.longitude ?? 0,
          observed_at: d.observed_at ?? "",
          cycle_number: d.cycle_number,
        },
        measurements: [],
      });
    }

    map.get(d.profile_id)!.measurements.push({
      pressure: d.pressure!,
      temperature: d.temperature ?? NaN,
      salinity: d.salinity ?? NaN,
    });
  }

  return Array.from(map.values())
    .map(({ meta, measurements }) => ({
      ...meta,
      measurements: measurements.sort((a, b) => a.pressure - b.pressure),
    }))
    .filter((p) => p.measurements.length > 0)
    .sort((a, b) => {
      if (!a.observed_at && !b.observed_at) return 0;
      if (!a.observed_at) return 1;
      if (!b.observed_at) return 1;
      return new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime();
    });
}

// ─── Physics: Potential Density (EOS-80, σ₀) ───────────────────────────

export function potentialDensity(T: number, S: number): number {
  const rho_pure =
    999.842594 +
    6.793952e-2 * T -
    9.09529e-3 * T ** 2 +
    1.001685e-4 * T ** 3 -
    1.120083e-6 * T ** 4 +
    6.536332e-9 * T ** 5;

  const A =
    8.24493e-1 -
    4.0899e-3 * T +
    7.6438e-5 * T ** 2 -
    8.2467e-7 * T ** 3 +
    5.3875e-9 * T ** 4;

  const B = -5.72466e-3 + 1.0227e-4 * T - 1.6546e-6 * T ** 2;
  const C = 4.8314e-4;

  return rho_pure + A * S + B * Math.pow(S, 1.5) + C * S ** 2 - 1000;
}

// ─── Physics: Sound Velocity (Mackenzie 1981) ───────────────────────────

export function soundVelocity(T: number, S: number, D: number): number {
  return (
    1448.96 +
    4.591 * T -
    5.304e-2 * T ** 2 +
    2.374e-4 * T ** 3 +
    1.34 * (S - 35) +
    1.63e-2 * D +
    1.675e-7 * D ** 2 -
    1.025e-2 * T * (S - 35) -
    7.139e-13 * T * D ** 3
  );
}

// ─── Physics: Mixed Layer Depth (temperature threshold) ─────────────────

export function mixedLayerDepth(measurements: Measurement[], threshold = 0.2): number | null {
  const sorted = [...measurements].sort((a, b) => a.pressure - b.pressure);
  if (sorted.length < 2) return null;

  const refTemp = sorted[0].temperature;
  if (isNaN(refTemp)) return null;

  for (let i = 1; i < sorted.length; i++) {
    if (!isNaN(sorted[i].temperature) && Math.abs(sorted[i].temperature - refTemp) > threshold) {
      return sorted[i].pressure;
    }
  }

  return null;
}

// ─── Geometry: Haversine Distance (km) ──────────────────────────────────

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Interpolation ──────────────────────────────────────────────────────

export function linearInterpolate(
  measurements: Measurement[],
  targetDepth: number,
  variable: "temperature" | "salinity"
): number | null {
  const valid = measurements.filter((m) => !isNaN(m[variable])).sort((a, b) => a.pressure - b.pressure);

  if (valid.length === 0) return null;
  if (valid.length === 1) {
    return Math.abs(valid[0].pressure - targetDepth) < 100 ? valid[0][variable] : null;
  }
  if (targetDepth <= valid[0].pressure) return valid[0][variable];
  if (targetDepth >= valid[valid.length - 1].pressure) return valid[valid.length - 1][variable];

  for (let i = 0; i < valid.length - 1; i++) {
    if (valid[i].pressure <= targetDepth && valid[i + 1].pressure >= targetDepth) {
      const range = valid[i + 1].pressure - valid[i].pressure;
      if (range === 0) return valid[i][variable];
      const t = (targetDepth - valid[i].pressure) / range;
      return valid[i][variable] + t * (valid[i + 1][variable] - valid[i][variable]);
    }
  }

  return null;
}

// ─── Grid Building for Heatmaps ─────────────────────────────────────────

export function buildHeatmapGrid(
  profiles: Profile[],
  variable: "temperature" | "salinity",
  numDepthBins = 50
): {
  data: [number, number, number][];
  xLabels: string[];
  yLabels: string[];
  min: number;
  max: number;
} {
  if (profiles.length === 0) return { data: [], xLabels: [], yLabels: [], min: 0, max: 0 };

  let minDepth = Infinity,
    maxDepth = -Infinity;
  for (const p of profiles) {
    for (const m of p.measurements) {
      if (m.pressure < minDepth) minDepth = m.pressure;
      if (m.pressure > maxDepth) maxDepth = m.pressure;
    }
  }

  const depthStep = (maxDepth - minDepth) / numDepthBins;
  const depthBins = Array.from({ length: numDepthBins }, (_, i) => minDepth + i * depthStep);

  const data: [number, number, number][] = [];
  let min = Infinity,
    max = -Infinity;

  const xLabels = profiles.map((p) =>
    new Date(p.observed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  );
  const yLabels = depthBins.map((d) => d.toFixed(0));

  profiles.forEach((profile, xi) => {
    depthBins.forEach((depth, yi) => {
      const val = linearInterpolate(profile.measurements, depth, variable);
      if (val !== null) {
        if (val < min) min = val;
        if (val > max) max = val;
        data.push([xi, yi, val]);
      }
    });
  });

  return { data, xLabels, yLabels, min, max };
}

// ─── ECharts Theme Shared Config ───────────────────────────────────

export const lightAxis = {
  axisLine: { lineStyle: { color: "#C8CDD4" } },
  axisLabel: { color: "#7A8A9A", fontSize: 11 },
  splitLine: { lineStyle: { color: "#E8EAED" } },
  nameTextStyle: { color: "#3D4A58", fontSize: 12 },
};

export const lightTitle = {
  textStyle: { color: "#1A1F26", fontSize: 15, fontWeight: "normal" as const },
};

export const lightTooltip = {
  backgroundColor: "rgba(255, 255, 255, 0.95)",
  borderColor: "#C8CDD4",
  textStyle: { color: "#1A1F26", fontSize: 12 },
};
