"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createConversation,
  deleteConversation,
} from "@/lib/actions/conversations";

interface ConversationItem {
  conversationId: number;
  title: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface ConversationSidebarProps {
  projectId: number;
  conversations: ConversationItem[];
  activeConversationId?: number;
}

function formatRelativeDate(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export default function ConversationSidebar({
  projectId,
  conversations,
  activeConversationId,
}: ConversationSidebarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const handleNewChat = () => {
    if (isPending) return;
    startTransition(async () => {
      try {
        // Navigate to the project chat root — ChatView will create the
        // conversation on the first message and redirect to /c/[id].
        router.push(`/p/${projectId}`);
      } catch {
        // ignore
      }
    });
  };

  const handleDelete = (conversationId: number) => {
    if (isPending) return;
    startTransition(async () => {
      try {
        await deleteConversation(conversationId);
        // If we deleted the active conversation, go back to the project root.
        if (conversationId === activeConversationId) {
          router.push(`/p/${projectId}`);
        } else {
          router.refresh();
        }
      } catch {
        // ignore
      } finally {
        setConfirmDeleteId(null);
      }
    });
  };

  return (
    <div
      className="flex flex-col h-full bg-[#FAFBFC] border-r border-[#DDE1E6]"
      style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}
    >
      {/* Header */}
      <div className="px-5 py-5 border-b border-[#DDE1E6]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">
            Conversations
          </span>
          <button
            onClick={handleNewChat}
            disabled={isPending}
            className="text-[11px] uppercase tracking-widest text-[#4A87BE] hover:text-[#2E6DA4] transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <span className="text-[14px] leading-none">+</span> New
          </button>
        </div>
        <Link
          href={`/p/${projectId}`}
          className="block text-[15px] font-light text-[#1A1F26] hover:text-[#4A87BE] transition-colors truncate"
        >
          {conversations.length > 0
            ? "All conversations"
            : "No conversations yet"}
        </Link>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2">
        {conversations.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="font-serif text-[13px] text-[#7A8A9A] leading-relaxed">
              Start a new chat to begin asking questions about your data.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {conversations.map((conv) => {
              const isActive = conv.conversationId === activeConversationId;
              const isConfirming = confirmDeleteId === conv.conversationId;
              return (
                <li key={conv.conversationId}>
                  <div
                    className={`group flex items-center justify-between px-5 py-3 cursor-pointer transition-colors ${
                      isActive
                        ? "bg-[#EBEEF1] border-l-2 border-l-[#4A87BE]"
                        : "hover:bg-[#F0F2F4] border-l-2 border-l-transparent"
                    }`}
                    onClick={() =>
                      router.push(
                        `/p/${projectId}/c/${conv.conversationId}`
                      )
                    }
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className={`text-[13px] truncate ${
                          isActive
                            ? "text-[#1A1F26] font-medium"
                            : "text-[#3D4A58] font-light"
                        }`}
                      >
                        {conv.title || "Untitled conversation"}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-[#B0B8C2] mt-0.5">
                        {formatRelativeDate(conv.updatedAt ?? conv.createdAt)}
                      </span>
                    </div>

                    {/* Delete button */}
                    {isConfirming ? (
                      <div
                        className="flex items-center gap-1 ml-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleDelete(conv.conversationId)}
                          disabled={isPending}
                          className="text-[10px] uppercase tracking-wider text-[#8A3A3A] hover:text-[#6A2A2A] px-1.5 py-0.5"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[10px] uppercase tracking-wider text-[#7A8A9A] hover:text-[#3D4A58] px-1.5 py-0.5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(conv.conversationId);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-[#C8CDD4] hover:text-[#8A3A3A] transition-all ml-2 p-1"
                        aria-label="Delete conversation"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer: upload access */}
      <div className="px-5 py-4 border-t border-[#DDE1E6]">
        <Link
          href={`/upload?project=${projectId}`}
          className="flex items-center justify-between text-[12px] uppercase tracking-widest text-[#3D4A58] hover:text-[#4A87BE] transition-colors group"
        >
          <span className="flex items-center gap-2">
            <svg
              className="w-4 h-4 text-[#7A8A9A] group-hover:text-[#4A87BE] transition-colors"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Upload Files
          </span>
          <span className="text-[#4A87BE] group-hover:gap-3 transition-all">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}
