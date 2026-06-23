"use server";

import { auth } from "@clerk/nextjs/server";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  intent?: "SQL" | "DOMAIN" | "OFF_TOPIC" | "ERROR" | "CONTEXT";
  data?: Record<string, unknown>[];
  query?: string;
}

export interface SendMessageResult {
  intent: "SQL" | "DOMAIN" | "OFF_TOPIC" | "ERROR" | "CONTEXT";
  response?: string;
  summary?: string;
  query?: string;
  data?: Record<string, unknown>[];
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
