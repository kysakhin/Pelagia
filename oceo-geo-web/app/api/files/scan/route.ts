import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { ScanSummary } from "@/types";

const API_URL = process.env.API_URL || "http://localhost:8000";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Scans a NetCDF file for core parameters and available extras.
 * Returns a summary of the file's contents.
 * Does not write anything to the database.
 * Should be fast (<1 second for any file size).
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<ScanSummary | { error: string }>> {
  /* ── Auth ─────────────────────────────────────────────── */
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* ── Parse form data ──────────────────────────────────── */
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      {
        error:
          "File too large for the scan endpoint. Please try a smaller file or increase the Next.js proxy body limit.",
      },
      { status: 413 },
    );
  }
  const files = formData.getAll("file") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  /* ── Process each file ────────────────────────────────── */
  const coreParams = new Set<string>();
  const bgcParams = new Set<string>();
  const availableExtras = new Set<string>();
  let successCount = 0;
  let errorCount = 0;

  const fileErrors: { file: string; error: string }[] = [];

  for (const file of files) {
    const name = file.name || "unknown";

    if (file.size > MAX_FILE_SIZE) {
      errorCount++;
      fileErrors.push({
        file: name,
        error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit`,
      });
      continue;
    }

    // Forward to Python backend
    try {
      const backendForm = new FormData();
      backendForm.append("file", file);

      const response = await fetch(`${API_URL}/files/scan`, {
        method: "POST",
        body: backendForm,
      });

      const raw = await response.text();
      let data: { core_params?: string[]; bgc_params?: string[]; available_extras?: string[]; error?: string; detail?: string } = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = {};
        }
      }

      if (!response.ok) {
        errorCount++;
        fileErrors.push({
          file: name,
          error: data.error || data.detail || "Unable to scan file",
        });
      } else {
        (data.core_params || []).forEach((p: string) => coreParams.add(p));
        (data.bgc_params || []).forEach((p: string) => bgcParams.add(p));
        (data.available_extras || []).forEach((p: string) => availableExtras.add(p));
        successCount++;
      }
      continue;
    } catch {
      errorCount++;
      fileErrors.push({
        file: name,
        error: "Unable to scan file",
      });
      continue;
    }
  }

  const allOk = errorCount === 0;
  return NextResponse.json(
    {
      core_params: [...coreParams].sort(),
      bgc_params: [...bgcParams].sort(),
      available_extras: [...availableExtras].sort(),
      files_scanned: successCount + errorCount,
      files_failed: errorCount,
      file_errors: fileErrors,
    },
    { status: allOk ? 200 : 207 },
  );
}
