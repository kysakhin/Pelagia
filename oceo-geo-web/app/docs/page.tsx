"use client";

export default function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">Chart Documentation</h1>

      <div className="space-y-8">
        <section>
          <h2 className="text-2xl font-semibold mb-4">Overview</h2>
          <p className="text-gray-700 mb-4">
            This application provides advanced oceanographic data visualization through various chart types.
            All charts are rendered using ECharts and display data from uploaded NetCDF files containing
            ocean profile measurements.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">Chart Types</h2>

          <div className="space-y-6">
            <div className="border-l-4 border-blue-500 pl-4">
              <h3 className="text-xl font-medium mb-2">Profile Animation</h3>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong> Animated line/scatter plots<br/>
                <strong>Purpose:</strong> Shows temporal evolution of individual ocean profiles<br/>
                <strong>Data:</strong> Temperature vs depth, salinity vs depth, or temperature-salinity diagrams
              </p>
              <p className="text-gray-600 text-sm">
                Cycles through profiles over time with play/pause controls. Displays measurements from
                pressure, temperature, and salinity data grouped by profile ID and observation time.
              </p>
            </div>

            <div className="border-l-4 border-green-500 pl-4">
              <h3 className="text-xl font-medium mb-2">Depth Heatmaps</h3>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong> 2D heatmap<br/>
                <strong>Purpose:</strong> Visualizes temperature or salinity distribution across depth and time<br/>
                <strong>Data:</strong> Interpolated temperature/salinity values on a depth-time grid
              </p>
              <p className="text-gray-600 text-sm">
                Uses linear interpolation to create a regular grid from profile measurements.
                Color-coded with blue-to-red gradient for temperature, green-to-blue for salinity.
              </p>
            </div>

            <div className="border-l-4 border-purple-500 pl-4">
              <h3 className="text-xl font-medium mb-2">Depth Contours</h3>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong> Contour heatmap<br/>
                <strong>Purpose:</strong> Shows temperature or salinity with discrete color levels<br/>
                <strong>Data:</strong> Same as depth heatmaps but with piecewise color mapping
              </p>
              <p className="text-gray-600 text-sm">
                Divides data range into 12 levels with distinct colors. Useful for identifying
                specific value ranges and boundaries in the data.
              </p>
            </div>

            <div className="border-l-4 border-red-500 pl-4">
              <h3 className="text-xl font-medium mb-2">T-S Isopycnals</h3>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong> Scatter plot with overlay lines<br/>
                <strong>Purpose:</strong> Displays temperature-salinity relationships with density surfaces<br/>
                <strong>Data:</strong> Temperature and salinity measurements colored by depth
              </p>
              <p className="text-gray-600 text-sm">
                Points represent individual measurements, colored by pressure (depth).
                Overlaid dashed lines show isopycnal curves (constant potential density)
                calculated using EOS-80 equation.
              </p>
            </div>

            <div className="border-l-4 border-orange-500 pl-4">
              <h3 className="text-xl font-medium mb-2">Section / Transect</h3>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong> Cross-sectional heatmap<br/>
                <strong>Purpose:</strong> Shows property gradients along spatial paths<br/>
                <strong>Data:</strong> Temperature or salinity along distance vs depth
              </p>
              <p className="text-gray-600 text-sm">
                Profiles are sorted by latitude or longitude and connected by great-circle distance.
                Displays horizontal variability and vertical structure in cross-section.
              </p>
            </div>

            <div className="border-l-4 border-teal-500 pl-4">
              <h3 className="text-xl font-medium mb-2">Hovmoller Diagram</h3>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong> Space-time heatmap<br/>
                <strong>Purpose:</strong> Shows how properties vary over time and space at fixed depth<br/>
                <strong>Data:</strong> Temperature or salinity at selected depth across space and time
              </p>
              <p className="text-gray-600 text-sm">
                Displays data on latitude or longitude vs time axes. Depth is selectable via slider.
                Useful for tracking propagating features like waves or seasonal changes.
              </p>
            </div>

            <div className="border-l-4 border-indigo-500 pl-4">
              <h3 className="text-xl font-medium mb-2">Sound Velocity Profile</h3>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong> Multi-line plot<br/>
                <strong>Purpose:</strong> Shows computed sound speed variation with depth<br/>
                <strong>Data:</strong> Sound velocity calculated from T, S, and pressure
              </p>
              <p className="text-gray-600 text-sm">
                Uses Mackenzie (1981) empirical equation to compute sound velocity from
                temperature, salinity, and depth measurements. Displays up to 10 profiles
                with different colors.
              </p>
            </div>

            <div className="border-l-4 border-pink-500 pl-4">
              <h3 className="text-xl font-medium mb-2">Mixed Layer Depth</h3>
              <p className="text-gray-700 mb-2">
                <strong>Type:</strong> Time series line plot<br/>
                <strong>Purpose:</strong> Shows evolution of ocean mixing layer over time<br/>
                <strong>Data:</strong> Mixed layer depth computed from temperature profiles
              </p>
              <p className="text-gray-600 text-sm">
                Calculated using temperature threshold method (0.2°C from surface reference).
                Displays depth where temperature deviates significantly from surface value,
                indicating mixing intensity.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">How to Read the Charts</h2>
          <p className="text-gray-700 mb-4">
            Each chart uses consistent visual conventions that are important to understand when interpreting the data.
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-1 mb-6">
            <li>
              <strong>Axes:</strong> X and Y axes include units (e.g., dbar for depth, °C for temperature, PSU for salinity).
              Depth is plotted with the axis inverted (surface at the top, deeper values downward) for oceanographic convention.
            </li>
            <li>
              <strong>Color Scales:</strong> Heatmaps and contour plots use color gradients to represent value magnitude.
              A colorbar or legend indicates mapping (e.g., blue = cold/low, red = warm/high).
            </li>
            <li>
              <strong>Tooltips:</strong> Hover over points or cells to see exact values and metadata (depth, time, profile).
              Tooltips typically show both variable value and context (e.g., depth or time).
            </li>
            <li>
              <strong>Interactive Controls:</strong> Some charts support mode selection, play/pause animation, depth sliders, and profile selection.
              These controls change the data shown without altering the underlying calculations.
            </li>
            <li>
              <strong>Units and Conventions:</strong> Pressure is treated as depth (dbar ≈ meters). Salinity is in PSU; temperature is in °C.
              These conventions match standard oceanographic practice.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">Data Processing</h2>
          <p className="text-gray-700 mb-4">
            All charts process data from NetCDF files containing oceanographic profiles:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Profiles are grouped by ID and sorted chronologically</li>
            <li>Measurements are filtered for valid pressure, temperature, and salinity values</li>
            <li>Linear interpolation fills gaps for gridded visualizations</li>
            <li>Geographic distances use Haversine formula</li>
            <li>Ocean physics calculations use established empirical formulas</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">Chart Configuration</h2>
          <p className="text-gray-700 mb-4">
            Common configuration elements across all charts:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li><strong>Axes:</strong> Consistent labeling with units (dbar, °C, PSU, km, m/s)</li>
            <li><strong>Colors:</strong> Themed gradients appropriate for each variable type</li>
            <li><strong>Tooltips:</strong> Detailed hover information with formatted values</li>
            <li><strong>Scales:</strong> Automatic scaling with appropriate ranges</li>
            <li><strong>Interactivity:</strong> Hover effects, zoom, and data brushing where applicable</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">Integration</h2>
          <p className="text-gray-700 mb-4">
            Charts are integrated into the Advanced Analytics component with:
          </p>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            <li>Sidebar navigation for chart selection</li>
            <li>Responsive layout adapting to container size</li>
            <li>Shared data processing utilities in oceanUtils.ts</li>
            <li>TypeScript interfaces for type safety</li>
            <li>Client-side rendering with React and ECharts</li>
          </ul>
        </section>
      </div>
    </div>
  );
}