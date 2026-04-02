"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { label: "Strategy", value: "strategy" },
  { label: "Depth Chart", value: "depth-chart" },
  { label: "Trade Chart", value: "trade-chart" },
] as const;

function TeamHqTabsInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get("tab") || "strategy";
  const basePath = pathname === "/team-snapshot" ? "/team-snapshot" : "/team-hq";

  return (
    <div className="mb-4 flex gap-1 rounded-lg border border-gray-800 bg-gray-900/60 p-1">
      {TABS.map((tab) => {
        const href = `${basePath}?tab=${encodeURIComponent(tab.value)}`;
        const isActive = active === tab.value;
        return (
          <Link
            key={tab.value}
            href={href}
            className={[
              "rounded-md px-4 py-2 text-sm font-semibold transition",
              isActive ? "bg-red-600/80 text-white" : "text-gray-400 hover:bg-white/5 hover:text-white",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

export default function TeamHqTabs() {
  return (
    <Suspense fallback={<div className="mb-4 h-10 rounded-lg border border-gray-800 bg-gray-900/60" />}>
      <TeamHqTabsInner />
    </Suspense>
  );
}
