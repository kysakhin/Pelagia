import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import ChatInterface from "@/components/ChatInterface";

export default async function ProjectChatPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/");
  }

  const resolvedParams = await Promise.resolve(params);
  const projectId = Number(resolvedParams.id);

  if (isNaN(projectId)) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-500">
        Invalid project ID
      </div>
    );
  }

  // RLS + project fetch
  const txResults = await sql.transaction([
    sql`SELECT set_config('app.current_user_id', ${userId}, true)`,
    sql`SELECT project_name FROM projects WHERE project_id = ${projectId} AND user_id = ${userId}`,
  ]);

  const projectRows = txResults[1];

  if (!projectRows || projectRows.length === 0) {
    return (
      <div
        className="min-h-screen bg-[#F8F9FA] flex items-center justify-center"
        style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}
      >
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-[#1A1F26]">Project Not Found</h2>
          <p className="text-[#7A8A9A] mt-2 mb-6 font-serif">
            It may have been deleted or you do not have access.
          </p>
          <Link href="/projects" className="text-[#4A87BE] hover:underline text-sm">
            Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  const projectName = projectRows[0].project_name as string;

  return (
    <div
      className="flex flex-col h-[calc(100vh-57px)] bg-[#F8F9FA]"
      style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}
    >
      {/* Page header */}
      <div className="bg-white border-b border-[#C8CDD4] px-4 md:px-8 py-5 shrink-0">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href={`/projects/${projectId}`}
              className="text-[11px] uppercase tracking-widest text-[#7A8A9A] hover:text-[#4A87BE] transition-colors flex items-center gap-2"
            >
              <span className="text-[#4A87BE]">←</span>
              Back to Project
            </Link>
            <div className="h-4 w-px bg-[#C8CDD4]" />
            <div>
              <span className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">
                Chat
              </span>
              <span className="text-[#C8CDD4] mx-2">/</span>
              <span className="text-[13px] text-[#1A1F26]">{projectName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#4A87BE] animate-pulse" />
            <span className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">
              Connected
            </span>
          </div>
        </div>
      </div>

      {/* Chat area — fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <ChatInterface projectId={projectId} projectName={projectName} />
      </div>
    </div>
  );
}
