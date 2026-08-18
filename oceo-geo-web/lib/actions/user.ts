"use server";

import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Upserts the currently signed-in Clerk user into the `users` table.
 * Called automatically via the <UserSync /> component on every page load.
 */
export async function syncUser() {
  const user = await currentUser();
  if (!user) return null;

  const email = user.emailAddresses[0]?.emailAddress;
  if (!email) return null;

  await db
    .insert(users)
    .values({
      userId: user.id,
      email,
      fullName: user.fullName ?? null,
    })
    .onConflictDoUpdate({
      target: users.userId,
      set: {
        email,
        fullName: user.fullName ?? null,
      },
    });

  return { userId: user.id };
}
