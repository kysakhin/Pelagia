import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";

export default async function BasicStatistics({ projectId }: { projectId: number }) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const rows = await sql`
    SELECT
      COUNT(*) AS sample_count,
      AVG(COALESCE(m.temperature_adjusted, m.temperature)) AS avg_temp,
      AVG(COALESCE(m.salinity_adjusted, m.salinity)) AS avg_salinity,
      AVG(COALESCE(m.pressure_adjusted, m.pressure)) AS avg_pressure,
      STDDEV_SAMP(COALESCE(m.temperature_adjusted, m.temperature)) AS std_temp,
      STDDEV_SAMP(COALESCE(m.salinity_adjusted, m.salinity)) AS std_salinity,
      STDDEV_SAMP(COALESCE(m.pressure_adjusted, m.pressure)) AS std_pressure,
      CORR(COALESCE(m.temperature_adjusted, m.temperature), COALESCE(m.salinity_adjusted, m.salinity)) AS corr_ts,
      CORR(COALESCE(m.temperature_adjusted, m.temperature), COALESCE(m.pressure_adjusted, m.pressure)) AS corr_tp,
      CORR(COALESCE(m.salinity_adjusted, m.salinity), COALESCE(m.pressure_adjusted, m.pressure)) AS corr_sp
    FROM files f
    JOIN projects pr ON pr.project_id = f.project_id
    JOIN profiles p ON p.file_id = f.file_id
    JOIN measurements m ON m.profile_id = p.profile_id
    WHERE f.project_id = ${projectId} AND pr.user_id = ${userId}
  `;

  const s = rows[0];
  const f = (v: unknown, d = 3) => (v == null ? "N/A" : Number(v).toFixed(d));

  return (
    <div className="space-y-5">
      <div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-0.5 bg-[#DDE1E6] border border-[#DDE1E6]">
          <div className="bg-white p-5">
            <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-1">Samples</p>
            <p className="text-2xl font-light text-[#1A1F26]">{vToCount(s.sample_count)}</p>
          </div>
          <div className="bg-white p-5">
            <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-1">Avg Temp</p>
            <p className="text-2xl font-light text-[#1A1F26]">{f(s.avg_temp, 2)} °C</p>
          </div>
          <div className="bg-white p-5">
            <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-1">Avg Salinity</p>
            <p className="text-2xl font-light text-[#1A1F26]">{f(s.avg_salinity, 2)} PSU</p>
          </div>
          <div className="bg-white p-5">
            <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-1">Avg Pressure</p>
            <p className="text-2xl font-light text-[#1A1F26]">{f(s.avg_pressure, 0)} dbar</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-0.5 bg-[#DDE1E6] border border-[#DDE1E6]">
        <div className="bg-white p-5">
          <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-2">Std Deviation</p>
          <p className="text-sm text-[#3D4A58]">Temperature: {f(s.std_temp, 3)}</p>
          <p className="text-sm text-[#3D4A58]">Salinity: {f(s.std_salinity, 3)}</p>
          <p className="text-sm text-[#3D4A58]">Pressure: {f(s.std_pressure, 3)}</p>
        </div>
        <div className="bg-white p-5">
          <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-2">Quick Correlation</p>
          <p className="text-sm text-[#3D4A58]">Temp ↔ Salinity: {f(s.corr_ts, 3)}</p>
          <p className="text-sm text-[#3D4A58]">Temp ↔ Pressure: {f(s.corr_tp, 3)}</p>
          <p className="text-sm text-[#3D4A58]">Salinity ↔ Pressure: {f(s.corr_sp, 3)}</p>
        </div>
        <div className="bg-white p-5">
          <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-2">Interpretation</p>
          <p className="text-sm text-[#3D4A58] leading-relaxed">
            Use this section for quick descriptive checks. Move to Advanced Statistics for inferential tests,
            robust correlation choices, regression diagnostics, and trend/normality bundles.
          </p>
        </div>
      </div>
    </div>
  );
}

function vToCount(v: unknown) {
  if (v == null) return "0";
  return Number(v).toLocaleString();
}
