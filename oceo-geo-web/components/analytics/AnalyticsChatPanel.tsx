"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { sendChatMessage, type SendMessageResult } from "@/lib/actions/chat";
import type { ChartContext } from "./types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: "SQL" | "DOMAIN" | "OFF_TOPIC" | "CONTEXT";
  data?: Record<string, unknown>[];
  query?: string;
  error?: boolean;
}

interface AnalyticsChatPanelProps {
  projectId: number;
  projectName: string;
  context: ChartContext | null;
  onClose: () => void;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

// Reusing the SQLResultTable from ChatInterface but optimized for a narrower sidebar
function SQLResultTable({ data }: { data: Record<string, unknown>[] }) {
  if (!data || data.length === 0) return null;
  const columns = Object.keys(data[0]);

  return (
    <div className="mt-3 overflow-x-auto border border-[#DDE1E6] rounded-sm max-w-[calc(100vw-300px)] lg:max-w-[400px]">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-[#F0F2F4]">
            {columns.map((col) => (
              <th
                key={col}
                className="px-3 py-1.5 text-left uppercase tracking-wider text-[#7A8A9A] font-bold border-b border-[#DDE1E6] whitespace-nowrap"
              >
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#F8F9FA]"}>
              {columns.map((col) => (
                <td
                  key={col}
                  className="px-3 py-1.5 text-[#3D4A58] border-b border-[#F0F2F4] whitespace-nowrap font-mono"
                >
                  {row[col] === null || row[col] === undefined ? (
                    <span className="text-[#C8CDD4] italic">null</span>
                  ) : (
                    String(row[col])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-1.5 bg-[#F8F9FA] border-t border-[#DDE1E6] text-[10px] text-[#7A8A9A] uppercase tracking-wider">
        {data.length} row{data.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const intentLabel: Record<string, string> = {
    SQL: "DATA QUERY",
    DOMAIN: "KNOWLEDGE",
    CONTEXT: "DATA INTERPRETATION",
    OFF_TOPIC: "OUT OF SCOPE",
  };

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {message.intent && !message.error && (
        <span className="text-[9px] uppercase tracking-widest text-[#7A8A9A]">
          {intentLabel[message.intent] ?? message.intent}
        </span>
      )}

      <div
        className={`border rounded-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap font-serif ${
          message.error
            ? "border-[#E8C8C8] bg-[#FDF4F4] text-[#8A3A3A]"
            : message.intent === "OFF_TOPIC"
            ? "border-[#DDE1E6] bg-[#F8F9FA] text-[#7A8A9A]"
            : "border-[#DDE1E6] bg-white text-[#3D4A58]"
        }`}
      >
        {message.content}

        {message.intent === "SQL" && message.query && (
          <details className="mt-3 group">
            <summary className="text-[10px] uppercase tracking-widest text-[#7A8A9A] cursor-pointer hover:text-[#4A87BE] transition-colors list-none flex items-center gap-1.5">
              <span className="group-open:hidden">Show Query</span>
              <span className="hidden group-open:inline">Hide Query</span>
              <span className="text-[#C8CDD4]">—</span>
            </summary>
            <pre className="mt-2 bg-[#F0F2F4] border border-[#DDE1E6] rounded-sm p-3 text-[10px] font-mono text-[#3D4A58] overflow-x-auto whitespace-pre-wrap">
              {message.query}
            </pre>
          </details>
        )}

        {message.intent === "SQL" && message.data && message.data.length > 0 && (
          <SQLResultTable data={message.data} />
        )}
      </div>
    </div>
  );
}

export default function AnalyticsChatPanel({
  projectId,
  projectName,
  context,
  onClose,
}: AnalyticsChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isPending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isPending) return;

    const userMsg: Message = { id: generateId(), role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    startTransition(async () => {
      try {
        const payloadContext = context ? (context as unknown as Record<string, unknown>) : undefined;
        const result = await sendChatMessage(trimmed, projectId, payloadContext);

        const assistantMsg: Message = {
          id: generateId(),
          role: "assistant",
          intent: result.intent,
          content: result.summary ?? result.response ?? "No response received.",
          data: result.data,
          query: result.query,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "assistant",
            content: err instanceof Error ? err.message : "Error connecting to AI.",
            error: true,
          },
        ]);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border border-[#C8CDD4] rounded-sm shadow-sm font-['Helvetica_Neue',Helvetica,Arial,sans-serif]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#C8CDD4] flex items-center justify-between bg-[#F8F9FA] rounded-t-sm shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[#4A87BE] animate-pulse" />
          <h3 className="text-sm font-medium text-[#1A1F26]">AI Copilot</h3>
        </div>
        <button
          onClick={onClose}
          className="text-[#7A8A9A] hover:text-[#1A1F26] p-1 rounded-sm hover:bg-[#EBECEE] transition-colors"
          title="Close chat panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* Context Badge */}
      {context && (
        <div className="px-4 py-2 border-b border-[#F0F2F4] bg-[#FDFEFE] shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#7A8A9A] mb-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
            </svg>
            Context Linked
          </div>
          <p className="text-[11px] text-[#3D4A58] line-clamp-1">
            <strong>Viewing:</strong> {context.chartLabel}
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center text-[#7A8A9A] mt-10 space-y-4">
            <p className="text-xs">
              I can explain variables, identify anomalies, or query your dataset.
            </p>
            {context && (
              <button
                onClick={() => {
                  setInput(`What do these ${context.variables.join(" and ")} values mean?`);
                  inputRef.current?.focus();
                }}
                className="text-[11px] border border-[#C8CDD4] px-3 py-1.5 rounded-sm hover:border-[#4A87BE] hover:text-[#4A87BE] transition-colors mx-auto block"
              >
                Explain active view
              </button>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-[85%] bg-[#1A1F26] text-white px-3.5 py-2.5 rounded-sm text-sm font-light leading-relaxed">
                {msg.content}
              </div>
            ) : (
              <AssistantMessage message={msg} />
            )}
          </div>
        ))}

        {isPending && (
          <div className="flex gap-1 text-[#C8CDD4] text-xs items-center px-1 py-2">
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-1 h-1 rounded-full bg-[#C8CDD4] animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
            <span className="ml-2 uppercase tracking-widest text-[9px]">Analyzing</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 bg-white border-t border-[#C8CDD4] shrink-0">
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={context ? `Ask about ${context.chartLabel}...` : "Ask a question..."}
            rows={1}
            disabled={isPending}
            className="w-full resize-none border border-[#C8CDD4] bg-[#F8F9FA] rounded-sm pl-3 pr-10 py-2.5 text-xs text-[#1A1F26] placeholder:text-[#B0B8C2] focus:outline-none focus:border-[#4A87BE] focus:bg-white transition-colors disabled:opacity-50"
            style={{ minHeight: "36px", maxHeight: "120px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          <button
            type="submit"
            disabled={isPending || !input.trim()}
            className="absolute right-2 bottom-2 text-[#4A87BE] hover:text-[#2E6DA4] disabled:opacity-40 disabled:cursor-not-allowed p-1"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
