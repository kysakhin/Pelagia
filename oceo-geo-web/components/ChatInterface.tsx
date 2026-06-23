"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { sendChatMessage, type SendMessageResult } from "@/lib/actions/chat";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: "SQL" | "DOMAIN" | "OFF_TOPIC" | "ERROR" | "CONTEXT";
  data?: Record<string, unknown>[];
  query?: string;
  error?: boolean;
}

interface ChatInterfaceProps {
  projectId: number;
  projectName: string;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function SQLResultTable({ data }: { data: Record<string, unknown>[] }) {
  if (!data || data.length === 0) return null;
  const columns = Object.keys(data[0]);

  return (
    <div className="mt-4 overflow-x-auto border border-[#DDE1E6] rounded-sm">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="bg-[#F0F2F4]">
            {columns.map((col) => (
              <th
                key={col}
                className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-[#7A8A9A] font-bold border-b border-[#DDE1E6] whitespace-nowrap"
              >
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className={i % 2 === 0 ? "bg-white" : "bg-[#F8F9FA]"}
            >
              {columns.map((col) => (
                <td
                  key={col}
                  className="px-4 py-2 text-[#3D4A58] border-b border-[#F0F2F4] whitespace-nowrap font-mono"
                >
                  {row[col] === null || row[col] === undefined
                    ? <span className="text-[#C8CDD4] italic">null</span>
                    : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 bg-[#F8F9FA] border-t border-[#DDE1E6] text-[11px] text-[#7A8A9A] uppercase tracking-wider">
        {data.length} row{data.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const intentLabel: Record<string, string> = {
    SQL: "DATA QUERY",
    DOMAIN: "KNOWLEDGE",
    OFF_TOPIC: "OUT OF SCOPE",
    ERROR: "ERROR",
  };

  return (
    <div className="flex flex-col gap-2">
      {message.intent && !message.error && (
        <span className="text-[10px] uppercase tracking-widest text-[#7A8A9A]">
          {intentLabel[message.intent] ?? message.intent}
        </span>
      )}

      <div
        className={`border rounded-sm px-6 py-5 ${
          message.error
            ? "border-[#E8C8C8] bg-[#FDF4F4] text-[#8A3A3A]"
            : message.intent === "OFF_TOPIC"
            ? "border-[#DDE1E6] bg-[#F8F9FA] text-[#7A8A9A]"
            : "border-[#DDE1E6] bg-white text-[#1A1F26]"
        }`}
      >
        {/* Prose content — rendered as paragraphs preserving line breaks */}
        <div className="font-serif text-[15px] leading-relaxed text-[#3D4A58] whitespace-pre-wrap">
          {message.content}
        </div>

        {/* SQL-specific: raw query disclosure */}
        {message.intent === "SQL" && message.query && (
          <details className="mt-4 group">
            <summary className="text-[11px] uppercase tracking-widest text-[#7A8A9A] cursor-pointer select-none hover:text-[#4A87BE] transition-colors list-none flex items-center gap-2">
              <span className="group-open:hidden">Show Query</span>
              <span className="hidden group-open:inline">Hide Query</span>
              <span className="text-[#C8CDD4]">—</span>
            </summary>
            <pre className="mt-3 bg-[#F0F2F4] border border-[#DDE1E6] rounded-sm p-4 text-[12px] font-mono text-[#3D4A58] overflow-x-auto whitespace-pre-wrap">
              {message.query}
            </pre>
          </details>
        )}

        {/* SQL-specific: result table */}
        {message.intent === "SQL" && message.data && message.data.length > 0 && (
          <SQLResultTable data={message.data} />
        )}
      </div>
    </div>
  );
}

export default function ChatInterface({ projectId, projectName }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom whenever messages change or loading starts
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isPending) return;

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    startTransition(async () => {
      try {
        const result: SendMessageResult = await sendChatMessage(trimmed, projectId);

        const assistantMsg: Message = {
          id: generateId(),
          role: "assistant",
          intent: result.intent,
          // SQL uses summary; DOMAIN/OFF_TOPIC/CONTEXT use response
          content: result.summary ?? result.response ?? "No response received.",
          data: result.data,
          query: result.query,
          error: result.intent === "ERROR",
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        const errorMsg: Message = {
          id: generateId(),
          role: "assistant",
          content:
            err instanceof Error
              ? err.message
              : "An unexpected error occurred. Please try again.",
          error: true,
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      className="flex flex-col h-full"
      style={{ fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif" }}
    >
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-8 space-y-8">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full min-h-[40vh] text-center gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-3">
                Project
              </p>
              <h2 className="text-2xl font-light text-[#1A1F26]">{projectName}</h2>
            </div>
            <div className="max-w-sm">
              <p className="font-serif text-[15px] text-[#7A8A9A] leading-relaxed">
                Ask a question about your oceanographic data or general ocean science.
              </p>
            </div>
            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                "How many profiles are in my project?",
                "What is thermohaline circulation?",
                "Show me the average temperature at 500 dbar",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="text-[12px] border border-[#C8CDD4] text-[#3D4A58] px-4 py-2 rounded-sm hover:border-[#4A87BE] hover:text-[#4A87BE] hover:bg-[#F4F8FC] transition-all"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[75%] ${msg.role === "user" ? "w-auto" : "w-full"}`}>
              {msg.role === "user" ? (
                <div className="bg-[#1A1F26] text-white px-5 py-3.5 rounded-sm text-[15px] font-light leading-relaxed">
                  {msg.content}
                </div>
              ) : (
                <AssistantMessage message={msg} />
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isPending && (
          <div className="flex justify-start">
            <div className="border border-[#DDE1E6] bg-white rounded-sm px-6 py-4 flex items-center gap-3">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-[#C8CDD4] animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
              <span className="text-[12px] uppercase tracking-wider text-[#7A8A9A]">
                Processing
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-[#C8CDD4] bg-white px-4 md:px-8 py-4">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-3 items-end max-w-[1440px] mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your data or ocean science..."
              rows={1}
              disabled={isPending}
              className="flex-1 resize-none border border-[#C8CDD4] rounded-sm px-4 py-3 text-[14px] text-[#1A1F26] placeholder:text-[#B0B8C2] focus:outline-none focus:border-[#4A87BE] transition-colors disabled:opacity-50 leading-relaxed"
              style={{ minHeight: "46px", maxHeight: "160px" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 160) + "px";
              }}
            />
            <button
              type="submit"
              disabled={isPending || !input.trim()}
              className="shrink-0 bg-[#1A1F26] text-white px-6 py-3 rounded-sm text-[12px] uppercase tracking-widest hover:bg-[#2E6DA4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
          <p className="text-[11px] text-[#B0B8C2] mt-2 text-center tracking-wide max-w-[1440px] mx-auto">
            Press Enter to send — Shift+Enter for a new line
          </p>
        </form>
      </div>
    </div>
  );
}
