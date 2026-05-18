"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import FilterBar, { type FilterValue } from "./FilterBar";
import InsiderPanel from "@/inbox/insider/InsiderPanel";
import TradeCard from "./TradeCard";

type TradeThread = {
  id: string;
  team_a_id: string;
  team_b_id: string;
  status: string;
  last_activity_at: string;
};

type OfferAsset = {
  key?: string;
  label?: string;
  type?: string;
  position?: string;
  team?: string;
  ageLabel?: string;
  value?: number;
};

type TradeOffer = {
  id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
  status: string;
  ai_quip: string | null;
  created_at: string;
  updated_at: string;
};

type ThreadWithOffers = {
  thread: TradeThread;
  offers: TradeOffer[];
};

// One card item per pending offer in open threads; one card per closed
// thread (the terminal offer). Lets the inbox surface multiple distinct
// deal proposals to the same partner without collapsing them.
type CardItem = {
  cardKey: string;
  thread: TradeThread;
  offer: TradeOffer;
  totalOfferCount: number;
  isClosedTerminal: boolean;
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
      map[String(r.roster_id)] = userMap[r.owner_id] || `Team ${r.roster_id}`;
    }
    return map;
  } catch {
    return {};
  }
}

function closedLabel(thread: TradeThread, terminalOffer: TradeOffer | null, myRosterId: string): string {
  const status = thread.status;
  if (status === "accepted") return "Accepted";
  if (status === "withdrawn") return "Withdrawn";
  if (status === "declined") {
    if (terminalOffer?.to_team_id === myRosterId) return "Declined by you";
    return "Declined by them";
  }
  return status;
}

