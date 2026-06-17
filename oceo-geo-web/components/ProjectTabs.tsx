"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface ProjectTabsProps {
  projectId: number;
  children: ReactNode;
}

export default function ProjectTabs({ projectId, children }: ProjectTabsProps) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "overview";

  return (
    <div className="w-full">
      <div className="border-b border-gray-200 mb-8">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <Link
            href={`/projects/${projectId}?tab=overview`}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
              ${
                tab === "overview"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }
            `}
          >
            Overview
          </Link>

          <Link
            href={`/projects/${projectId}?tab=charts`}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
              ${
                tab === "charts"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }
            `}
          >
            Basic Charts
          </Link>

          <Link
            href={`/projects/${projectId}?tab=statistics`}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
              ${
                tab === "statistics"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }
            `}
          >
            Basic Statistics
          </Link>
        </nav>
      </div>

      <div className="tab-content">{children}</div>
    </div>
  );
}