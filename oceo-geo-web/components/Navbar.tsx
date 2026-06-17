'use client';

import { Show, SignInButton, SignUpButton, UserButton, SignOutButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { getUserProjects } from "@/lib/actions/projects";
import type { Project } from "@/lib/actions/projects";

const EXPLORE_OPTIONS = [
  { label: "Chat", getHref: (id: number) => `/projects/${id}/chat` },
  { label: "Basic Charts", getHref: (id: number) => `/projects/${id}?tab=charts` },
  { label: "Advanced Charts", getHref: (id: number) => `/projects/${id}/analytics` },
  { label: "Statistics", getHref: (id: number) => `/projects/${id}?tab=statistics` },
] as const;

type ExploreOption = typeof EXPLORE_OPTIONS[number];

export default function Navbar() {
  const { isSignedIn, isLoaded } = useUser();
  const hasFetched = useRef(false);
  const [showEarlyAccess, setShowEarlyAccess] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [activeOption, setActiveOption] = useState<ExploreOption | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  useEffect(() => {
    // Wait until Clerk has resolved auth state
    if (!isLoaded) return;
    // Only fetch once on mount, and only if signed in
    if (!isSignedIn || hasFetched.current) {
      setLoadingProjects(false);
      return;
    }

    hasFetched.current = true;
    setLoadingProjects(true);
    getUserProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  const handleExploreOptionClick = (option: ExploreOption) => {
    setActiveOption(option);
    setExploreOpen(false);
  };

  const closeProjectModal = () => {
    setActiveOption(null);
    setProjects([]);
  };

  return (
    <>
      <nav className="sticky top-0 z-50 flex items-center justify-between px-8 py-4 bg-white/90 backdrop-blur-sm border-b border-[#C8CDD4]" style={{ fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
        {/* Logo/Brand */}
        <Link href="/" className="flex items-center gap-2">
          <div className="w-3 h-3 bg-[#4A87BE]" />
          <span className="font-light tracking-widest uppercase text-[#1A1F26]">OceoGeo</span>
        </Link>

        {/* Navigation Links - Signed In */}
        <Show when="signed-in">
          <div className="hidden md:flex items-center gap-8 text-[13px] uppercase tracking-wide text-[#3D4A58]">
            <Link href="/projects" className="hover:text-[#4A87BE] transition-colors">
              Projects
            </Link>
            {/* Explore Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setExploreOpen(true)}
              onMouseLeave={() => setExploreOpen(false)}
            >
              <button className="flex items-center gap-1.5 hover:text-[#4A87BE] transition-colors uppercase tracking-wide text-[13px]">
                Explore
                <svg
                  className={`w-3 h-3 transition-transform duration-150 ${exploreOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {exploreOpen && (
                <div className="absolute top-full left-0 mt-3 bg-white border border-[#C8CDD4] shadow-[0_8px_32px_rgba(0,0,0,0.08)] rounded-sm py-1.5 min-w-42 z-50">
                  {EXPLORE_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => handleExploreOptionClick(opt)}
                      className="w-full text-left px-5 py-2.5 text-[12px] uppercase tracking-wide text-[#3D4A58] hover:text-[#4A87BE] hover:bg-[#F4F7FA] transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Link href="/docs" className="hover:text-[#4A87BE] transition-colors">
              Documentation
            </Link>
          </div>
        </Show>

        {/* Navigation Links - Signed Out */}
        <Show when="signed-out">
          <div className="hidden md:flex gap-8 text-[13px] uppercase tracking-wide text-[#3D4A58]">
            <a href="#platform" className="hover:text-[#4A87BE] transition-colors">Platform</a>
            <a href="#features" className="hover:text-[#4A87BE] transition-colors">Features</a>
            <a href="#research" className="hover:text-[#4A87BE] transition-colors">Research</a>
            <a href="#pricing" className="hover:text-[#4A87BE] transition-colors">Pricing</a>
            <Link href="/docs" className="hover:text-[#4A87BE] transition-colors">Documentation</Link>
          </div>
        </Show>

        {/* Auth Actions */}
        <div className="flex items-center gap-4">
          <Show when="signed-in">
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="text-[13px] uppercase tracking-wide text-[#3D4A58] hover:text-[#4A87BE] transition-colors">
                Sign In
              </button>
            </SignInButton>

            <button
              onClick={() => setShowEarlyAccess(true)}
              className="border border-[#2E6DA4] text-[#4A87BE] px-6 py-2 rounded-sm text-sm hover:bg-linear-to-br hover:from-[#2E6DA4] hover:to-[#5C7A96] hover:text-white transition-all ml-2"
            >
              Request Early Access
            </button>
          </Show>
        </div>
      </nav>

      {/* Project Selection Modal */}
      {activeOption && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center bg-[#1A1F26]/40 backdrop-blur-sm"
          style={{ fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeProjectModal(); }}
        >
          <div className="bg-white border border-[#C8CDD4] rounded-sm p-10 max-w-md w-full shadow-[0_24px_80px_rgba(0,0,0,0.12)]">
            <h3 className="text-2xl font-light text-[#1A1F26] mb-2">{activeOption.label}</h3>
            <p className="text-[14px] text-[#7A8A9A] mb-8 font-serif">Select a project to continue.</p>

            {loadingProjects ? (
              <div className="text-[13px] text-[#7A8A9A] py-8 text-center tracking-wide">
                Loading projects...
              </div>
            ) : projects.length === 0 ? (
              <div className="text-[13px] text-[#7A8A9A] py-8 text-center tracking-wide">
                No projects found.{' '}
                <Link href="/projects" className="text-[#4A87BE] hover:underline" onClick={closeProjectModal}>
                  Create one
                </Link>.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                {projects.map((project) => (
                  <Link
                    key={project.project_id}
                    href={activeOption.getHref(project.project_id)}
                    onClick={closeProjectModal}
                    className="flex items-center justify-between px-4 py-3 border border-[#C8CDD4] rounded-sm text-[13px] text-[#1A1F26] hover:border-[#4A87BE] hover:text-[#4A87BE] hover:bg-[#F4F8FC] transition-all"
                  >
                    <span className="font-light">{project.project_name}</span>
                    <svg className="w-3.5 h-3.5 text-[#C8CDD4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}

            <div className="mt-8">
              <button
                onClick={closeProjectModal}
                className="w-full border border-[#C8CDD4] text-[#3D4A58] py-3 rounded-sm text-sm hover:bg-[#F0F2F4] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Early Access Modal */}
      {showEarlyAccess && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-[#1A1F26]/40 backdrop-blur-sm" style={{ fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
          <div className="bg-white border border-[#C8CDD4] rounded-sm p-10 max-w-md w-full shadow-[0_24px_80px_rgba(0,0,0,0.12)]">
            <h3 className="text-2xl font-light text-[#1A1F26] mb-2">Request Early Access</h3>
            <p className="text-[14px] text-[#7A8A9A] mb-8 font-serif">Join the waitlist to test OceoGeo before public release.</p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                console.log("Early access request submitted");
                alert("Thank you! Your request has been logged.");
                setShowEarlyAccess(false);
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">Full Name</label>
                <input required type="text" className="border border-[#C8CDD4] px-4 py-2 text-sm rounded-sm focus:outline-none focus:border-[#4A87BE] text-[#1A1F26]" placeholder="Dr. Jane Doe" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">Institution / Organization</label>
                <input required type="text" className="border border-[#C8CDD4] px-4 py-2 text-sm rounded-sm focus:outline-none focus:border-[#4A87BE] text-[#1A1F26]" placeholder="Scripps Institution of Oceanography" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] uppercase tracking-widest text-[#7A8A9A]">Academic Email</label>
                <input required type="email" className="border border-[#C8CDD4] px-4 py-2 text-sm rounded-sm focus:outline-none focus:border-[#4A87BE] text-[#1A1F26]" placeholder="jane.doe@institution.edu" />
              </div>

              <div className="flex gap-4 mt-6">
                <button type="button" onClick={() => setShowEarlyAccess(false)} className="flex-1 border border-[#C8CDD4] text-[#3D4A58] py-3 rounded-sm text-sm hover:bg-[#F0F2F4] transition-colors">
                  Cancel
                </button>
                <button type="submit" className="flex-1 bg-linear-to-br from-[#2E6DA4] to-[#5C7A96] text-white py-3 rounded-sm text-sm hover:opacity-90 transition-opacity">
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
