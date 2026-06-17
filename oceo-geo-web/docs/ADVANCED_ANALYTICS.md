# Advanced Analytics -- Development Notes

## Implemented Charts

1. **Profile Animation** -- Time-based animated playback of Temp vs Depth / Salinity vs Depth / T-S per profile, with play/pause and seek slider.
2. **Depth Heatmaps** -- 2D continuous-gradient heatmap with time on X, depth on Y, color for temperature or salinity.
3. **Depth Contours** -- Same data as heatmap but rendered with piecewise/stepped color bands for a filled-contour appearance.
4. **T-S Diagram with Isopycnal Overlays** -- Scatter of all data points (colored by depth) with computed sigma-0 density curves using EOS-80.
5. **Section / Transect** -- Cross-section along the dominant geographic direction showing variable vs depth vs distance.
6. **Hovmoller Diagram** -- Time-space diagram at a user-selected depth level, with latitude/longitude and variable toggles.
7. **Sound Velocity Profiles (SVP)** -- Computed via Mackenzie (1981) empirical equation from T, S, P. Overlays up to 10 profiles.
8. **Mixed Layer Depth (MLD) Tracking** -- Temperature threshold method (delta-T = 0.2 C from surface reference), plotted over time.

## Physics References

| Computation          | Formula / Source                                  |
|----------------------|---------------------------------------------------|
| Potential Density    | UNESCO EOS-80 (sigma-0 at surface pressure)       |
| Sound Velocity       | Mackenzie (1981) empirical equation                |
| Mixed Layer Depth    | Temperature threshold method (delta-T > 0.2 C)    |
| Haversine Distance   | Standard spherical Earth formula (R = 6371 km)     |

## Planned Features (Not Yet Implemented)

### 3D Ocean Plot

A WebGL-based 3D scatter/volume visualization where:
- **X, Y, Z axes:** Latitude, Longitude, Depth
- **Color:** Temperature or Salinity (gradient)
- **Interactivity:** Rotate, zoom, hover for values
- **Controls:** Radio buttons to toggle between temperature and salinity coloring

**Recommended approach:**
- [Deck.gl](https://deck.gl/) for GPU-accelerated large-scale point clouds
- Or [Three.js](https://threejs.org/) + [react-three-fiber](https://docs.pmnd.rs/react-three-fiber/) for custom 3D scenes
- Alternatively, ECharts GL extension (`echarts-gl`) for simpler integration

**Why deferred:** 3D rendering requires WebGL setup, significant bundle size increase, and careful performance tuning. Best implemented as a standalone module once the 2D analytics are stabilised.

### Geographic Map Visualization

A Leaflet-based interactive map showing profile locations, colored by variable values. The `react-leaflet` library has been selected for when this is implemented.

## Data Volume Recommendations

Currently, the Advanced Analytics page fetches **all measurements** for a project without limits. This works fine for small-to-medium datasets (under 50,000 rows). For larger projects:

### Short-term mitigations
- Add server-side sampling (e.g., `TABLESAMPLE` or `ORDER BY RANDOM() LIMIT N`)
- Implement progressive loading -- fetch overview aggregates first, then load detail on demand

### Long-term strategy
- **Materialised views** for pre-computed aggregates (daily averages, depth-binned stats)
- **Server-side rendering** of heavy charts (generate chart images on the backend)
- **Web Workers** for client-side computation offloading
- **Virtual scrolling** for profile lists in the animation controller

### Approximate performance thresholds

| Rows        | Expected Behaviour                        |
|-------------|-------------------------------------------|
| < 10,000    | Instant rendering                         |
| 10k - 50k   | Slight delay, still usable              |
| 50k - 200k  | Noticeable lag, consider sampling        |
| > 200k      | Requires server-side aggregation         |

## No Database Changes Required

All implemented and planned charts derive their data from the existing schema columns:
- `profiles`: profile_id, latitude, longitude, observed_at, cycle_number
- `measurements`: pressure(_adjusted), temperature(_adjusted), salinity(_adjusted)

Computed quantities (density, sound velocity, MLD) are all calculated client-side from these existing columns.
