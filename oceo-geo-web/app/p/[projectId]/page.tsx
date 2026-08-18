import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getProject } from "@/lib/actions/projects";
import { getConversations } from "@/lib/actions/conversations";
import ChatLayout from "@/components/chat/ChatLayout";

export default async function ProjectChatPage({
  params,
}: {
  params: Promise<{ projectId: string }> | { projectId: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const resolvedParams = await Promise.resolve(params);
  const projectId = Number(resolvedParams.projectId);

  if (Number.isNaN(projectId)) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-500">
        Invalid project ID
      </div>
    );
  }

  // Fetch project + conversations. getProject throws if not owned by user.
  let project;
  let conversations;
  try {
    [project, conversations] = await Promise.all([
      getProject(projectId),
      getConversations(projectId),
    ]);
  } catch {
    return (
      <div
        className="min-h-screen bg-[#F8F9FA] flex items-center justify-center"
        style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}
      >
        <div className="text-center">
          <h2 className="text-2xl font-light text-[#1A1F26]">
            Project Not Found
          </h2>
          <p className="text-[#7A8A9A] mt-2 mb-6 font-serif">
            It may have been deleted or you do not have access.
          </p>
          <a
            href="/"
            className="text-[#4A87BE] hover:underline text-sm"
          >
            Back to Projects
          </a>
        </div>
      </div>
    );
  }

  return (
    <ChatLayout
      projectId={projectId}
      projectName={project.project_name}
      conversations={conversations.map((c) => ({
        conversationId: c.conversationId,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))}
    />
  );
}
