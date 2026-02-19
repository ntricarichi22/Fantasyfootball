"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Send, MessageCircle } from "lucide-react";

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

const threadStatusColors: Record<string, string> = {
  open: "bg-amber-600/80 text-amber-50",
  accepted: "bg-emerald-600/80 text-emerald-50",
  declined: "bg-red-600/80 text-red-50",
  withdrawn: "bg-gray-600/80 text-gray-50",
  closed: "bg-gray-700/80 text-gray-300",
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
  const router = useRouter();
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
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

  // For "All Threads" tab show all threads; for "Initiated" tab show only threads we created
  const filteredThreads =
    tab === "inbox"
      ? threads
      : threads.filter((t) => t.created_by_team_id === rosterId);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-black text-gray-100">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 py-6">
        {/* Header */}
        <header className="mb-4 flex items-center gap-4">
          <h1 className="text-2xl font-bold text-white">Trades</h1>
          <span className="text-sm text-gray-400">{teamName || `Team ${rosterId}`}</span>
        </header>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 rounded-lg border border-gray-800 bg-gray-900/60 p-1">
          <button
            type="button"
            onClick={() => setTab("inbox")}
            className={[
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition",
              tab === "inbox"
                ? "bg-red-600/80 text-white"
                : "text-gray-400 hover:bg-white/5 hover:text-white",
            ].join(" ")}
          >
            <Inbox className="h-4 w-4" />
            All Threads
          </button>
          <button
            type="button"
            onClick={() => setTab("sent")}
            className={[
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition",
              tab === "sent"
                ? "bg-red-600/80 text-white"
                : "text-gray-400 hover:bg-white/5 hover:text-white",
            ].join(" ")}
          >
            <Send className="h-4 w-4" />
            Initiated
          </button>
        </div>

        {/* Thread list */}
        <div className="flex-1 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              Loading…
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <p className="text-lg font-semibold">
                {tab === "inbox" ? "No trade threads" : "No threads initiated"}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {tab === "inbox"
                  ? "Trade threads with other teams will appear here."
                  : "Threads you started will appear here."}
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
                  className={[
                    "w-full rounded-lg border p-4 text-left transition hover:border-gray-600 hover:bg-gray-900/80",
                    isOpen
                      ? "border-red-500/40 bg-red-950/20"
                      : "border-gray-800 bg-gray-900/50",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    {isOpen && (
                      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
                    )}
                    <span className="flex-1 text-sm font-semibold text-white">
                      {counterpartName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {timeAgo(thread.last_activity_at)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${threadStatusColors[thread.status] || "bg-gray-700 text-gray-300"}`}
                    >
                      {thread.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                    {thread.last_offer_at && (
                      <span>
                        Last offer:{" "}
                        <strong className="text-gray-200">
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
