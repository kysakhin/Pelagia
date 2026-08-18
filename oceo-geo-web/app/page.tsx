'use client';

import { Show } from "@clerk/nextjs";
import SignedOutContent from "@/components/SignedOutContent";
import ProjectPicker from "@/components/ProjectPicker";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#F8F9FA]">
      <Show when="signed-in">
        <div className="flex-1 flex flex-col items-center justify-center pt-8">
          <ProjectPicker />
        </div>
      </Show>
      <Show when="signed-out">
        <SignedOutContent />
      </Show>
    </div>
  );
}
