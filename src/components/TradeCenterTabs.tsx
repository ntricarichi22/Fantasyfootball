"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { label: "Active", href: "/trades?view=active" },
  { label: "History", href: "/trades?view=history" },
  { label: "AI Generator", href: "/trade-studio" },
  { label: "Trade Machine", href: "/trade-builder" },
] as const;

function isTabActive(href: string, pathname: string, searchParams: ReturnType<typeof useSearchParams>): boolean {
  if (href === "/trades?view=active") {
    const view = searchParams.get("view");
    return pathname === "/trades" && view !== "history";
  }
  if (href === "/trades?view=history") {
    return pathname === "/trades" && searchParams.get("view") === "history";
  }
  // AI Generator and Trade Machine: exact path match
  const path = href.split("?")[0];
  return pathname === path || pathname?.startsWith(`${path}/`);
}

function TradeCenterTabsInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="mb-4 flex gap-1 rounded-lg border border-gray-800 bg-gray-900/60 p-1">
      {TABS.map((tab) => {
        const active = isTabActive(tab.href, pathname ?? "", searchParams);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              "rounded-md px-4 py-2 text-sm font-semibold transition",
              active
                ? "bg-red-600/80 text-white"
                : "text-gray-400 hover:bg-white/5 hover:text-white",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

export default function TradeCenterTabs() {
  return (
    <Suspense fallback={<div className="mb-4 h-10 rounded-lg border border-gray-800 bg-gray-900/60" />}>
      <TradeCenterTabsInner />
    </Suspense>
  );
}
