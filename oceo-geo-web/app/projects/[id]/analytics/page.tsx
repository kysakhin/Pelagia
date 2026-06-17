import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import AdvancedAnalytics from "@/components/analytics/AdvancedAnalytics";

export default async function AdvancedAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }> | { id: string };
  searchParams?: Promise<{ view?: string }> | { view?: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/");
  }

  const resolvedParams = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams || {});
  const projectId = Number(resolvedParams.id);
  const allowedViews = [
    "animation",
    "heatmap",
    "contours",
    "isopycnal",
    "section",
    "hovmoller",
    "svp",
    "mld",
    "stats",
  ];
  const initialView = allowedViews.includes(String(resolvedSearchParams.view))
    ? String(resolvedSearchParams.view)
    : undefined;

  if (isNaN(projectId)) {
    return <div className="text-center mt-20 text-gray-400">Invalid project ID</div>;
  }

  // Fetch project name and all measurement data in parallel
  const [accessCheck, chartData] = await Promise.all([
    sql`SELECT project_name FROM projects WHERE project_id = ${projectId} AND user_id = ${userId}`,
    sql`
      SELECT
        p.profile_id,
        p.latitude,
        p.longitude,
        p.observed_at::text as observed_at,
        p.cycle_number,
        COALESCE(m.pressure_adjusted, m.pressure)::float as pressure,
        COALESCE(m.temperature_adjusted, m.temperature)::float as temperature,
        COALESCE(m.salinity_adjusted, m.salinity)::float as salinity
      FROM files f
      JOIN projects pr ON pr.project_id = f.project_id
      JOIN profiles p ON p.file_id = f.file_id
      JOIN measurements m ON m.profile_id = p.profile_id
      WHERE f.project_id = ${projectId} AND pr.user_id = ${userId}
      ORDER BY p.observed_at, p.profile_id, COALESCE(m.pressure_adjusted, m.pressure)
    `,
  ]);

  if (accessCheck.length === 0) {
    redirect("/projects");
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-['Helvetica_Neue',Helvetica,Arial,sans-serif] pb-16">
      <div className="bg-white border-b border-[#C8CDD4] px-4 py-8 md:py-12">
        <div className="max-w-[1440px] mx-auto px-4 md:px-8">
          <Link
            href={`/projects/${projectId}?tab=charts`}
            className="text-[11px] uppercase tracking-widest text-[#7A8A9A] hover:text-[#4A87BE] transition mb-6 inline-flex items-center gap-2"
          >
            <span className="text-[#4A87BE]">←</span> Back to Project
          </Link>
          <div className="flex items-center gap-4">
             <div className="w-8 h-8 rounded outline outline-2 outline-offset-2 outline-transparent border-2 border-[#4A87BE] flex items-center justify-center shrink-0">
               <div className="w-2 h-2 bg-[#4A87BE]" />
             </div>
             <h1 className="text-3xl md:text-4xl font-light text-[#1A1F26]">
               <span className="text-[#3D4A58] opacity-60 mr-2">Advanced Analytics:</span>
               {accessCheck[0].project_name}
             </h1>
          </div>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-12">
        <AdvancedAnalytics
          data={JSON.parse(JSON.stringify(chartData))}
          projectId={projectId}
          initialView={initialView as
            | "animation"
            | "heatmap"
            | "contours"
            | "isopycnal"
            | "section"
            | "hovmoller"
            | "svp"
            | "mld"
            | "stats"
            | undefined}
        />
      </div>
    </div>
  );
}