export default function InboxPage() {
  const { rosterId = "", teamName = "" } = readStoredTeam();

  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const [threadData, setThreadData] = useState<ThreadWithOffers[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState("");

  const [filter, setFilter] = useState<FilterValue>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  const fetchThreads = useCallback(async () => {
    if (!rosterId) return;
    try {
      const threadsRes = await fetch(
        `/api/inbox/threads?teamId=${encodeURIComponent(rosterId)}`
      );
      if (!threadsRes.ok) throw new Error("Failed to load threads");
      const threadsJson = await threadsRes.json();
      const threads: TradeThread[] = threadsJson.data ?? [];

      const details = await Promise.all(
        threads.map(async (thread) => {
          try {
            const res = await fetch(
              `/api/inbox/threads/${encodeURIComponent(thread.id)}`
            );
            if (!res.ok) return { thread, offers: [] as TradeOffer[] };
            const json = await res.json();
            const offers: TradeOffer[] = json.offers ?? [];
            return { thread, offers };
          } catch {
            return { thread, offers: [] as TradeOffer[] };
          }
        })
      );

      setThreadData(details);
    } catch {
      setThreadData([]);
    } finally {
      setLoading(false);
    }
  }, [rosterId]);

  useEffect(() => {
    fetchThreads();
    const interval = setInterval(fetchThreads, 15_000);
    return () => clearInterval(interval);
  }, [fetchThreads]);

  // One card per pending offer in open threads.
  // Closed threads collapse to a single terminal card.
  const cardItems = useMemo<CardItem[]>(() => {
    const items: CardItem[] = [];
    for (const td of threadData) {
      if (td.thread.status === "open") {
        const pending = td.offers.filter((o) => o.status === "pending");
        for (const offer of pending) {
          items.push({
            cardKey: offer.id,
            thread: td.thread,
            offer,
            totalOfferCount: td.offers.length,
            isClosedTerminal: false,
          });
        }
      } else {
        const terminal =
          [...td.offers].reverse().find((o) => o.status !== "pending") ??
          td.offers[td.offers.length - 1] ??
          null;
        if (terminal) {
          items.push({
            cardKey: td.thread.id,
            thread: td.thread,
            offer: terminal,
            totalOfferCount: td.offers.length,
            isClosedTerminal: true,
          });
        }
      }
    }
    return items;
  }, [threadData]);

  // Lazy-fetch AI quips for any visible card whose offer doesn't have one
  useEffect(() => {
    if (!cardItems.length) return;
    const missing = cardItems
      .filter((c) => !c.offer.ai_quip)
      .map((c) => c.offer.id);

    if (!missing.length) return;

    Promise.allSettled(
      missing.map((offerId) =>
        fetch("/api/inbox/ai-quip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offer_id: offerId }),
        })
          .then((res) => res.json())
          .then((json) => {
            if (json.quip) {
              setThreadData((prev) =>
                prev.map((td) => ({
                  ...td,
                  offers: td.offers.map((o) =>
                    o.id === offerId ? { ...o, ai_quip: JSON.stringify(json.quip) } : o
                  ),
                }))
              );
            }
          })
      )
    );
  }, [cardItems]);

  const getCounterpartName = useCallback(
    (thread: TradeThread) => {
      const counterpartId =
        thread.team_a_id === rosterId ? thread.team_b_id : thread.team_a_id;
      return rosterNames[counterpartId] || `Team ${counterpartId}`;
    },
    [rosterId, rosterNames]
  );

  const handleAccept = useCallback(
    async (offerId: string) => {
      if (actionLoading) return;
      setActionLoading(true);
      try {
        const res = await fetch("/api/inbox/threads/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offer_id: offerId,
            team_id: rosterId,
            status: "accepted",
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "Failed to accept");
        }
        showToast("Trade accepted!");
        await fetchThreads();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Failed to accept");
      } finally {
        setActionLoading(false);
      }
    },
    [actionLoading, rosterId, showToast, fetchThreads]
  );

  const handleReject = useCallback(
    async (offerId: string) => {
      if (actionLoading) return;
      setActionLoading(true);
      try {
        const res = await fetch("/api/inbox/threads/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offer_id: offerId,
            team_id: rosterId,
            status: "declined",
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "Failed to decline");
        }
        showToast("Trade declined.");
        await fetchThreads();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Failed to decline");
      } finally {
        setActionLoading(false);
      }
    },
    [actionLoading, rosterId, showToast, fetchThreads]
  );

  const handleCounter = useCallback((threadId: string) => {
    window.location.href = `/trades/${threadId}#counter`;
  }, []);

  const handleView = useCallback((threadId: string) => {
    window.location.href = `/trades/${threadId}`;
  }, []);

  const searchLower = searchTerm.toLowerCase();

  const matchesSearch = useCallback(
    (card: CardItem) => {
      if (!searchLower) return true;
      const counterpartName = getCounterpartName(card.thread).toLowerCase();
      if (counterpartName.includes(searchLower)) return true;
      const allAssets = [...(card.offer.assets_from ?? []), ...(card.offer.assets_to ?? [])];
      return allAssets.some((a) =>
        (a.label || "").toLowerCase().includes(searchLower)
      );
    },
    [searchLower, getCounterpartName]
  );

  const activeCards = useMemo(
    () =>
      cardItems
        .filter((c) => !c.isClosedTerminal)
        .filter(matchesSearch)
        .sort(
          (a, b) =>
            new Date(b.offer.created_at).getTime() -
            new Date(a.offer.created_at).getTime()
        ),
    [cardItems, matchesSearch]
  );

  const closedCards = useMemo(
    () =>
      cardItems
        .filter((c) => c.isClosedTerminal)
        .filter(matchesSearch)
        .sort(
          (a, b) =>
            new Date(b.thread.last_activity_at).getTime() -
            new Date(a.thread.last_activity_at).getTime()
        ),
    [cardItems, matchesSearch]
  );

  const visibleActive = filter === "closed" ? [] : activeCards;
  const visibleClosed = filter === "open" ? [] : closedCards;

  const displayName = teamName || `Team ${rosterId}`;

  if (!rosterId) {
    return (
      <main
        style={{
          minHeight: "calc(100vh - 44px)",
          background: "#F5F0E6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
        }}
      >
        <div
          style={{
            border: "2.5px solid #1A1A1A",
            boxShadow: "4px 4px 0 #1A1A1A",
            background: "#FEFCF9",
            padding: "32px 40px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-headline, 'Syne', sans-serif)",
              fontWeight: 800,
              fontSize: 20,
              marginBottom: 8,
            }}
          >
            Sign in to access the GM Office
          </div>
          <div style={{ fontSize: 13, color: "#8C7E6A" }}>
            Log in to see your trade activity.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "calc(100vh - 44px)",
        background: "#F5F0E6",
        color: "#1A1A1A",
        fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: 24,
            transform: "translateX(-50%)",
            zIndex: 50,
            background: "#3366CC",
            color: "#fff",
            padding: "8px 20px",
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 12,
            fontWeight: 700,
            border: "2px solid #1A1A1A",
            boxShadow: "3px 3px 0 #1A1A1A",
          }}
        >
          {toast}
        </div>
      )}

      <div
        style={{
          maxWidth: 900,
          width: "100%",
          margin: "0 auto",
          padding: "0 24px",
          display: "flex",
          flexDirection: "column",
          flex: 1,
        }}
      >
        {/* Page title */}
        <div style={{ padding: "20px 0 14px" }}>
          <div
            style={{
              fontFamily: "var(--font-headline, 'Syne', sans-serif)",
              fontWeight: 800,
              fontSize: 26,
              letterSpacing: "-0.01em",
            }}
          >
            Trade center
          </div>
          <div style={{ fontSize: 12, color: "#8C7E6A", marginTop: 2 }}>
            {displayName}
          </div>
        </div>

        {/* Row 1: Sticky marquee */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "#F5F0E6",
            paddingBottom: 10,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "210px 1fr 1fr",
              gap: 10,
            }}
          >
            {/* CFC Insider header */}
            <div
              style={{
                background: "#1A1A1A",
                border: "2.5px solid #1A1A1A",
                boxShadow: "4px 4px 0 #1A1A1A",
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: "rgba(232,80,58,0.2)",
                  border: "2px solid rgba(232,80,58,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#E8503A"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 20V10M18 20V4M6 20v-4" />
                </svg>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                    fontWeight: 800,
                    fontSize: 14,
                    color: "#FEFCF9",
                  }}
                >
                  CFC Insider
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "rgba(255,255,255,0.5)",
                    fontWeight: 500,
                    marginTop: 1,
                  }}
                >
                  League trade intel
                </div>
              </div>
            </div>

            {/* Make an Offer */}
            <div
              onClick={() => { window.location.href = "/trade-builder"; }}
              style={{
                background: "#3366CC",
                border: "2.5px solid #1A1A1A",
                boxShadow: "4px 4px 0 #1A1A1A",
                padding: "14px 16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: "rgba(255,255,255,0.15)",
                  border: "2px solid rgba(255,255,255,0.3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                    fontWeight: 800,
                    fontSize: 14,
                    color: "#fff",
                  }}
                >
                  Make an offer
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "rgba(255,255,255,0.6)",
                    fontWeight: 500,
                    marginTop: 1,
                  }}
                >
                  Build a trade in the trade machine
                </div>
              </div>
            </div>

            {/* Shop Around */}
            <div
              onClick={() => { window.location.href = "/trade-studio"; }}
              style={{
                background: "#F5C230",
                border: "2.5px solid #1A1A1A",
                boxShadow: "4px 4px 0 #1A1A1A",
                padding: "14px 16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: "rgba(26,26,26,0.1)",
                  border: "2px solid rgba(26,26,26,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#1A1A1A"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                    fontWeight: 800,
                    fontSize: 14,
                    color: "#1A1A1A",
                  }}
                >
                  Shop around
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: "rgba(26,26,26,0.5)",
                    fontWeight: 500,
                    marginTop: 1,
                  }}
                >
                  AI finds trades based on your roster
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "210px 1fr",
            gap: 10,
            flex: 1,
            alignItems: "start",
          }}
        >
          {/* Left column: Insider feed */}
          <InsiderPanel />

          {/* Right column: Filter + trade cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <FilterBar
              active={filter}
              onFilterChange={setFilter}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
            />

            {loading ? (
              <div
                style={{
                  border: "2.5px solid #1A1A1A",
                  boxShadow: "4px 4px 0 #1A1A1A",
                  background: "#FEFCF9",
                  padding: "40px 20px",
                  textAlign: "center",
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 12,
                  color: "#8C7E6A",
                }}
              >
                Loading…
              </div>
            ) : visibleActive.length === 0 && visibleClosed.length === 0 ? (
              <div
                style={{
                  border: "2.5px solid #1A1A1A",
                  boxShadow: "4px 4px 0 #1A1A1A",
                  background: "#FEFCF9",
                  padding: "48px 32px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                    fontWeight: 800,
                    fontSize: 22,
                    marginBottom: 8,
                  }}
                >
                  No deals on the table.
                </div>
                <div style={{ fontSize: 13, color: "#8C7E6A", marginBottom: 20 }}>
                  Let&apos;s change that.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button
                    type="button"
                    onClick={() => { window.location.href = "/trade-builder"; }}
                    style={{
                      background: "#3366CC",
                      color: "#fff",
                      border: "2.5px solid #1A1A1A",
                      boxShadow: "3px 3px 0 #1A1A1A",
                      padding: "10px 18px",
                      fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Make an offer
                  </button>
                  <button
                    type="button"
                    onClick={() => { window.location.href = "/trade-studio"; }}
                    style={{
                      background: "#F5C230",
                      color: "#1A1A1A",
                      border: "2.5px solid #1A1A1A",
                      boxShadow: "3px 3px 0 #1A1A1A",
                      padding: "10px 18px",
                      fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Shop around
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Active negotiations */}
                {visibleActive.length > 0 && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 0,
                          borderBottom: "2px solid #1A1A1A",
                        }}
                      />
                      <span
                        style={{
                          fontFamily:
                            "var(--font-mono, 'JetBrains Mono', monospace)",
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#1A1A1A",
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                        }}
                      >
                        Active negotiations
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 0,
                          borderBottom: "2px solid #1A1A1A",
                        }}
                      />
                    </div>
                    {visibleActive.map((card) => (
                      <TradeCard
                        key={card.cardKey}
                        threadId={card.thread.id}
                        counterpartName={getCounterpartName(card.thread)}
                        threadStatus={card.thread.status}
                        latestOffer={card.offer}
                        myRosterId={rosterId}
                        onAccept={handleAccept}
                        onReject={handleReject}
                        onCounter={handleCounter}
                        onView={handleView}
                        actionLoading={actionLoading}
                        offerCount={card.totalOfferCount}
                      />
                    ))}
                  </>
                )}

                {/* Closed */}
                {visibleClosed.length > 0 && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        margin: "6px 0",
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 0,
                          borderBottom: "2px solid #C8C3B8",
                        }}
                      />
                      <span
                        style={{
                          fontFamily:
                            "var(--font-mono, 'JetBrains Mono', monospace)",
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#8C7E6A",
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                        }}
                      >
                        Closed
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 0,
                          borderBottom: "2px solid #C8C3B8",
                        }}
                      />
                    </div>
                    {visibleClosed.map((card) => (
                      <TradeCard
                        key={card.cardKey}
                        threadId={card.thread.id}
                        counterpartName={getCounterpartName(card.thread)}
                        threadStatus={card.thread.status}
                        latestOffer={card.offer}
                        myRosterId={rosterId}
                        onAccept={handleAccept}
                        onReject={handleReject}
                        onCounter={handleCounter}
                        onView={handleView}
                        actionLoading={actionLoading}
                        closedLabel={closedLabel(card.thread, card.offer, rosterId)}
                        offerCount={card.totalOfferCount}
                      />
                    ))}
                  </>
                )}
              </>
            )}

            {/* Bottom spacer */}
            <div style={{ height: 32 }} />
          </div>
        </div>
      </div>
    </main>
  );
}
