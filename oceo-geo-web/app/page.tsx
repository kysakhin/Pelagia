'use client';

import { Show } from "@clerk/nextjs";
import SignedOutContent from "@/components/SignedOutContent";

function SignedInContent() {
  return (
    <div className="flex flex-col items-center gap-8 text-center max-w-[800px] mx-auto py-20 px-8" style={{ fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
      <div className="flex flex-col gap-4 items-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-[#2E6DA4] flex items-center gap-4">
          <div className="w-6 h-[1px] bg-[#4A87BE]"></div>
          Dashboard
          <div className="w-6 h-[1px] bg-[#4A87BE]"></div>
        </span>
        <h2 className="text-5xl md:text-[64px] font-light text-[#1A1F26] leading-tight">Welcome Back.</h2>
        <p className="font-serif text-[18px] text-[#3D4A58] max-w-[500px] leading-[1.75]">
          Continue exploring your oceanographic datasets, manage your projects, or upload new NetCDF files to generate insights.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mt-8 text-left">
        <a href="/projects" className="bg-white border border-[#C8CDD4] rounded-sm p-10 hover:border-[#2E6DA4] hover:-translate-y-1 transition-all group flex flex-col justify-between min-h-[220px]">
          <div>
            <div className="w-8 h-8 mb-6 border-b-2 border-[#2E6DA4] flex flex-col justify-center gap-1.5 pl-1">
               <div className="w-full h-[2px] bg-[#2E6DA4]" />
               <div className="w-2/3 h-[2px] bg-[#2E6DA4]" />
               <div className="w-full h-[2px] bg-[#2E6DA4]" />
            </div>
            <h3 className="text-2xl font-light mb-3 text-[#1A1F26]">Active Projects</h3>
            <p className="font-serif text-[15px] text-[#7A8A9A] leading-relaxed">Access your previously uploaded datasets, view saved visualizations, and continue your natural language queries.</p>
          </div>
          <span className="text-[13px] font-medium uppercase tracking-widest text-[#2E6DA4] mt-8 flex items-center gap-2 group-hover:gap-3 transition-all">
            View Workspace <span className="text-[#4A87BE]">→</span>
          </span>
        </a>

        <a href="/upload" className="bg-white border border-[#C8CDD4] rounded-sm p-10 hover:border-[#5C7A96] hover:-translate-y-1 transition-all group flex flex-col justify-between min-h-55 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <div>
            <div className="w-8 h-8 mb-6 rounded outline-2 outline-offset-2 outline-transparent border-2 border-[#5C7A96] flex items-center justify-center relative">
              <div className="w-[2px] h-4 bg-[#5C7A96] absolute" />
              <div className="w-4 h-[2px] bg-[#5C7A96] absolute" />
            </div>
            <h3 className="text-2xl font-light mb-3 text-[#1A1F26]">Upload New Data</h3>
            <p className="font-serif text-[15px] text-[#7A8A9A] leading-relaxed">Initialize a new workspace with NetCDF files. The platform will automatically parse dimensions and variables.</p>
          </div>
          <span className="text-[13px] font-medium uppercase tracking-widest text-[#5C7A96] mt-8 flex items-center gap-2 group-hover:gap-3 transition-all">
            Initialize Project <span className="text-[#7B9BB8]">→</span>
          </span>
        </a>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#F8F9FA]">
      <Show when="signed-in">
        <div className="flex-1 flex flex-col items-center justify-center pt-8">
          <SignedInContent />
        </div>
      </Show>
      <Show when="signed-out">
        <SignedOutContent />
      </Show>
    </div>
  );
}
