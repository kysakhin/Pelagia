"use server";

import { auth } from "@clerk/nextjs/server";
import type {
  ChartPayload,
  ChartSpec,
  ColumnMeta,
} from "@/types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  intent?: "SQL" | "DOMAIN" | "OFF_TOPIC" | "ERROR" | "CONTEXT";
  query?: string;
  // SQL-intent fields
  data?: Record<string, unknown>[];   // display/message-preview-limited rows
  resultId?: string;                  // runtime SQL result handle
  columns?: ColumnMeta[];             // SQL result column metadata
  rowCount?: number;                  // total rows returned by SQL
  chartSpec?: ChartSpec | null;       // raw spec from create_visualization_spec
  chartPayload?: ChartPayload | null; // validated { spec, data, meta } or null
}

export interface SendMessageResult {
  intent: "SQL" | "DOMAIN" | "OFF_TOPIC" | "ERROR" | "CONTEXT";
  response?: string;
  summary?: string;
  query?: string;
  // SQL-intent fields (new in Phase 2 — see implementation_plan.md §3.3)
  data?: Record<string, unknown>[];
  result_id?: string;
  columns?: ColumnMeta[];
  row_count?: number;
  chart_spec?: ChartSpec | null;
  chart_payload?: ChartPayload | null;
}

export async function sendChatMessage(
  message: string,
  projectId: number,
  context?: Record<string, unknown>
): Promise<SendMessageResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const apiUrl = process.env.API_URL;
  if (!apiUrl) throw new Error("API_URL is not configured");

  const res = await fetch(`${apiUrl}/chat/send_message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      user_id: userId,
      project_id: projectId,
      context: context || null,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend error ${res.status}: ${text}`);
  }

  const json = await res.json();
  // Backend wraps the result in { response: { intent, ... } }
  return json.response as SendMessageResult;
}
