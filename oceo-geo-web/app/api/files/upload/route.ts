import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:8000";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

interface FileResult {
  filename: string;
  status: "success" | "error";
  error?: string;
  file_id?: number;
  profiles_inserted?: number;
  measurements_inserted?: number;
}

/**
 * Accepts one or many files under the form key "file".
 * Each file is forwarded individually to the Python backend.
 * Returns an array of per-file results so partial failures don't block others.
 */
export async function POST(request: NextRequest) {
  /* ── Auth ─────────────────────────────────────────────── */
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* ── Parse form data ──────────────────────────────────── */
  const formData = await request.formData();
  const files = formData.getAll("file") as File[];
  const projectId = formData.get("project_id") as string | null;
  const selectedParams = formData.get("selected_params") as string | null;

  if (!files.length || !projectId) {
    return NextResponse.json(
      { error: "Missing required fields: file(s), project_id" },
      { status: 400 },
    );
  }

  /* ── Process each file ────────────────────────────────── */
  const results: FileResult[] = [];

  for (const file of files) {
    const name = file.name || "unknown";

    // Size guard
    if (file.size > MAX_FILE_SIZE) {
      results.push({
        filename: name,
        status: "error",
        error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
      });
      continue;
    }

    // Forward to Python backend
    try {
      const backendForm = new FormData();
      backendForm.append("file", file);
      backendForm.append("user_id", userId);
      backendForm.append("project_id", projectId);
      backendForm.append("selected_params", selectedParams || "");

      const response = await fetch(`${API_URL}/files/process`, {
        method: "POST",
        body: backendForm,
      });

      const data = await response.json();

      if (!response.ok) {
        results.push({
          filename: name,
          status: "error",
          error:
            data.detail ||
            data.error ||
            `Server responded with ${response.status}`,
        });
      } else {
        results.push({
          filename: name,
          status: "success",
          file_id: data.file_id,
          profiles_inserted: data.profiles_inserted,
          measurements_inserted: data.measurements_inserted,
        });
      }
    } catch {
      results.push({
        filename: name,
        status: "error",
        error: "Failed to reach the processing server",
      });
    }
  }

  const allOk = results.every((r) => r.status === "success");
  return NextResponse.json({ results }, { status: allOk ? 200 : 207 });
}
