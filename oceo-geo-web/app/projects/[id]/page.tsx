import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import FileUpload from "@/components/FileUpload";
import ProjectTabs from "@/components/ProjectTabs";
import BasicCharts from "@/components/BasicCharts";
import BasicStatistics from "@/components/BasicStatistics";

export default async function ProjectDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }> | { id: string };
  searchParams?: Promise<{ tab?: string }> | { tab?: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/");
  }

  // Await params to support Next.js 15+ Server Components strictly
  const resolvedParams = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams || {});
  
  const projectId = Number(resolvedParams.id);
  const activeTab = resolvedSearchParams.tab || "overview";

  if (isNaN(projectId)) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-500">
        Invalid project ID
      </div>
    );
  }

  // Execute RLS setup and our heavy aggregation in a single transaction
  const txResults = await sql.transaction([
    sql`SELECT set_config('app.current_user_id', ${userId}, true)`,
    
    // 1. Fetch Project Details
    sql`SELECT * FROM projects WHERE project_id = ${projectId} AND user_id = ${userId}`,

    // 2. Aggregate Data Statistics
    // Uses COALESCE to prefer adjusted values over raw values
    sql`
      SELECT 
        COUNT(DISTINCT p.profile_id) as total_profiles,
        COUNT(m.measurement_id) as total_measurements,
        COUNT(DISTINCT p.latitude || ',' || p.longitude) as unique_locations,
        
        MIN(COALESCE(m.temperature_adjusted, m.temperature)) as min_temp,
        MAX(COALESCE(m.temperature_adjusted, m.temperature)) as max_temp,
        AVG(COALESCE(m.temperature_adjusted, m.temperature)) as avg_temp,
        
        MIN(COALESCE(m.salinity_adjusted, m.salinity)) as min_salinity,
        MAX(COALESCE(m.salinity_adjusted, m.salinity)) as max_salinity,
        AVG(COALESCE(m.salinity_adjusted, m.salinity)) as avg_salinity,
        
        MIN(COALESCE(m.pressure_adjusted, m.pressure)) as min_pressure,
        MAX(COALESCE(m.pressure_adjusted, m.pressure)) as max_pressure,
        AVG(COALESCE(m.pressure_adjusted, m.pressure)) as avg_pressure
      FROM files f
      JOIN projects pr ON pr.project_id = f.project_id
      JOIN profiles p ON p.file_id = f.file_id
      JOIN measurements m ON m.profile_id = p.profile_id
      WHERE f.project_id = ${projectId} AND pr.user_id = ${userId}
    `,
  ]);

  const projectRows = txResults[1];
  const statsRows = txResults[2];

  if (!projectRows || projectRows.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-800">Project Not Found</h2>
          <p className="text-gray-500 mt-2 mb-6">It may have been deleted or you do not have access.</p>
          <Link href="/projects" className="text-blue-600 hover:underline">
            ← Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  const project = projectRows[0];
  const stats = statsRows[0];

  function formatValue(value: string | number | null, unit: string, decimals = 2) {
    if (value === null || value === undefined) return "N/A";
    const num = Number(value);
    return `${num.toFixed(decimals)} ${unit}`;
  }

  function formatCount(value: string | number | null) {
    if (value === null || value === undefined) return "0";
    return Number(value).toLocaleString();
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] pb-16 font-['Helvetica_Neue',Helvetica,Arial,sans-serif]">
      {/* Header section */}
      <div className="bg-white border-b border-[#C8CDD4] px-4 py-12 md:py-16">
        <div className="max-w-[1440px] mx-auto px-4 md:px-8">
          <Link href="/projects" className="text-[11px] uppercase tracking-widest text-[#7A8A9A] hover:text-[#4A87BE] transition mb-6 inline-block flex items-center gap-2">
            <span className="text-[#4A87BE]">←</span> Back to Workspace
          </Link>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h1 className="text-4xl md:text-[52px] font-light text-[#1A1F26] leading-tight">{project.project_name}</h1>
              {project.description && (
                <p className="font-serif text-[16px] text-[#3D4A58] mt-4 max-w-[700px] leading-relaxed">
                  {project.description}
                </p>
              )}
            </div>
            <div className="text-[12px] uppercase tracking-widest text-[#7A8A9A] flex flex-col items-start md:items-end gap-2 shrink-0">
              <span>PI <span className="text-[#1A1F26] ml-2 font-medium">{project.pi_name || "N/A"}</span></span>
              <span>Created <span className="text-[#1A1F26] ml-2 font-medium">{new Date(project.created_at).toLocaleDateString()}</span></span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 md:px-8 mt-12 space-y-8 flex flex-col lg:flex-row gap-12 items-start">
        
        {/* Main Dashboard Column */}
        <div className="flex-1 space-y-12 w-full min-w-0">
          <ProjectTabs projectId={projectId}>
            {activeTab === "overview" && (
              <div className="space-y-16 mt-8">
                {/* Overview Row */}
                <div>
                  <span className="text-[11px] uppercase tracking-widest text-[#2E6DA4] mb-6 block font-bold">Dataset Overview</span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-[2px] bg-[#DDE1E6] border border-[#DDE1E6] rounded-sm overflow-hidden">
                    <div className="bg-white p-8 hover:bg-[#EBEEF1] transition-colors">
                      <p className="text-[12px] uppercase tracking-wider text-[#7A8A9A] font-bold">Total Profiles</p>
                      <p className="text-[40px] font-light text-[#1A1F26] mt-2">{formatCount(stats.total_profiles)}</p>
                    </div>
                    <div className="bg-white p-8 hover:bg-[#EBEEF1] transition-colors">
                      <p className="text-[12px] uppercase tracking-wider text-[#7A8A9A] font-bold">Total Measurements</p>
                      <p className="text-[40px] font-light text-[#1A1F26] mt-2">{formatCount(stats.total_measurements)}</p>
                    </div>
                    <div className="bg-white p-8 hover:bg-[#EBEEF1] transition-colors">
                      <p className="text-[12px] uppercase tracking-wider text-[#7A8A9A] font-bold">Unique Locations</p>
                      <p className="text-[40px] font-light text-[#1A1F26] mt-2">{formatCount(stats.unique_locations)}</p>
                    </div>
                  </div>
                </div>

                {/* Detailed Metrics */}
                <div>
                  <span className="text-[11px] uppercase tracking-widest text-[#2E6DA4] mb-6 block font-bold">Measurement Statistics</span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-[2px] bg-[#DDE1E6] border border-[#DDE1E6] rounded-sm overflow-hidden">
                    {/* Temperature */}
                    <div className="bg-white p-8 hover:border-t-2 hover:border-t-[#4A87BE] transition-all flex flex-col border border-transparent">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="w-4 h-4 rounded-full bg-[#F0F2F4] border-2 border-[#4A87BE]" />
                        <h3 className="text-[18px] font-normal text-[#1A1F26]">Temperature</h3>
                      </div>
                      <div className="space-y-4 font-serif text-[15px] flex-1">
                        <div className="flex justify-between border-b border-[#F0F2F4] pb-2">
                          <span className="text-[#7A8A9A] italic">Minimum</span>
                          <span className="text-[#3D4A58]">{formatValue(stats.min_temp, "°C")}</span>
                        </div>
                        <div className="flex justify-between border-b border-[#F0F2F4] pb-2">
                          <span className="text-[#7A8A9A] italic">Average</span>
                          <span className="text-[#1A1F26] font-semibold">{formatValue(stats.avg_temp, "°C")}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#7A8A9A] italic">Maximum</span>
                          <span className="text-[#3D4A58]">{formatValue(stats.max_temp, "°C")}</span>
                        </div>
                      </div>
                    </div>

                    {/* Salinity */}
                    <div className="bg-white p-8 hover:border-t-2 hover:border-t-[#5C7A96] transition-all flex flex-col border border-transparent">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="w-4 h-4 rounded-full bg-[#F0F2F4] border-2 border-[#5C7A96]" />
                        <h3 className="text-[18px] font-normal text-[#1A1F26]">Salinity</h3>
                      </div>
                      <div className="space-y-4 font-serif text-[15px] flex-1">
                        <div className="flex justify-between border-b border-[#F0F2F4] pb-2">
                          <span className="text-[#7A8A9A] italic">Minimum</span>
                          <span className="text-[#3D4A58]">{formatValue(stats.min_salinity, "PSU")}</span>
                        </div>
                        <div className="flex justify-between border-b border-[#F0F2F4] pb-2">
                          <span className="text-[#7A8A9A] italic">Average</span>
                          <span className="text-[#1A1F26] font-semibold">{formatValue(stats.avg_salinity, "PSU")}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#7A8A9A] italic">Maximum</span>
                          <span className="text-[#3D4A58]">{formatValue(stats.max_salinity, "PSU")}</span>
                        </div>
                      </div>
                    </div>

                    {/* Pressure / Depth */}
                    <div className="bg-white p-8 hover:border-t-2 hover:border-t-[#7B9BB8] transition-all flex flex-col border border-transparent">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="w-4 h-4 rounded-full bg-[#F0F2F4] border-2 border-[#7B9BB8]" />
                        <h3 className="text-[18px] font-normal text-[#1A1F26]">Pressure</h3>
                      </div>
                      <div className="space-y-4 font-serif text-[15px] flex-1">
                        <div className="flex justify-between border-b border-[#F0F2F4] pb-2">
                          <span className="text-[#7A8A9A] italic">Minimum</span>
                          <span className="text-[#3D4A58]">{formatValue(stats.min_pressure, "dbar", 0)}</span>
                        </div>
                        <div className="flex justify-between border-b border-[#F0F2F4] pb-2">
                          <span className="text-[#7A8A9A] italic">Average</span>
                          <span className="text-[#1A1F26] font-semibold">{formatValue(stats.avg_pressure, "dbar", 0)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#7A8A9A] italic">Maximum</span>
                          <span className="text-[#3D4A58]">{formatValue(stats.max_pressure, "dbar", 0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === "charts" && (
              <div className="space-y-12 mt-8">
                <div>
                  <span className="text-[11px] uppercase tracking-widest text-[#2E6DA4] mb-6 block font-bold">
                    Basic Charts
                  </span>
                  <BasicCharts projectId={projectId} />
                </div>
                
                <div className="mt-16 flex justify-center border-t border-[#C8CDD4] pt-12">
                  <div className="flex flex-col md:flex-row gap-4">
                    <Link 
                      href={`/projects/${projectId}/analytics`}
                      className="group bg-gradient-to-br from-[#2E6DA4] to-[#5C7A96] text-white font-bold px-10 py-4 rounded-sm shadow-[0_8px_32px_rgba(46,109,164,0.25)] hover:-translate-y-0.5 transition-transform flex items-center gap-4"
                    >
                      Proceed to Advanced Charts
                      <span className="text-white/70 group-hover:text-white transition-colors group-hover:translate-x-1">→</span>
                    </Link>

                    <Link 
                      href={`/projects/${projectId}/analytics?view=stats`}
                      className="group bg-white border border-[#2E6DA4] text-[#2E6DA4] font-bold px-10 py-4 rounded-sm hover:bg-[#F0F5FA] transition-transform flex items-center gap-4"
                    >
                      Proceed to Advanced Statistics
                      <span className="text-[#4A87BE] group-hover:translate-x-1 transition-transform">→</span>
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "statistics" && (
              <div className="space-y-12 mt-8">
                <div>
                  <span className="text-[11px] uppercase tracking-widest text-[#2E6DA4] mb-6 block font-bold">
                    Basic Statistics
                  </span>
                  <BasicStatistics projectId={projectId} />
                </div>

                <div className="mt-16 flex justify-center border-t border-[#C8CDD4] pt-12">
                  <Link 
                    href={`/projects/${projectId}/analytics?view=stats`}
                    className="group bg-gradient-to-br from-[#2E6DA4] to-[#5C7A96] text-white font-bold px-10 py-4 rounded-sm shadow-[0_8px_32px_rgba(46,109,164,0.25)] hover:-translate-y-0.5 transition-transform flex items-center gap-4"
                  >
                    Proceed to Advanced Statistics
                    <span className="text-white/70 group-hover:text-white transition-colors group-hover:translate-x-1">→</span>
                  </Link>
                </div>
              </div>
            )}
          </ProjectTabs>
        </div>

        {/* Sidebar Column For Upload */}
        {activeTab === "overview" && (
          <div className="w-full lg:w-96 shrink-0 lg:mt-[90px]">
             <div className="bg-white border border-[#C8CDD4] rounded-sm p-6 shadow-sm">
                <span className="text-[11px] uppercase tracking-widest text-[#1A1F26] mb-4 block font-bold">Append Data</span>
                <FileUpload projectId={String(projectId)} />
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
