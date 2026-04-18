"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageCircle } from "lucide-react";
import TradeCenterTabs from "../../../components/TradeCenterTabs";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface TradeThread {
  id: string;
  league_id: string;
  team_a_id: string;
  team_b_id: string;
  created_by_team_id: string;
  status: string;
  last_activity_at: string;
  last_message_at: string | null;
  last_offer_at: string | null;
  unread_by_team_a: number;
  unread_by_team_b: number;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/*  Session helpers                                                     */
/* ------------------------------------------------------------------ */

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";

const getStoredTeam = () => {
  if (typeof window === "undefined") return { rosterId: "", teamName: "" };
  try {
    const raw = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!raw) return { rosterId: "", teamName: "" };
    const parsed = JSON.parse(raw);
    return {
      rosterId: typeof parsed?.rosterId === "string" ? parsed.rosterId : "",
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : "",
    };
  } catch {
    return { rosterId: "", teamName: "" };
  }
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const threadStatusClass: Record<string, string> = {
  open: "cfc-chip cfc-chip-yellow",
  accepted: "cfc-chip cfc-chip-blue",
  declined: "cfc-chip cfc-chip-red",
  withdrawn: "cfc-chip",
  closed: "cfc-chip cfc-chip-ink",
};

const timeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

async function fetchRosterNames(): Promise<Record<string, string>> {
  if (!LEAGUE_ID_ENV) return {};
  try {
    const [rostersRes, usersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/users`),
    ]);
    if (!rostersRes.ok || !usersRes.ok) return {};
    const rosters = await rostersRes.json();
    const users = await usersRes.json();
    const userMap: Record<string, string> = {};
    for (const u of users) {
      const name = u.metadata?.team_name || u.display_name || u.user_id;
      userMap[u.user_id] = name;
    }
    const map: Record<string, string> = {};
    for (const r of rosters) {
      const rid = String(r.roster_id);
      map[rid] = userMap[r.owner_id] || `Team ${rid}`;
    }
    return map;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function TradesInboxPage() {
  return (
    <Suspense>
      <TradesInboxPageInner />
    </Suspense>
  );
}

function TradesInboxPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "history" ? "history" : "active";
  const [threads, setThreads] = useState<TradeThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const { rosterId, teamName } = getStoredTeam();

  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  const fetchThreads = useCallback(async () => {
    if (!rosterId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/trades/threads?teamId=${encodeURIComponent(rosterId)}`,
      );
      if (res.ok) {
        const json = await res.json();
        setThreads(json.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [rosterId]);

  useEffect(() => {
    fetchThreads();
    // Poll for real-time updates every 10 s
    const interval = setInterval(fetchThreads, 10_000);
    return () => clearInterval(interval);
  }, [fetchThreads]);

  const getTeamLabel = (teamId: string) => rosterNames[teamId] || `Team ${teamId}`;

  // For "active" view: show only open threads; for "history": show accepted/declined
  const filteredThreads =
    view === "history"
      ? threads.filter((t) => t.status === "accepted" || t.status === "declined")
      : threads.filter((t) => t.status === "open");

  return (
    <main className="min-h-[calc(100vh-44px)] bg-[var(--cfc-canvas)] text-[var(--cfc-ink)]">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-6 sm:px-6">
        {/* Header */}
        <header className="mb-5 flex flex-wrap items-center gap-4">
          <div className="cfc-section" style={{ marginBottom: 0 }}>
            <span className="cfc-section-tag">Trade Center</span>
            <h1 className="font-headline text-3xl text-[var(--cfc-ink)]">Inbox</h1>
          </div>
          <span className="text-sm" style={{ color: "var(--cfc-muted)" }}>
            {teamName || `Team ${rosterId}`}
          </span>
        </header>

        {/* Trade Center tabs */}
        <TradeCenterTabs />

        {/* Thread list */}
        <div className="space-y-3">
          {loading ? (
            <div
              className="cfc-card flex items-center justify-center py-12"
              style={{ color: "var(--cfc-muted)" }}
            >
              Loading…
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="cfc-card flex flex-col items-center justify-center py-12 text-center">
              <p className="font-headline text-2xl text-[var(--cfc-ink)]">
                {view === "history" ? "No trade history" : "No active trades"}
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--cfc-muted)" }}>
                {view === "history"
                  ? "Accepted and declined trades will appear here."
                  : "Open trade threads with other teams will appear here."}
              </p>
            </div>
          ) : (
            filteredThreads.map((thread) => {
              const counterpartId =
                thread.team_a_id === rosterId ? thread.team_b_id : thread.team_a_id;
              const counterpartName = getTeamLabel(counterpartId);
              const isOpen = thread.status === "open";

              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => router.push(`/trades/${thread.id}`)}
                  className="cfc-card w-full p-4 text-left transition"
                  style={{ cursor: "pointer" }}
                >
                  <div className="flex items-center gap-3">
                    {isOpen && (
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ background: "var(--cfc-red)" }}
                      />
                    )}
                    <span className="flex-1 font-headline text-lg text-[var(--cfc-ink)] truncate">
                      {counterpartName}
                    </span>
                    <span className="cfc-mono text-xs" style={{ color: "var(--cfc-muted)" }}>
                      {timeAgo(thread.last_activity_at)}
                    </span>
                    <span className={threadStatusClass[thread.status] || "cfc-chip"}>
                      {thread.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs" style={{ color: "var(--cfc-muted)" }}>
                    {thread.last_offer_at && (
                      <span>
                        Last offer:{" "}
                        <strong className="cfc-mono text-[var(--cfc-ink)]">
                          {timeAgo(thread.last_offer_at)}
                        </strong>
                      </span>
                    )}
                    {thread.last_message_at && (
                      <span className="flex items-center gap-1">
                        <MessageCircle className="h-3 w-3" />
                        {timeAgo(thread.last_message_at)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
