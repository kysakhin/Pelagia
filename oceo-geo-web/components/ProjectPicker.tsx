"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getUserProjects,
  createProject,
  type Project,
} from "@/lib/actions/projects";

export default function ProjectPicker() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New project form state
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [piName, setPiName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const data = await getUserProjects();
      setProjects(data);
    } catch (err) {
      setError("Failed to load projects.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const project = await createProject(
        name.trim(),
        description.trim() || undefined,
        piName.trim() || undefined
      );
      // Navigate to the new project's chat UI.
      router.push(`/p/${project.project_id}`);
    } catch {
      setError("Failed to create project.");
      setCreating(false);
    }
  };

  return (
    <div
      className="flex flex-col items-center gap-8 text-center max-w-[1000px] mx-auto py-20 px-8"
      style={{
        fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
      }}
    >
      {/* Header */}
      <div className="flex flex-col gap-4 items-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-[#2E6DA4] flex items-center gap-4">
          <div className="w-6 h-[1px] bg-[#4A87BE]"></div>
          Dashboard
          <div className="w-6 h-[1px] bg-[#4A87BE]"></div>
        </span>
        <h2 className="text-5xl md:text-[64px] font-light text-[#1A1F26] leading-tight">
          Welcome Back.
        </h2>
        <p className="font-serif text-[18px] text-[#3D4A58] max-w-[500px] leading-[1.75]">
          Select a project to start chatting with your oceanographic data, or
          upload new NetCDF files to begin.
        </p>
      </div>

      {/* Actions row */}
      <div className="flex gap-3 mt-2">
        <button
          onClick={() => setShowForm(!showForm)}
          className="border border-[#2E6DA4] text-[#4A87BE] px-6 py-2.5 rounded-sm text-[12px] uppercase tracking-widest hover:bg-[#2E6DA4] hover:text-white transition-all"
        >
          + New Project
        </button>
        <Link
          href="/upload"
          className="border border-[#C8CDD4] text-[#3D4A58] px-6 py-2.5 rounded-sm text-[12px] uppercase tracking-widest hover:border-[#5C7A96] hover:text-[#5C7A96] transition-all"
        >
          Upload Data
        </Link>
      </div>

      {/* New project form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="w-full max-w-md bg-white border border-[#C8CDD4] rounded-sm p-8 text-left shadow-[0_4px_24px_rgba(0,0,0,0.02)]"
        >
          <h3 className="text-[18px] font-light text-[#1A1F26] mb-6">
            Create New Project
          </h3>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">
                Project Name
              </label>
              <input
                required
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border border-[#C8CDD4] px-4 py-2 text-sm rounded-sm focus:outline-none focus:border-[#4A87BE] text-[#1A1F26]"
                placeholder="Arctic Float 2024"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="border border-[#C8CDD4] px-4 py-2 text-sm rounded-sm focus:outline-none focus:border-[#4A87BE] text-[#1A1F26]"
                placeholder="North Atlantic drift trajectories"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">
                PI Name (optional)
              </label>
              <input
                type="text"
                value={piName}
                onChange={(e) => setPiName(e.target.value)}
                className="border border-[#C8CDD4] px-4 py-2 text-sm rounded-sm focus:outline-none focus:border-[#4A87BE] text-[#1A1F26]"
                placeholder="Dr. Jane Doe"
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setName("");
                  setDescription("");
                  setPiName("");
                }}
                className="flex-1 border border-[#C8CDD4] text-[#3D4A58] py-2.5 rounded-sm text-[12px] uppercase tracking-widest hover:bg-[#F0F2F4] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="flex-1 bg-[#1A1F26] text-white py-2.5 rounded-sm text-[12px] uppercase tracking-widest hover:bg-[#2E6DA4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Error message */}
      {error && (
        <p className="text-[13px] text-[#8A3A3A] font-serif">{error}</p>
      )}

      {/* Projects grid */}
      {loading ? (
        <div className="text-[13px] text-[#7A8A9A] tracking-wide">
          Loading projects…
        </div>
      ) : projects.length === 0 && !showForm ? (
        <div className="bg-white border border-[#C8CDD4] rounded-sm p-16 text-center shadow-[0_4px_24px_rgba(0,0,0,0.02)] max-w-2xl">
          <div className="w-12 h-12 mx-auto mb-6 rounded outline-2 outline-offset-2 outline-transparent border-2 border-[#5C7A96] flex items-center justify-center relative">
            <div className="w-[2px] h-6 bg-[#5C7A96] absolute" />
            <div className="w-6 h-[2px] bg-[#5C7A96] absolute" />
          </div>
          <h2 className="text-2xl font-light text-[#1A1F26]">No projects yet</h2>
          <p className="font-serif text-[16px] text-[#7A8A9A] mt-3 mb-8">
            Create a new project or upload NetCDF files to get started.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setShowForm(true)}
              className="border border-[#2E6DA4] text-[#4A87BE] px-6 py-2.5 rounded-sm text-sm hover:bg-[#2E6DA4] hover:text-white transition-all font-medium"
            >
              Create Project
            </button>
            <Link
              href="/upload"
              className="border border-[#C8CDD4] text-[#3D4A58] px-6 py-2.5 rounded-sm text-sm hover:bg-[#F0F2F4] transition-all font-medium"
            >
              Upload Files
            </Link>
          </div>
        </div>
      ) : (
        projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[2px] border border-[#DDE1E6] rounded-sm overflow-hidden w-full">
            {projects.map((project) => (
              <Link
                key={project.project_id}
                href={`/p/${project.project_id}`}
                className="group bg-white p-8 hover:bg-[#EBEEF1] hover:border-t-2 hover:border-t-[#2E6DA4] transition-all flex flex-col border border-transparent min-h-[200px]"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] uppercase text-[#4A87BE] tracking-wider font-bold">
                    Project
                  </span>
                  <span className="text-[12px] text-[#7A8A9A] font-serif italic">
                    {project.created_at
                      ? new Date(project.created_at).toLocaleDateString()
                      : ""}
                  </span>
                </div>
                <h3 className="text-[22px] font-normal mb-3 text-[#1A1F26] group-hover:text-[#2E6DA4] transition-colors line-clamp-1">
                  {project.project_name}
                </h3>
                <p className="font-serif text-[15px] text-[#3D4A58] leading-relaxed line-clamp-2 mb-6 flex-1">
                  {project.description ||
                    "No description provided. Contains oceanographic telemetry data."}
                </p>
                <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-[#7A8A9A]">
                  <span>
                    {project.pi_name ? `PI: ${project.pi_name}` : "—"}
                  </span>
                  <span className="text-[#2E6DA4] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    Open <span className="text-[#4A87BE]">→</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )
      )}

      {/* Legacy link for backward compatibility */}
      {projects.length > 0 && (
        <Link
          href="/projects"
          className="text-[11px] uppercase tracking-widest text-[#B0B8C2] hover:text-[#7A8A9A] transition-colors mt-4"
        >
          View old workspace →
        </Link>
      )}
    </div>
  );
}
