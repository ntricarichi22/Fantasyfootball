"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getLeagueId } from "../lib/config";
import ClockBar from "./ClockBar";
import { DraftStatusProvider } from "./DraftStatusProvider";
import { readStoredTeam, SELECTED_TEAM_CACHE_KEY, type StoredTeam } from "../lib/storedTeam";

type StoredSelection = StoredTeam;

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
  const [selection, setSelection] = useState<StoredSelection>(() => readStoredTeam());

  useEffect(() => {
    const stored = readStoredTeam();
    if (!stored.rosterId) {
      router.replace("/");
    }
    const handleStorage = () => {
      setSelection(readStoredTeam());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [router]);

  /* ---- Unread trade count ---- */
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const stored = readStoredTeam();
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
      { href: "/draft", label: "Draft Room" },
      { href: "/historian", label: "Historian" },
      { href: "/team-hq", label: "Team HQ" },
      { href: "/trades", label: "Trade Center", badge: true as const },
    ],
    []
  );

  const handleSwitchTeam = async () => {
    const stored = readStoredTeam();
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
    <DraftStatusProvider>
      <div className="flex min-h-screen flex-col bg-[var(--cfc-canvas)] text-[var(--cfc-ink)]">
        {/* TOP BAR — ink/black, yellow CFC logo, underlined active nav */}
        <header className="cfc-topbar cfc-shell-chrome sticky top-0 z-40">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
            <Link href="/" className="cfc-topbar-logo shrink-0" aria-label="CFC home">
              CFC
            </Link>

            <nav className="flex flex-1 items-center gap-5 overflow-x-auto cfc-no-scrollbar">
              {navItems.map((item) => {
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
                      "cfc-topbar-link relative",
                      active ? "cfc-topbar-link-active" : "",
                    ].join(" ")}
                  >
                    <span>{item.label}</span>
                    {item.badge && unreadCount > 0 && (
                      <span
                        className="ml-2 inline-flex h-4 min-w-4 items-center justify-center px-1 align-middle"
                        style={{
                          background: "var(--cfc-red)",
                          color: "#fff",
                          border: "1.5px solid #1A1A1A",
                          borderRadius: "4px",
                          fontFamily: "var(--font-mono)",
                          fontSize: "9px",
                          fontWeight: 800,
                          lineHeight: 1,
                        }}
                      >
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="hidden sm:flex items-center gap-3">
              <div className="text-right leading-tight">
                <p
                  className="text-[9px] font-bold uppercase tracking-[0.18em]"
                  style={{ color: "#999" }}
                >
                  Active Team
                </p>
                <p className="text-xs font-semibold text-white truncate max-w-[180px]">
                  {teamName}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSwitchTeam}
                className="cfc-btn cfc-btn-accent cfc-btn-sm"
              >
                Switch
              </button>
            </div>
          </div>
        </header>

        {/* CLOCK BAR — gated on isActive via DraftStatusProvider */}
        <div className="cfc-shell-chrome">
          <ClockBar />
        </div>

        {/* CONTENT */}
        <main className="flex-1 bg-[var(--cfc-canvas)]">{children}</main>
      </div>
    </DraftStatusProvider>
  );
}
