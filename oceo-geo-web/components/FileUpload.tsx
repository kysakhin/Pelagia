"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const ALLOWED_EXTENSIONS = [".nc", ".netcdf", ".nc4"];

interface FileResult {
  filename: string;
  status: "success" | "error";
  error?: string;
  file_id?: number;
  profiles_inserted?: number;
  measurements_inserted?: number;
}

interface FileUploadProps {
  projectId: string;
  onUploadSuccess?: () => void;
}

export default function FileUpload({ projectId, onUploadSuccess }: FileUploadProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<FileResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    const invalid = selected.filter((f) => {
      const ext = f.name.includes(".")
        ? "." + f.name.split(".").pop()!.toLowerCase()
        : "";
      return !ALLOWED_EXTENSIONS.includes(ext);
    });

    if (invalid.length) {
      setError(
        `Unsupported file(s): ${invalid.map((f) => f.name).join(", ")}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
      );
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setError(null);
    setResults([]);
    setFiles(selected);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleUpload() {
    if (!files.length || !projectId) return;
    setUploading(true);
    setError(null);
    setResults([]);

    const formData = new FormData();
    for (const f of files) formData.append("file", f);
    formData.append("project_id", projectId);

    try {
      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.results) {
        setResults(data.results as FileResult[]);
        
        // Refresh page or trigger callback to see new data if all succeeded
        const allOk = (data.results as FileResult[]).every(r => r.status === "success");
        if (allOk) {
            router.refresh();
            if (onUploadSuccess) onUploadSuccess();
        }
      } else if (!res.ok) {
        throw new Error(data.detail || data.error || "Upload failed");
      }

      // Reset file input on completion
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".nc,.netcdf,.nc4"
        multiple
        onChange={handleFileChange}
        className="block w-full text-[13px] text-[#7A8A9A] file:mr-4 file:py-2.5 file:px-5 file:rounded-none file:border-0 file:bg-[#E8EAED] file:text-[#3D4A58] file:uppercase file:tracking-wider file:font-bold file:text-[11px] hover:file:bg-[#C8CDD4] transition mb-6"
      />

      {files.length > 0 && (
        <ul className="mb-6 space-y-[2px]">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between text-[13px] text-[#1A1F26] bg-[#F8F9FA] px-4 py-2 border border-[#E8EAED]"
            >
              <span>
                {f.name} <span className="text-[#7A8A9A]">{(f.size / (1024 * 1024)).toFixed(2)} MB</span>
              </span>
              <button
                onClick={() => removeFile(i)}
                className="text-[10px] uppercase font-bold tracking-widest text-[#A63A3A] hover:text-[#8B2E2E] transition"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={handleUpload}
        disabled={uploading || !files.length || !projectId}
        className="w-full py-3.5 bg-[#4A87BE] text-white text-[13px] uppercase tracking-widest font-bold hover:bg-[#2E6DA4] disabled:opacity-50 transition"
      >
        {uploading
          ? `Uploading ${files.length} file${files.length > 1 ? "s" : ""}...`
          : `Distribute & Process`}
      </button>

      {error && (
        <div className="mt-6 p-4 bg-[#F8F9FA] border-l-4 border-[#A63A3A] text-[#1A1F26] text-sm">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-6 space-y-2">
          <div className="px-4 py-3 bg-[#F8F9FA] border border-[#E8EAED] text-xs font-bold uppercase tracking-widest text-[#3D4A58]">
            {successCount > 0 && <span className="text-[#4A87BE]">{successCount} Succeeded</span>}
            {successCount > 0 && errorCount > 0 && <span> // </span>}
            {errorCount > 0 && <span className="text-[#A63A3A]">{errorCount} Failed</span>}
          </div>

          {results.map((r, i) => (
            <div
              key={i}
              className={`p-4 border text-[13px] ${
                r.status === "success"
                  ? "bg-white border-[#E8EAED] text-[#1A1F26]"
                  : "bg-[#F8F9FA] border-l-4 border-l-[#A63A3A] border-y-[#E8EAED] border-r-[#E8EAED] text-[#1A1F26]"
              }`}
            >
              <p className="font-bold tracking-wide truncate mb-1">{r.filename}</p>
              {r.status === "success" ? (
                <p className="text-[11px] text-[#7A8A9A] uppercase tracking-wider">
                  Profiles: {r.profiles_inserted} <span className="mx-2">•</span> Measurements: {r.measurements_inserted}
                </p>
              ) : (
                <p className="text-[12px] text-[#A63A3A]">{r.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
