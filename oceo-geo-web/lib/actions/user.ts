"use server";

import { currentUser } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

/**
 * Upserts the currently signed-in Clerk user into the `users` table.
 * Called automatically via the <UserSync /> component on every page load.
 */
export async function syncUser() {
  const user = await currentUser();
  if (!user) return null;

  const email = user.emailAddresses[0]?.emailAddress;
  if (!email) return null;

  await sql`
    INSERT INTO users (user_id, email, full_name)
    VALUES (${user.id}, ${email}, ${user.fullName ?? null})
    ON CONFLICT (user_id) DO UPDATE SET
      email      = EXCLUDED.email,
      full_name  = EXCLUDED.full_name
  `;

  return { userId: user.id };
}
