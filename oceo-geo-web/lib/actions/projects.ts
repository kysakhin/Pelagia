"use server";

import { currentUser } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

export interface Project {
  project_id: number;
  project_name: string;
  description: string | null;
  pi_name: string | null;
  created_at: string;
}

/**
 * Returns all projects owned by the current user.
 */
export async function getUserProjects(): Promise<Project[]> {
  const user = await currentUser();
  if (!user) throw new Error("Not authenticated");

  const rows = await sql`
    SELECT project_id, project_name, description, pi_name, created_at
    FROM projects
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC
  `;

  return rows as Project[];
}

/**
 * Creates a new project for the current user.
 */
export async function createProject(
  projectName: string,
  description?: string,
  piName?: string
): Promise<Project> {
  const user = await currentUser();
  if (!user) throw new Error("Not authenticated");

  const [project] = await sql`
    INSERT INTO projects (user_id, project_name, description, pi_name)
    VALUES (${user.id}, ${projectName}, ${description ?? null}, ${piName ?? null})
    RETURNING project_id, project_name, description, pi_name, created_at
  `;

  return project as Project;
}
