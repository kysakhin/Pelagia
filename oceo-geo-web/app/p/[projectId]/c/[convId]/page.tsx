import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getProject } from "@/lib/actions/projects";
import {
  getConversations,
  getConversation,
} from "@/lib/actions/conversations";
import { loadConversationMessages } from "@/lib/actions/chat";
import ChatLayout from "@/components/chat/ChatLayout";

export default async function ConversationChatPage({
  params,
}: {
  params:
    | Promise<{ projectId: string; convId: string }>
    | { projectId: string; convId: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const resolvedParams = await Promise.resolve(params);
  const projectId = Number(resolvedParams.projectId);
  const conversationId = Number(resolvedParams.convId);

  if (Number.isNaN(projectId) || Number.isNaN(conversationId)) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-500">
        Invalid ID
      </div>
    );
  }

  // Fetch project + conversations + verify conversation belongs to project.
  // getProject and getConversation both throw on access denial.
  let project;
  let conversations;
  let conversation;
  let messagesPage;

  try {
    [project, conversations] = await Promise.all([
      getProject(projectId),
      getConversations(projectId),
    ]);
    // Verify the conversation belongs to this project + user.
    conversation = await getConversation(projectId, conversationId);
    messagesPage = await loadConversationMessages(conversationId, 50);
  } catch {
    return (
      <div
        className="min-h-screen bg-[#F8F9FA] flex items-center justify-center"
        style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}
      >
        <div className="text-center">
          <h2 className="text-2xl font-light text-[#1A1F26]">
            Conversation Not Found
          </h2>
          <p className="text-[#7A8A9A] mt-2 mb-6 font-serif">
            It may have been deleted or you do not have access.
          </p>
          <a
            href={`/p/${projectId}`}
            className="text-[#4A87BE] hover:underline text-sm"
          >
            Back to Project
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
      conversationId={conversation.conversationId}
      initialMessages={messagesPage.messages}
      initialHasMore={messagesPage.has_more}
    />
  );
}
