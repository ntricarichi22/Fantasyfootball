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
    <div className="cfc-tabs mb-5">
      {TABS.map((tab) => {
        const active = isTabActive(tab.href, pathname ?? "", searchParams);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={["cfc-tab", active ? "cfc-tab-active" : ""].join(" ")}
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
    <Suspense fallback={<div className="cfc-tabs mb-5" style={{ height: 40 }} />}>
      <TradeCenterTabsInner />
    </Suspense>
  );
}
