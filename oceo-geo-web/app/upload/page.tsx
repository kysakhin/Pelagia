"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import {
  getUserProjects,
  createProject,
  type Project,
} from "@/lib/actions/projects";
import FileUpload from "@/components/FileUpload";

export default function UploadPage() {
  const { isSignedIn, isLoaded } = useUser();

  /* ── project state ─────────────────────────────────────── */
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPi, setNewPi] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── load projects ─────────────────────────────────────── */
  const loadProjects = useCallback(async () => {
    try {
      const data = await getUserProjects();
      setProjects(data);
    } catch (err) {
      console.error("Failed to load projects", err);
    }
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) loadProjects();
  }, [isLoaded, isSignedIn, loadProjects]);

  /* ── handlers ──────────────────────────────────────────── */
  async function handleCreateProject() {
    if (!newName.trim()) return;
    setCreatingProject(true);
    try {
      const project = await createProject(
        newName.trim(),
        newDesc.trim() || undefined,
        newPi.trim() || undefined,
      );
      setProjects((prev) => [project, ...prev]);
      setSelectedProjectId(String(project.project_id));
      setShowNewProject(false);
      setNewName("");
      setNewDesc("");
      setNewPi("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      setError(msg);
    } finally {
      setCreatingProject(false);
    }
  }

  /* ── render guards ─────────────────────────────────────── */
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }
  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        Please sign in to upload files.
      </div>
    );
  }

  /* ── UI ────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[#F8F9FA] font-['Helvetica_Neue',Helvetica,Arial,sans-serif] pb-16">
      <div className="bg-white border-b border-[#C8CDD4] px-4 py-8 md:py-12 mb-8">
        <div className="max-w-[700px] mx-auto px-4 md:px-0 flex flex-col items-start gap-4">
          <div className="w-8 h-8 rounded outline outline-2 outline-offset-2 outline-transparent border-2 border-[#4A87BE] flex items-center justify-center shrink-0">
             <div className="w-2 h-2 bg-[#4A87BE]" />
          </div>
          <h1 className="text-3xl md:text-4xl font-light text-[#1A1F26]">
            Upload Data
          </h1>
          <p className="text-sm md:text-base text-[#7A8A9A] max-w-lg leading-relaxed">
             Import NetCDF (.nc, .nc4) trajectory files into your scientific projects.
          </p>
        </div>
      </div>

      <div className="max-w-[700px] mx-auto px-4 md:px-0">
        {/* ── Project Selection ────────────────────────── */}
        <section className="bg-white border border-[#C8CDD4] p-8 mb-6">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[#3D4A58] mb-6">1. Target Project</h2>

          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full bg-[#F8F9FA] border border-[#C8CDD4] px-4 py-3 text-sm text-[#1A1F26] focus:border-[#4A87BE] focus:ring-0 focus:outline-none transition appearance-none rounded-none"
            style={{ 
              backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%237A8A9A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 1rem center",
              backgroundSize: "1em",
              paddingRight: "2.5rem"
            }}
          >
            <option value="" className="text-[#7A8A9A]">— Select an existing project —</option>
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.project_name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowNewProject((v) => !v)}
            className="mt-4 text-[11px] font-bold uppercase tracking-widest text-[#4A87BE] hover:text-[#2E6DA4] transition"
          >
            {showNewProject ? "Cancel Creation" : "+ Create New Project"}
          </button>

          {showNewProject && (
            <div className="mt-6 border border-[#C8CDD4] p-5 space-y-4 bg-[#F8F9FA]">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#3D4A58] mb-2">New Project Details</h3>
              <input
                type="text"
                placeholder="Project Name *"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-white border border-[#C8CDD4] px-4 py-3 text-sm text-[#1A1F26] placeholder-[#7A8A9A] focus:border-[#4A87BE] focus:outline-none transition rounded-none"
              />
              <input
                type="text"
                placeholder="Description (Optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full bg-white border border-[#C8CDD4] px-4 py-3 text-sm text-[#1A1F26] placeholder-[#7A8A9A] focus:border-[#4A87BE] focus:outline-none transition rounded-none"
              />
              <input
                type="text"
                placeholder="Principal Investigator / Team (Optional)"
                value={newPi}
                onChange={(e) => setNewPi(e.target.value)}
                className="w-full bg-white border border-[#C8CDD4] px-4 py-3 text-sm text-[#1A1F26] placeholder-[#7A8A9A] focus:border-[#4A87BE] focus:outline-none transition rounded-none"
              />
              
              <div className="pt-2 flex items-center justify-between">
                {error ? (
                  <p className="text-[12px] text-[#A63A3A]">{error}</p>
                ) : <span />}
                
                <button
                  onClick={handleCreateProject}
                  disabled={creatingProject || !newName.trim()}
                  className="bg-[#4A87BE] text-white px-6 py-2.5 text-[12px] uppercase tracking-wider font-bold hover:bg-[#2E6DA4] disabled:opacity-50 transition min-w-[140px]"
                >
                  {creatingProject ? "Creating..." : "Initialize"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ── Reusable Component handles File selection and Uploading ──────────────────────────── */}
        {selectedProjectId && (
           <div className="bg-white border border-[#C8CDD4] p-8">
             <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[#3D4A58] mb-6">2. Select Files</h2>
             <FileUpload projectId={selectedProjectId} />
           </div>
        )}
      </div>
    </div>
  );
}
