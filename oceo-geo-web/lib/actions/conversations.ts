"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { conversations, messages, projects } from "@/lib/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";

// ── Conversations ───────────────────────────────────────────────────────────

/**
 * Returns all conversations for a project, scoped to the authenticated user.
 * Every query verifies both project ownership and conversation ownership.
 */
export async function getConversations(projectId: number) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Verify the user owns this project.
  const [project] = await db
    .select({ projectId: projects.projectId })
    .from(projects)
    .where(
      and(eq(projects.projectId, projectId), eq(projects.userId, userId))
    )
    .limit(1);

  if (!project) throw new Error("Project not found or access denied");

  return db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(conversations.userId, userId)
      )
    )
    .orderBy(desc(conversations.updatedAt));
}

/**
 * Returns a single conversation, verifying both project and conversation
 * ownership. Throws if not found or access denied.
 */
export async function getConversation(
  projectId: number,
  conversationId: number
) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.conversationId, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.userId, userId)
      )
    )
    .limit(1);

  if (!row) throw new Error("Conversation not found or access denied");

  return row;
}

/**
 * Creates a new conversation in a project. Verifies project ownership first.
 */
export async function createConversation(
  projectId: number,
  title?: string
) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Verify the user owns this project.
  const [project] = await db
    .select({ projectId: projects.projectId })
    .from(projects)
    .where(
      and(eq(projects.projectId, projectId), eq(projects.userId, userId))
    )
    .limit(1);

  if (!project) throw new Error("Project not found or access denied");

  const [conversation] = await db
    .insert(conversations)
    .values({
      projectId,
      userId,
      title: title ?? null,
    })
    .returning();

  return conversation;
}

/**
 * Deletes a conversation and all its messages (cascade).
 * Verifies the conversation belongs to the authenticated user.
 */
export async function deleteConversation(conversationId: number) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Verify ownership via the conversation's user_id.
  const [conversation] = await db
    .select({ conversationId: conversations.conversationId })
    .from(conversations)
    .where(
      and(
        eq(conversations.conversationId, conversationId),
        eq(conversations.userId, userId)
      )
    )
    .limit(1);

  if (!conversation) throw new Error("Conversation not found or access denied");

  await db
    .delete(conversations)
    .where(eq(conversations.conversationId, conversationId));

  return { success: true };
}

// ── Messages ────────────────────────────────────────────────────────────────

/**
 * Returns all messages for a conversation, scoped to the authenticated user.
 * Verifies the conversation belongs to the user before returning messages.
 */
export async function getMessages(conversationId: number) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Verify ownership via the conversation's user_id.
  const [conversation] = await db
    .select({ conversationId: conversations.conversationId })
    .from(conversations)
    .where(
      and(
        eq(conversations.conversationId, conversationId),
        eq(conversations.userId, userId)
      )
    )
    .limit(1);

  if (!conversation) throw new Error("Conversation not found or access denied");

  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

/**
 * Returns messages for a conversation with cursor-based pagination.
 *
 * By default returns the latest `limit` messages (ordered oldest → newest).
 * Pass `beforeMessageId` to load the page of messages older than that id
 * (used for "load more" on scroll-up).
 *
 * Verifies conversation ownership before returning messages.
 */
export async function getMessagesPaginated(
  conversationId: number,
  limit = 50,
  beforeMessageId?: number
) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Verify ownership via the conversation's user_id.
  const [conversation] = await db
    .select({ conversationId: conversations.conversationId })
    .from(conversations)
    .where(
      and(
        eq(conversations.conversationId, conversationId),
        eq(conversations.userId, userId)
      )
    )
    .limit(1);

  if (!conversation) throw new Error("Conversation not found or access denied");

  // Fetch a page of messages. When loading older messages, we query for
  // messages with id < beforeMessageId ordered descending, then reverse
  // the result so the caller receives them in chronological order.
  if (beforeMessageId !== undefined) {
    const page = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          lt(messages.messageId, beforeMessageId)
        )
      )
      .orderBy(desc(messages.messageId))
      .limit(limit);

    return {
      messages: page.reverse(),
      hasMore: page.length === limit,
    };
  }

  // Latest page: newest `limit` messages, reversed to chronological order.
  const page = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.messageId))
    .limit(limit);

  return {
    messages: page.reverse(),
    hasMore: page.length === limit,
  };
}

/**
 * Adds a message to a conversation. Verifies conversation ownership first.
 */
export async function addMessage(
  conversationId: number,
  message: {
    role: "user" | "assistant" | "system";
    content?: string;
    intent?: string;
    sqlQuery?: string;
    sqlData?: unknown;
    chartSpec?: unknown;
    metadata?: unknown;
  }
) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Verify ownership via the conversation's user_id.
  const [conversation] = await db
    .select({ conversationId: conversations.conversationId })
    .from(conversations)
    .where(
      and(
        eq(conversations.conversationId, conversationId),
        eq(conversations.userId, userId)
      )
    )
    .limit(1);

  if (!conversation) throw new Error("Conversation not found or access denied");

  const [saved] = await db
    .insert(messages)
    .values({
      conversationId,
      role: message.role,
      content: message.content ?? null,
      intent: message.intent ?? null,
      sqlQuery: message.sqlQuery ?? null,
      // jsonb columns — pass JS values directly; drizzle serializes to JSON.
      sqlData: (message.sqlData as unknown) ?? null,
      chartSpec: (message.chartSpec as unknown) ?? null,
      metadata: (message.metadata as unknown) ?? null,
    })
    .returning();

  // Touch the conversation's updated_at to keep it recent in the sidebar.
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.conversationId, conversationId));

  return saved;
}

/**
 * Updates a conversation's title. Verifies ownership.
 */
export async function updateConversationTitle(
  conversationId: number,
  title: string
) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const [conversation] = await db
    .select({ conversationId: conversations.conversationId })
    .from(conversations)
    .where(
      and(
        eq(conversations.conversationId, conversationId),
        eq(conversations.userId, userId)
      )
    )
    .limit(1);

  if (!conversation) throw new Error("Conversation not found or access denied");

  await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.conversationId, conversationId));

  return { success: true };
}
