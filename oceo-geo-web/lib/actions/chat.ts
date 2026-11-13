"use server";

import { auth } from "@clerk/nextjs/server";
import type {
  ChartPayload,
  ChartSpec,
  ColumnMeta,
} from "@/types";
import {
  addMessage,
  createConversation,
  getMessagesPaginated,
  updateConversationTitle,
} from "@/lib/actions/conversations";

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

/** A prior turn sent to the backend so follow-up questions have context. */
export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
  intent?: string | null;
  sql_query?: string | null;
}

/** How many prior messages (user + assistant) accompany each question. */
const HISTORY_MESSAGES = 6;

export async function sendChatMessage(
  message: string,
  projectId: number,
  context?: Record<string, unknown>,
  history: HistoryTurn[] = []
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
      history,
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

// ── Persisted send flow ─────────────────────────────────────────────────────
// Orchestrates the full chat round-trip with message persistence:
//   1. Create conversation if no conversationId is provided (auto-title from
//      the first user message, truncated to ~50 chars).
//   2. Save the user message to the messages table.
//   3. Call the backend AI (sendChatMessage).
//   4. Save the assistant response with intent, sql_query, sql_data (display-
//      limited rows), and chart_spec.
//   5. Return the backend result plus the conversationId and saved message
//      ids so the client can update its URL and message keys.
//
// See implementation_plan.md §5.5.

export interface SendPersistedResult extends SendMessageResult {
  conversation_id: number;
  user_message_id: number;
  assistant_message_id: number;
  created_conversation: boolean;
}

export async function sendChatMessagePersisted(
  message: string,
  projectId: number,
  conversationId?: number
): Promise<SendPersistedResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  let convId = conversationId;
  let createdConversation = false;

  // 1. Create conversation if none provided. Auto-title from the message.
  if (convId === undefined) {
    const title = message.trim().slice(0, 50) || "New conversation";
    const conv = await createConversation(projectId, title);
    convId = conv.conversationId;
    createdConversation = true;
  }

  // 2. Load recent turns (before saving the new message, so it isn't
  //    duplicated) for follow-up context. Failure here must not block chat.
  let history: HistoryTurn[] = [];
  if (!createdConversation) {
    try {
      const recent = await getMessagesPaginated(convId, HISTORY_MESSAGES);
      history = recent.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => m.intent !== "ERROR")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content ?? "",
          intent: m.intent,
          sql_query: m.sqlQuery,
        }));
    } catch (err) {
      console.error("Failed to load conversation history", err);
    }
  }

  // 3. Save the user message.
  const userMessage = await addMessage(convId, { role: "user", content: message });

  // 4. Call the backend AI with the recent conversation.
  const result = await sendChatMessage(message, projectId, undefined, history);

  // 5. Save the assistant response. Persist the chart data rows as sql_data
  //    so historical charts can re-render without re-querying. Prefer the
  //    chart_payload's data (validated) and fall back to the raw SQL rows.
  const sqlData = result.chart_payload?.data ?? result.data ?? [];
  const chartSpec = result.chart_spec ?? result.chart_payload?.spec ?? null;

  const assistantMessage = await addMessage(convId, {
    role: "assistant",
    content: result.summary ?? result.response ?? "",
    intent: result.intent,
    sqlQuery: result.query,
    sqlData,
    chartSpec,
  });

  // 6. If we created the conversation, the title was already set from the
  //    first message. For existing conversations, leave the title as-is
  //    (it was set when the conversation was created).
  //    Note: Phase 5.2 may add smarter title generation.

  return {
    ...result,
    conversation_id: convId,
    user_message_id: userMessage.messageId,
    assistant_message_id: assistantMessage.messageId,
    created_conversation: createdConversation,
  };
}

// ── Historical message loading ──────────────────────────────────────────────

export interface PersistedMessage {
  message_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  intent?: string;
  sql_query?: string;
  sql_data?: Record<string, unknown>[];
  chart_spec?: ChartSpec | null;
  created_at: Date;
  // Reconstructed for the frontend: a chart_payload built from chart_spec +
  // sql_data so historical charts render without a runtime result_id.
  chart_payload?: ChartPayload | null;
}

export interface LoadMessagesResult {
  messages: PersistedMessage[];
  has_more: boolean;
}

/**
 * Loads a paginated page of messages for a conversation and reconstructs
 * historical chart_payloads from the persisted chart_spec + sql_data.
 */
export async function loadConversationMessages(
  conversationId: number,
  limit = 50,
  beforeMessageId?: number
): Promise<LoadMessagesResult> {
  const page = await getMessagesPaginated(
    conversationId,
    limit,
    beforeMessageId
  );

  // Legacy rows were double-encoded via JSON.stringify before inserting into
  // jsonb (stored as JSON string). Unwrap until we get the real value.
  function unwrapJsonb<T>(value: unknown): T | null {
    let cur: unknown = value;
    for (let i = 0; i < 3; i++) {
      if (typeof cur === "string") {
        try {
          cur = JSON.parse(cur);
        } catch {
          return null;
        }
      } else {
        break;
      }
    }
    return cur as T | null;
  }

  const messages: PersistedMessage[] = page.messages.map((row) => {
    const sqlData = unwrapJsonb<Record<string, unknown>[]>(row.sqlData) ?? undefined;
    const chartSpec = unwrapJsonb<ChartSpec>(row.chartSpec) ?? null;

    // Reconstruct a chart_payload for historical rendering per §4.2.
    // The runtime result_id is long gone, but the spec + data are enough
    // for the frontend ChartRenderer.
    let chartPayload: ChartPayload | null = null;
    if (chartSpec && sqlData && sqlData.length > 0) {
      chartPayload = {
        spec: chartSpec,
        data: sqlData,
        meta: {
          row_count: sqlData.length,
          displayed_row_count: sqlData.length,
          truncated: false,
        },
      };
    }

    return {
      message_id: row.messageId,
      role: row.role as "user" | "assistant" | "system",
      content: row.content ?? "",
      intent: row.intent ?? undefined,
      sql_query: row.sqlQuery ?? undefined,
      sql_data: sqlData,
      chart_spec: chartSpec,
      created_at: row.createdAt ?? new Date(),
      chart_payload: chartPayload,
    };
  });

  return {
    messages,
    has_more: page.hasMore,
  };
}
