"use client";

import { useState } from "react";
import Link from "next/link";
import ConversationSidebar from "./ConversationSidebar";
import ChatView from "./ChatView";
import type { PersistedMessage } from "@/lib/actions/chat";

interface ConversationItem {
  conversationId: number;
  title: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface ChatLayoutProps {
  projectId: number;
  projectName: string;
  conversations: ConversationItem[];
  conversationId?: number;
  initialMessages?: PersistedMessage[];
  initialHasMore?: boolean;
}

export default function ChatLayout({
  projectId,
  projectName,
  conversations,
  conversationId,
  initialMessages,
  initialHasMore,
}: ChatLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div
      className="flex flex-col h-[calc(100vh-57px)] bg-[#F8F9FA]"
      style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}
    >
      {/* Top bar: project breadcrumb + mobile sidebar toggle */}
      <div className="bg-white border-b border-[#C8CDD4] px-4 md:px-6 py-3 shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden text-[#3D4A58] hover:text-[#4A87BE] transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>

          <Link
            href="/"
            className="text-[11px] uppercase tracking-widest text-[#7A8A9A] hover:text-[#4A87BE] transition-colors hidden sm:inline"
          >
            Projects
          </Link>
          <span className="text-[#C8CDD4] hidden sm:inline">/</span>
          <span className="text-[13px] text-[#1A1F26] truncate font-light">
            {projectName}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-[#4A87BE]" />
          <span className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">
            Chat
          </span>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — fixed width on desktop, slide-over on mobile */}
        <aside
          className={`
            shrink-0 w-72 overflow-hidden border-r border-[#DDE1E6]
            md:block
            ${sidebarOpen ? "block" : "hidden"}
          `}
        >
          <ConversationSidebar
            projectId={projectId}
            conversations={conversations}
            activeConversationId={conversationId}
          />
        </aside>

        {/* Chat area — fills remaining width */}
        <main className="flex-1 overflow-hidden">
          <ChatView
            projectId={projectId}
            projectName={projectName}
            conversationId={conversationId}
            initialMessages={initialMessages}
            initialHasMore={initialHasMore}
          />
        </main>
      </div>
    </div>
  );
}
