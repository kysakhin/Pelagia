"use client";

import { useState, useRef } from "react";

import { FileResult, ScanSummary } from "@/types";

const ALLOWED_EXTENSIONS = [".nc", ".netcdf", ".nc4"];

interface FileUploadProps {
  projectId: string;
}

export default function FileUpload({ projectId }: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [scanning, setScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  // results is for final result after upload of file to parse netcdf
  const [results, setResults] = useState<FileResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedParams, setSelectedParams] = useState<string[]>([]);

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
    setScanSummary(null);
    setSelectedParams([]);
    setFiles(selected);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setScanSummary(null);
    setSelectedParams([]);
    setResults([]);

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSelectParameters() {
    if (!files.length || !projectId) return;
    setScanning(true);
    setError(null);
    setResults([]);

    const formData = new FormData();
    for (const f of files) formData.append("file", f);

    try {
      const res = await fetch("/api/files/scan", {
        method: "POST",
        body: formData,
      });

      const raw = await res.text();
      let data: (ScanSummary & { error?: string }) | null = null;
      if (raw) {
        try {
          data = JSON.parse(raw) as ScanSummary & { error?: string };
        } catch {
          data = null;
        }
      }

      if (!res.ok) {
        setError(
          data?.error ||
          `Scan failed (${res.status})${res.statusText ? `: ${res.statusText}` : ""}`,
        );
        setScanSummary(null);
        setSelectedParams([]);
        setResults([]);
      } else if (res.status === 207) {
        setError(
          data?.file_errors?.length
            ? data.file_errors
              .map((item) => `${item.file}: ${item.error}`)
              .join(" | ")
            : "Some files failed to scan",
        );
        setResults([]);
        setScanSummary(null);
        setSelectedParams([]);
      } else {
        setScanSummary(data as ScanSummary);
        setError(null);
      }

      // We might want to keep the files in the input if this is a multi-step process.
      // But preserving the existing behavior for now:
      // setFiles([]);
      // if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      setError(msg);
    } finally {
      setScanning(false);
    }
  }

  async function handleUpload() {
    if (!files.length || !scanSummary) return;
    setUploading(true);

    try {
      const formData = new FormData();

      formData.append("project_id", projectId);
      for (const f of files) formData.append("file", f);

      // Append the selected parameters as a comma-separated string
      formData.append("selected_params", selectedParams.join(","));

      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      setResults(data.results);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={`transition-all duration-700 ease-in-out ${
        uploading || scanning ? "animate-pulse pointer-events-none" : ""
      }`}
    >
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
                {f.name}{" "}
                <span className="text-[#7A8A9A]">
                  {(f.size / (1024 * 1024)).toFixed(2)} MB
                </span>
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
        onClick={handleSelectParameters}
        disabled={scanning || !files.length || !projectId}
        className="w-full py-3.5 bg-[#4A87BE] text-white text-[13px] uppercase tracking-widest font-bold hover:bg-[#2E6DA4] disabled:opacity-50 transition"
      >
        {scanning
          ? `Scanning ${files.length} file${files.length > 1 ? "s" : ""}...`
          : `Scan Files`}
      </button>

      {error && (
        <div className="mt-6 p-4 bg-[#F8F9FA] border-l-4 border-[#A63A3A] text-[#1A1F26] text-sm">
          {error}
        </div>
      )}

      {scanSummary && (
        <div className="mt-6 space-y-2">
          <div className="px-4 py-3 bg-[#F8F9FA] border border-[#E8EAED] text-xs font-bold uppercase tracking-widest text-[#3D4A58]">
            {scanSummary?.files_scanned > 0 && (
              <span className="text-[#4A87BE]">
                {scanSummary?.files_scanned} Succeeded
              </span>
            )}
            {scanSummary?.files_scanned > 0 &&
              scanSummary?.files_failed > 0 && <span>{" // "}</span>}
            {scanSummary?.files_failed > 0 && (
              <span className="text-[#A63A3A]">
                {scanSummary?.files_failed} Failed
              </span>
            )}
          </div>

          <div className="bg-white border border-[#E8EAED] p-6 space-y-6">
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-[#3D4A58] mb-2">
                Core Parameters
              </h4>
              <p className="text-[13px] text-[#1A1F26]">
                {scanSummary.core_params.join(", ")}
              </p>
            </div>

            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-[#3D4A58] mb-2">
                BGC Parameters
              </h4>
              <p className="text-[13px] text-[#1A1F26]">
                {scanSummary.bgc_params.join(", ")}
              </p>
            </div>

            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-[#3D4A58] mb-2">
                Optional Parameters
              </h4>
              <p className="text-[13px] text-[#1A1F26]">
                {scanSummary.available_extras.join(", ")}
              </p>
            </div>
          </div>

          <button
            className="w-[250px] py-3.5 bg-[#4A87BE] text-white text-[13px] uppercase tracking-widest font-bold hover:bg-[#2E6DA4] disabled:opacity-50 transition"
            onClick={() => setIsModalOpen(true)}
          >
            Configure Parameters
          </button>

          {/* Modal for parameter selection */}
          {isModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm">
              <div className="flex min-h-screen items-center justify-center p-6">
                <div className="relative w-full max-w-5xl bg-white border border-[#C8CDD4] shadow-2xl">
                  {/* Header */}
                  <div className="border-b border-[#C8CDD4] px-6 py-4">
                    <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[#3D4A58]">
                      Configure Import Parameters
                    </h3>
                  </div>

                  {/* Content */}
                  <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">
                    {/* Core Parameters */}
                    <div className="border border-[#E8EAED]">
                      <div className="px-4 py-2 bg-[#E8EAED] text-[11px] font-bold uppercase tracking-[0.15em] text-[#3D4A58]">
                        Core Parameters (Always Imported)
                      </div>

                      {scanSummary?.core_params?.map((param, index) => (
                        <label
                          key={param}
                          className={`flex items-center gap-3 px-4 py-2 text-[13px]
                  ${index % 2 === 0 ? "bg-white" : "bg-[#F8F9FA]"}`}
                        >
                          <input
                            type="checkbox"
                            checked
                            disabled
                            className="form-checkbox"
                          />
                          <span>{param}</span>
                        </label>
                      ))}
                    </div>

                    {/* BGC Parameters */}
                    {scanSummary?.bgc_params?.length > 0 && (
                      <div className="border border-[#E8EAED]">
                        <div className="px-4 py-2 bg-[#E8EAED] text-[11px] font-bold uppercase tracking-[0.15em] text-[#3D4A58]">
                          BGC Parameters
                        </div>

                        {scanSummary.bgc_params.map((param, index) => (
                          <label
                            key={param}
                            className={`flex items-center gap-3 px-4 py-2 text-[13px] cursor-pointer
                    ${index % 2 === 0 ? "bg-white" : "bg-[#F8F9FA]"}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedParams.includes(param)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedParams((prev) => [...prev, param]);
                                } else {
                                  setSelectedParams((prev) =>
                                    prev.filter((p) => p !== param),
                                  );
                                }
                              }}
                              className="form-checkbox"
                            />
                            <span>{param}</span>
                            <span className="ml-auto text-[#7A8A9A] text-[9px]">
                              BGC
                            </span>
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Optional Parameters */}
                    {scanSummary?.available_extras?.length > 0 && (
                      <div className="border border-[#E8EAED]">
                        <div className="px-4 py-2 bg-[#E8EAED] text-[11px] font-bold uppercase tracking-[0.15em] text-[#3D4A58]">
                          Optional Parameters
                        </div>

                        <div className="max-h-[300px] overflow-y-auto">
                          {scanSummary.available_extras.map((param, index) => (
                            <label
                              key={param}
                              className={`flex items-center gap-3 px-4 py-2 text-[13px] cursor-pointer ${index % 2 === 0 ? "bg-white" : "bg-[#F8F9FA]"}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedParams.includes(param)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedParams((prev) => [
                                      ...prev,
                                      param,
                                    ]);
                                  } else {
                                    setSelectedParams((prev) =>
                                      prev.filter((p) => p !== param),
                                    );
                                  }
                                }}
                                className="form-checkbox"
                              />
                              <span>{param}</span>
                              <span className="ml-auto text-[#7A8A9A] text-[9px]">
                                OPTIONAL
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="border-t border-[#C8CDD4] px-6 py-4 flex justify-end gap-3">
                    <button
                      onClick={() => setIsModalOpen(false)}
                      className="px-5 py-2 border border-[#C8CDD4] text-[12px] uppercase tracking-widest font-bold text-[#3D4A58] hover:bg-[#F8F9FA] transition"
                    >
                      Cancel
                    </button>

                    <button
                      onClick={() => {
                        handleUpload();
                        setIsModalOpen(false);
                      }}
                      className="px-5 py-2 bg-[#4A87BE] text-white text-[12px] uppercase tracking-widest font-bold hover:bg-[#2E6DA4] transition"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Results */}
      {results.length > 0 && (
        <div className="mt-6 space-y-4 border-t border-[#E8EAED] pt-6">
          <h3 className="text-[13px] font-bold uppercase tracking-widest text-[#3D4A58]">
            Processing Results
          </h3>
          <ul className="space-y-2">
            {results.map((res, i) => (
              <li
                key={`${res.filename}-${i}`}
                className={`p-4 border-l-4 text-sm ${res.status === "error"
                  ? "bg-[#F8F9FA] border-[#A63A3A] text-[#1A1F26]"
                  : "bg-[#F8F9FA] border-[#4A87BE] text-[#1A1F26]"
                  }`}
              >
                <div className="flex justify-between items-center font-bold mb-1 text-[11px] uppercase tracking-wider">
                  <span>{res.filename}</span>
                  <span
                    className={
                      res.status === "error" ? "text-[#A63A3A]" : "text-[#4A87BE]"
                    }
                  >
                    {res.status === "error" ? "Failed" : "Success"}
                  </span>
                </div>
                {res.status === "error" && (
                  <div className="text-[12px] text-[#A63A3A] mt-2">
                    {res.error}
                  </div>
                )}
                {res.status === "success" && res.profiles_inserted !== undefined && (
                  <div className="text-[12px] text-[#7A8A9A] mt-2">
                    Profiles inserted: {res.profiles_inserted} | Measurements inserted: {res.measurements_inserted}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
