import { describe, expect, it } from "vitest";
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";
import { fixGeometry, splitRingAtAntimeridian } from "./worldMap";
import { splitTrack } from "./buildEChartsOption";

const crosses = (r: number[][]) =>
  r.some((p, i) => i > 0 && Math.abs(p[0] - r[i - 1][0]) > 180);

describe("splitRingAtAntimeridian", () => {
  it("leaves normal rings alone", () => {
    const ring = [[0, 0], [10, 0], [10, 10], [0, 0]];
    expect(splitRingAtAntimeridian(ring)).toEqual([ring]);
  });

  it("splits a ring that crosses twice into one ring per side", () => {
    const ring = [[170, 60], [180, 61], [-180, 61], [-170, 62], [-180, 63], [180, 63], [170, 60]];
    const parts = splitRingAtAntimeridian(ring);
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(crosses(p)).toBe(false);
  });

  it("removes every stripe-causing crossing from the real world map (except the pole edge)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fc = feature(land110 as any, (land110 as any).objects.land) as any;
    for (const f of fc.features) {
      const g = fixGeometry(f.geometry) as { coordinates: number[][][][] };
      for (const [outer] of g.coordinates) {
        // The only remaining crossing allowed is Antarctica's closing edge along -90°.
        const bad = outer.filter(
          (p, i) => i > 0 && Math.abs(p[0] - outer[i - 1][0]) > 180 && Math.abs(p[1]) !== 90
        );
        expect(bad).toEqual([]);
      }
    }
  });
});

describe("splitTrack", () => {
  it("keeps a plausible drift track together", () => {
    // ~30 km steps
    const t: [number, number][] = [[70, -40], [70.3, -40.1], [70.6, -40.2]];
    expect(splitTrack(t)).toEqual([t]);
  });

  it("breaks the track at implausible jumps between floats", () => {
    const t: [number, number][] = [[70, -40], [70.3, -40.1], [-30, 10], [-30.2, 10.1]];
    expect(splitTrack(t)).toHaveLength(2);
  });

  it("drops isolated single points", () => {
    expect(splitTrack([[0, 0], [100, 50]])).toEqual([]);
  });
});
