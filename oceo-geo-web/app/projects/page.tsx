import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function ProjectsPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/");
  }

  // Fetch projects wrapping in a transaction to satisfy RLS policies.
  const txResults = await sql.transaction([
    sql`SELECT set_config('app.current_user_id', ${userId}, true)`,
    sql`
      SELECT 
        p.project_id, 
        p.project_name, 
        p.description, 
        p.created_at,
        COUNT(f.file_id) as file_count
      FROM projects p
      LEFT JOIN files f ON p.project_id = f.project_id
      WHERE p.user_id = ${userId}
      GROUP BY p.project_id
      ORDER BY p.created_at DESC
    `,
  ]);

  const projects = txResults[1];

  return (
    <div className="min-h-screen bg-[#F8F9FA] py-20 px-8" style={{ fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
      <div className="max-w-[1440px] mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 gap-6">
          <div>
            <span className="text-[11px] uppercase tracking-[0.2em] text-[#2E6DA4] flex items-center gap-4 mb-4">
              <div className="w-6 h-[1px] bg-[#4A87BE]"></div>
              Workspace
            </span>
            <h1 className="text-5xl font-light text-[#1A1F26] leading-tight">Your Projects</h1>
            <p className="font-serif text-[18px] text-[#3D4A58] mt-4 max-w-[600px] leading-[1.75]">
              Manage and view statistics for your uploaded oceanographic data.
            </p>
          </div>
          <Link
            href="/upload"
            className="bg-gradient-to-br from-[#2E6DA4] to-[#5C7A96] text-white font-bold px-8 py-3 rounded-sm shadow-[0_4px_16px_rgba(46,109,164,0.20)] hover:-translate-y-0.5 transition-transform flex items-center gap-2"
          >
            <span>+</span> New Upload
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="bg-white border border-[#C8CDD4] rounded-sm p-16 text-center shadow-[0_4px_24px_rgba(0,0,0,0.02)] max-w-2xl mx-auto">
            <div className="w-12 h-12 mx-auto mb-6 rounded outline outline-2 outline-offset-2 outline-transparent border-2 border-[#5C7A96] flex items-center justify-center relative">
               <div className="w-[2px] h-6 bg-[#5C7A96] absolute" />
               <div className="w-6 h-[2px] bg-[#5C7A96] absolute" />
            </div>
            <h2 className="text-2xl font-light text-[#1A1F26]">No projects found</h2>
            <p className="font-serif text-[16px] text-[#7A8A9A] mt-3 mb-8">You haven't initialized any workspaces or uploaded telemetry yet.</p>
            <Link
              href="/upload"
              className="inline-block border border-[#2E6DA4] text-[#4A87BE] px-8 py-3 rounded-sm text-sm hover:bg-[#2E6DA4] hover:text-white transition-all font-medium"
            >
              Initialize First Project
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[2px] border border-[#DDE1E6] rounded-sm overflow-hidden">
            {projects.map((project) => (
              <Link
                key={project.project_id}
                href={`/projects/${project.project_id}`}
                className="group bg-white p-8 hover:bg-[#EBEEF1] hover:border-t-2 hover:border-t-[#2E6DA4] transition-all flex flex-col border border-transparent min-h-[200px]"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] uppercase text-[#4A87BE] tracking-wider font-bold">Project File</span>
                  <span className="text-[12px] text-[#7A8A9A] font-serif italic">{new Date(project.created_at).toLocaleDateString()}</span>
                </div>
                <h3 className="text-[22px] font-normal mb-3 text-[#1A1F26] group-hover:text-[#2E6DA4] transition-colors line-clamp-1">
                  {project.project_name}
                </h3>
                <p className="font-serif text-[15px] text-[#3D4A58] leading-relaxed line-clamp-2 mb-6 flex-1">
                  {project.description || "No description provided. Contains NetCDF telemetry data."}
                </p>
                <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-[#7A8A9A]">
                  <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#4A87BE]" />{project.file_count} File{project.file_count !== 1 ? 's' : ''}</span>
                  <span className="text-[#2E6DA4] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">Open <span className="text-[#4A87BE]">→</span></span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
