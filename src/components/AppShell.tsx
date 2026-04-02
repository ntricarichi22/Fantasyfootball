"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeftRight, Compass, Gauge } from "lucide-react";

import { getLeagueId } from "../lib/config";

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";

type StoredSelection = {
  rosterId?: string;
  sessionId?: string;
  teamName?: string;
};

const readStoredSelection = (): StoredSelection => {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      rosterId: typeof parsed?.rosterId === "string" ? parsed.rosterId : undefined,
      sessionId: typeof parsed?.sessionId === "string" ? parsed.sessionId : undefined,
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : undefined,
    };
  } catch {
    return {};
  }
};

const safeLeagueId = () => {
  try {
    return getLeagueId();
  } catch {
    return "";
  }
};

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [selection, setSelection] = useState<StoredSelection>(() => readStoredSelection());

  useEffect(() => {
    const stored = readStoredSelection();
    if (!stored.rosterId) {
      router.replace("/");
    }
    const handleStorage = () => {
      setSelection(readStoredSelection());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [router]);

  /* ---- Unread trade count ---- */
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const stored = readStoredSelection();
      if (!stored.rosterId) return;
      try {
        const res = await fetch(`/api/trades/unread-count?teamId=${encodeURIComponent(stored.rosterId)}`);
        if (res.ok && !cancelled) {
          const json = await res.json();
          setUnreadCount(typeof json.count === "number" ? json.count : 0);
        }
      } catch {
        // ignore fetch errors
      }
    };

    poll();
    const interval = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selection.rosterId]);

  const navItems = useMemo(
    () => [
      { href: "/draft", label: "Draft Room", icon: Compass },
      { href: "/team-hq", label: "Team HQ", icon: Gauge },
      { href: "/trades", label: "Trade Center", icon: ArrowLeftRight, badge: true },
    ],
    []
  );

  const handleSwitchTeam = async () => {
    const stored = readStoredSelection();
    const leagueId = safeLeagueId();

    if (stored.rosterId && stored.sessionId && leagueId) {
      try {
        await fetch("/api/active-teams/release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leagueId,
            rosterId: stored.rosterId,
            sessionId: stored.sessionId,
          }),
          keepalive: true,
        });
      } catch {
        // ignore release errors
      }
    }

    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SELECTED_TEAM_CACHE_KEY);
    }
    setSelection({});
    router.replace("/");
  };

  const teamName =
    selection.teamName || (selection.rosterId ? `Team ${selection.rosterId}` : "Not selected");

  return (
    <div className="flex min-h-screen bg-[#0b0c10] text-white">
      <aside className="flex h-screen w-60 flex-col border-r border-white/5 bg-[#0f1118] px-4 py-6">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-red-600/20 ring-1 ring-red-500/40">
            <Image
              src="/file.svg"
              alt="CFC logo"
              width={32}
              height={32}
              className="object-contain opacity-90"
            />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-gray-400">CFC Draft</p>
            <p className="text-base font-semibold text-white">2026 Command</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isTradeCenterItem = item.href === "/trades";
            const active = isTradeCenterItem
              ? (pathname === "/trades" ||
                  pathname?.startsWith("/trades/") ||
                  pathname === "/trade-studio" ||
                  pathname === "/trade-builder")
              : item.href === "/team-hq"
                ? (pathname === "/team-hq" ||
                    pathname?.startsWith("/team-hq/") ||
                    pathname === "/team-snapshot")
                : (pathname === item.href || pathname?.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition",
                  active
                    ? "bg-red-600/80 text-white shadow-[0_10px_30px_rgba(239,68,68,0.22)]"
                    : "text-gray-300 hover:bg-white/5 hover:text-white",
                ].join(" ")}
              >
                <Icon
                  className={[
                    "h-5 w-5 transition",
                    active ? "text-white" : "text-gray-400 group-hover:text-white",
                  ].join(" ")}
                />
                <span className="flex-1">{item.label}</span>
                {"badge" in item && item.badge && unreadCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 rounded-lg border border-white/5 bg-white/5 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Team</p>
          <p className="mt-1 text-sm font-semibold text-white">{teamName || "Not selected"}</p>
          <button
            type="button"
            onClick={handleSwitchTeam}
            className="mt-3 w-full rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            Switch Team
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col bg-[#0b0c10]">
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
