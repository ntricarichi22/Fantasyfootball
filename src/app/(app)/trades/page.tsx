"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Send } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface OfferAsset {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
}

interface TradeOffer {
  id: string;
  league_id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
  grade_label: string;
  status: string;
  parent_offer_id: string | null;
  created_at: string;
  updated_at: string;
  read_at: string | null;
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

const statusColors: Record<string, string> = {
  pending: "bg-amber-600/80 text-amber-50",
  accepted: "bg-emerald-600/80 text-emerald-50",
  declined: "bg-red-600/80 text-red-50",
  withdrawn: "bg-gray-600/80 text-gray-50",
  countered: "bg-indigo-600/80 text-indigo-50",
  expired: "bg-gray-700/80 text-gray-300",
};

const gradeColors: Record<string, string> = {
  Steal: "bg-emerald-600 text-white",
  "Good Deal": "bg-emerald-700 text-white",
  Fair: "bg-blue-600 text-white",
  "Slight Overpay": "bg-amber-600 text-white",
  "Big Overpay": "bg-red-600 text-white",
  "Slight Underpay": "bg-teal-600 text-white",
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

/* ------------------------------------------------------------------ */
/*  Roster names fetch (same pattern as other pages)                    */
/* ------------------------------------------------------------------ */

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
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const { rosterId, teamName } = getStoredTeam();

  // Fetch roster names
  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  // Fetch offers
  const fetchOffers = useCallback(async () => {
    if (!rosterId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/trades/list?teamId=${encodeURIComponent(rosterId)}&tab=${tab}`,
      );
      if (res.ok) {
        const json = await res.json();
        setOffers(json.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [rosterId, tab]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const handleClickOffer = async (offer: TradeOffer) => {
    // Mark as read if we're the receiver and it's unread
    if (tab === "inbox" && offer.to_team_id === rosterId && !offer.read_at) {
      try {
        await fetch("/api/trades/mark-read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offer_id: offer.id, team_id: rosterId }),
        });
      } catch {
        // ignore
      }
    }
    router.push(`/trades/${offer.id}`);
  };

  const getTeamLabel = (teamId: string) => rosterNames[teamId] || `Team ${teamId}`;

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
            Inbox
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
            Sent
          </button>
        </div>

        {/* Offer list */}
        <div className="flex-1 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              Loading…
            </div>
          ) : offers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <p className="text-lg font-semibold">
                {tab === "inbox" ? "No incoming offers" : "No sent offers"}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {tab === "inbox"
                  ? "Trade offers from other teams will appear here."
                  : "Offers you've sent will appear here."}
              </p>
            </div>
          ) : (
            offers.map((offer) => {
              const counterpart =
                tab === "inbox"
                  ? getTeamLabel(offer.from_team_id)
                  : getTeamLabel(offer.to_team_id);
              const isUnread =
                tab === "inbox" && offer.to_team_id === rosterId && !offer.read_at;

              return (
                <button
                  key={offer.id}
                  type="button"
                  onClick={() => handleClickOffer(offer)}
                  className={[
                    "w-full rounded-lg border p-4 text-left transition hover:border-gray-600 hover:bg-gray-900/80",
                    isUnread
                      ? "border-red-500/40 bg-red-950/20"
                      : "border-gray-800 bg-gray-900/50",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    {isUnread && (
                      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
                    )}
                    <span className="flex-1 text-sm font-semibold text-white">
                      {tab === "inbox" ? `From ${counterpart}` : `To ${counterpart}`}
                    </span>
                    <span className="text-xs text-gray-500">
                      {timeAgo(offer.created_at)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${gradeColors[offer.grade_label] || "bg-gray-700 text-gray-300"}`}
                    >
                      {offer.grade_label}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${statusColors[offer.status] || "bg-gray-700 text-gray-300"}`}
                    >
                      {offer.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-6 text-xs text-gray-400">
                    {tab === "inbox" ? (
                      <>
                        <span>
                          You receive: <strong className="text-gray-200">{offer.from_value.toLocaleString()}</strong>
                        </span>
                        <span>
                          You give: <strong className="text-gray-200">{offer.to_value.toLocaleString()}</strong>
                        </span>
                      </>
                    ) : (
                      <>
                        <span>
                          You send: <strong className="text-gray-200">{offer.from_value.toLocaleString()}</strong>
                        </span>
                        <span>
                          You get: <strong className="text-gray-200">{offer.to_value.toLocaleString()}</strong>
                        </span>
                      </>
                    )}
                    <span className="text-gray-600">
                      {(offer.assets_from?.length ?? 0) + (offer.assets_to?.length ?? 0)} assets
                    </span>
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
