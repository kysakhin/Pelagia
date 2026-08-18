"use server";

import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";

export interface Project {
  project_id: number;
  project_name: string;
  description: string | null;
  pi_name: string | null;
  created_at: Date | null;
}

/**
 * Returns all projects owned by the current user.
 */
export async function getUserProjects(): Promise<Project[]> {
  const user = await currentUser();
  if (!user) throw new Error("Not authenticated");

  const rows = await db
    .select({
      project_id: projects.projectId,
      project_name: projects.projectName,
      description: projects.description,
      pi_name: projects.piName,
      created_at: projects.createdAt,
    })
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.createdAt));

  return rows as Project[];
}

/**
 * Returns a single project owned by the current user.
 * Throws if the project doesn't exist or doesn't belong to the user.
 */
export async function getProject(projectId: number): Promise<Project> {
  const user = await currentUser();
  if (!user) throw new Error("Not authenticated");

  const [row] = await db
    .select({
      project_id: projects.projectId,
      project_name: projects.projectName,
      description: projects.description,
      pi_name: projects.piName,
      created_at: projects.createdAt,
    })
    .from(projects)
    .where(and(eq(projects.projectId, projectId), eq(projects.userId, user.id)))
    .limit(1);

  if (!row) throw new Error("Project not found or access denied");

  return row as Project;
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

  const [project] = await db
    .insert(projects)
    .values({
      userId: user.id,
      projectName,
      description: description ?? null,
      piName: piName ?? null,
    })
    .returning({
      project_id: projects.projectId,
      project_name: projects.projectName,
      description: projects.description,
      pi_name: projects.piName,
      created_at: projects.createdAt,
    });

  return project as Project;
}
