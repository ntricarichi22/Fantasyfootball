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
    <div className="cfc-tabs mb-5">
      {TABS.map((tab) => {
        const href = `${basePath}?tab=${encodeURIComponent(tab.value)}`;
        const isActive = active === tab.value;
        return (
          <Link
            key={tab.value}
            href={href}
            className={["cfc-tab", isActive ? "cfc-tab-active" : ""].join(" ")}
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
    <Suspense fallback={<div className="cfc-tabs mb-5" style={{ height: 40 }} />}>
      <TeamHqTabsInner />
    </Suspense>
  );
}
