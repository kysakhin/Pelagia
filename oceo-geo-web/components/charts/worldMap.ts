// Lazily registers a low-resolution world land map with ECharts so the `map`
// chart type can draw float tracks. The TopoJSON (Natural Earth 110m land,
// public domain, ~50 KB) is only downloaded the first time a map is shown.

import * as echarts from "echarts";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { WORLD_MAP_NAME } from "./buildEChartsOption";

let registration: Promise<void> | null = null;

type Ring = number[][];

const sideOf = (lon: number) => (lon >= 0 ? 1 : -1);

/**
 * Natural Earth rings that cross the antimeridian (Antarctica, Chukotka,
 * Fiji, Wrangel Island) jump between +180 and -180, which an
 * equirectangular projection draws as stripes across the whole map. Split
 * such rings into separate rings on each side of the line; a ring that wraps
 * a pole (odd number of crossings) is closed along the ±180 meridian and the
 * pole instead.
 */
export function splitRingAtAntimeridian(ring: Ring): Ring[] {
  const jumps: number[] = [];
  for (let i = 1; i < ring.length; i++) {
    if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) jumps.push(i);
  }
  if (jumps.length === 0) return [ring];

  if (jumps.length % 2 === 1) {
    // Pole-wrapping ring: rotate to start just after the crossing, then close
    // via the meridian edges and the pole.
    const j = jumps[0];
    const rotated = [...ring.slice(j), ...ring.slice(1, j)];
    const first = rotated[0];
    const last = rotated[rotated.length - 1];
    const meanLat = rotated.reduce((acc, p) => acc + p[1], 0) / rotated.length;
    const pole = meanLat < 0 ? -90 : 90;
    return [[
      ...rotated,
      [sideOf(last[0]) * 180, last[1]],
      [sideOf(last[0]) * 180, pole],
      [sideOf(first[0]) * 180, pole],
      [sideOf(first[0]) * 180, first[1]],
    ]];
  }

  // Even crossings: cut into runs, then join the runs on each side. The last
  // run continues into the first one (rings are cyclic).
  const cuts = [0, ...jumps, ring.length];
  const runs = cuts.slice(0, -1).map((c, i) => ring.slice(c, cuts[i + 1]));
  runs[0] = [...runs[runs.length - 1], ...runs[0]];
  runs.pop();
  const bySide = new Map<number, Ring>();
  for (const run of runs) {
    // Every run (after the merge above) starts right after a crossing, so its
    // first point sits near ±180 with an unambiguous sign. (A middle point is
    // NOT safe: Afro-Eurasia's run passes through negative longitudes.)
    const side = sideOf(run[0][0]);
    bySide.set(side, [...(bySide.get(side) ?? []), ...run]);
  }
  return Array.from(bySide.values()).filter((r) => r.length >= 3);
}

interface LandGeometry {
  type: string;
  coordinates: Ring[] | Ring[][];
}

/** Returns a MultiPolygon with antimeridian-crossing outer rings split. */
function fixGeometry(geometry: LandGeometry): LandGeometry {
  const polygons: Ring[][] =
    geometry.type === "Polygon"
      ? [geometry.coordinates as Ring[]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as Ring[][])
        : [];
  if (polygons.length === 0) return geometry;
  const out: Ring[][] = [];
  for (const [outer, ...holes] of polygons) {
    const parts = splitRingAtAntimeridian(outer);
    parts.forEach((part, i) => out.push(i === 0 ? [part, ...holes] : [part]));
  }
  return { type: "MultiPolygon", coordinates: out };
}

export { fixGeometry };

export function ensureWorldMap(): Promise<void> {
  if (echarts.getMap(WORLD_MAP_NAME)) return Promise.resolve();
  if (!registration) {
    registration = import("world-atlas/land-110m.json")
      .then((mod) => {
        const topology = (mod.default ?? mod) as unknown as Topology<{
          land: GeometryCollection;
        }>;
        const land = feature(topology, topology.objects.land) as unknown as {
          type: "FeatureCollection";
          features: { type: "Feature"; properties: object; geometry: LandGeometry }[];
        };
        const cleaned = {
          ...land,
          features: land.features.map((f) => ({ ...f, geometry: fixGeometry(f.geometry) })),
        };
        // echarts expects a GeoJSON FeatureCollection.
        echarts.registerMap(
          WORLD_MAP_NAME,
          cleaned as unknown as Parameters<typeof echarts.registerMap>[1]
        );
      })
      .catch((err) => {
        registration = null; // allow a retry on next render
        throw err;
      });
  }
  return registration;
}
