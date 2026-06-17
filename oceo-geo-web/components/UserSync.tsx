"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { syncUser } from "@/lib/actions/user";

/**
 * Invisible component that syncs the signed-in Clerk user to the
 * `users` table in Neon DB. Place it once inside <ClerkProvider>.
 */
export default function UserSync() {
  const { isSignedIn, isLoaded } = useUser();
  const synced = useRef(false);

  useEffect(() => {
    if (isLoaded && isSignedIn && !synced.current) {
      synced.current = true;
      syncUser().catch(console.error);
    }
  }, [isLoaded, isSignedIn]);

  return null;
}
