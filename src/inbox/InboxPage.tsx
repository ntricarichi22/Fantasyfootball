"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { teamNickname } from "@/shared/league-data/nicknames";
import {
  ActionBar,
  MobileActionBar,
  InboxRow,
  EmptyState,
  InsiderPanel,
  MobileInsiderBar,
  NegotiationTile,
  type MailTab,
  type BoardFilter,
  type InboxItem,
  type NegotiationTileData,
  type TileStatus,
  type InsiderItem,
} from "@/inbox/InboxParts";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type Memo = {
  id: string;
  director_role: "scouting" | "personnel" | "strategy";
  team_id: string;
  subject: string;
  read_body: string;
  play_intro: string;
  play_mode: "single_cta" | "ranked" | "offer_card";
  play_payload: unknown;
  status: "unread" | "read" | "archived" | "trashed";
  created_at: string;
  updated_at: string;
};

type OfferAsset = { key?: string; label?: string };

type TradeOffer = {
  id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  status: string;
  ai_quip: string | null;
  read_at: string | null;
  parent_offer_id: string | null;
  created_at: string;
  updated_at: string;
};

type TradeMessage = {
  id: string;
  thread_id: string;
  from_team_id: string;
  message: string;
  created_at: string;
};

type TradeThread = {
  id: string;
  team_a_id: string;
  team_b_id: string;
  status: string;
  last_activity_at: string;
  latest_offer: TradeOffer | null;
  latest_message: TradeMessage | null;
  offers: TradeOffer[];
  offer_count: number;
};

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                 */
/* ------------------------------------------------------------------ */

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

const DIRECTOR_NAMES: Record<Memo["director_role"], string> = {
  scouting: "Scouting Director",
  personnel: "Personnel Director",
  strategy: "Strategy Director",
};

const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "Syne, sans-serif";

// How long an unacknowledged accept/decline verdict keeps demanding attention
// (blue dot, unread count) before it settles into a plain closed tile.
const CLOSURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const MAIL_TABS: { value: MailTab; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "archive", label: "Archive" },
  { value: "trash", label: "Trash" },
];

const BOARD_FILTERS: { value: BoardFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
];

function extractName(label: string | undefined): string {
  if (!label) return "Unknown";
  return label.split(" (")[0];
}

// "Daniel Jones · 2027 1st · 2028 3rd" (+N when the package runs long).
function assetSummary(assets: OfferAsset[]): string {
  if (assets.length === 0) return "Nothing";
  const names = assets.map((a) => extractName(a.label));
  const shown = names.slice(0, 3).join(" · ");
  const extra = names.length - 3;
  return extra > 0 ? `${shown} +${extra}` : shown;
}

const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

// House logo art — same resolution the Draft Lobby and Mock Draft use.
const logoFor = (teamName: string) => `/teams/${slugify(teamNickname(teamName))}.png`;

async function fetchRosterNames(): Promise<Record<string, string>> {
  if (!LEAGUE_ID_ENV) return {};
  try {
    const [r, u] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/users`),
    ]);
    if (!r.ok || !u.ok) return {};
    const rosters = await r.json();
    const users = await u.json();
    const uMap: Record<string, string> = {};
    for (const x of users) uMap[x.user_id] = x.metadata?.team_name || x.display_name || x.user_id;
    const m: Record<string, string> = {};
    for (const x of rosters) m[String(x.roster_id)] = uMap[x.owner_id] || `Team ${x.roster_id}`;
    return m;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Main Page — staff mail up top, the negotiation board below          */
/* ------------------------------------------------------------------ */

export default function InboxPage() {
  const stored = readStoredTeam() as
    | { rosterId?: string; teamName?: string; name?: string }
    | null;
  const rosterId = stored?.rosterId ?? "";
  const isMobile = !!useIsMobile();

  const [mailTab, setMailTab] = useState<MailTab>("inbox");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [memos, setMemos] = useState<Memo[]>([]);
  const [threads, setThreads] = useState<TradeThread[]>([]);
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const [insider, setInsider] = useState<InsiderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");

  const flash = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3000);
  }, []);

  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  // Old mail-model deep links map onto the new sections: sent → active
  // negotiations, archive → closed deals, trash → staff trash.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("filter");
    if (p === "sent") setBoardFilter("active");
    else if (p === "archive") setBoardFilter("closed");
    else if (p === "trash") setMailTab("trash");
  }, []);

  const fetchAll = useCallback(async () => {
    if (!rosterId) return;
    try {
      // Memos are low-volume — fetch every status once and let the tabs
      // filter client-side. Trades ride the enriched threads call.
      const memosUrl = new URL("/api/inbox/memos", window.location.origin);
      memosUrl.searchParams.set("teamId", rosterId);
      memosUrl.searchParams.set("includeArchived", "1");
      memosUrl.searchParams.set("includeTrashed", "1");

      const [memosRes, threadsRes, insiderRes] = await Promise.all([
        fetch(memosUrl.toString()),
        fetch(`/api/inbox/threads?teamId=${encodeURIComponent(rosterId)}&include=latest`),
        fetch("/api/inbox/insider"),
      ]);

      const memosJson = memosRes.ok ? await memosRes.json() : { memos: [] };
      const threadsJson = threadsRes.ok ? await threadsRes.json() : { data: [] };
      const insiderJson = insiderRes.ok ? await insiderRes.json() : { items: [] };

      setMemos(memosJson.memos ?? []);
      setInsider(insiderJson.items ?? []);
      setThreads((threadsJson.data ?? []) as TradeThread[]);
    } finally {
      setLoading(false);
    }
  }, [rosterId]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30_000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  /* ----------------------- Staff mail ----------------------------- */

  const memoItems = useMemo<InboxItem[]>(() => {
    const wanted =
      mailTab === "inbox"
        ? (s: Memo["status"]) => s === "unread" || s === "read"
        : mailTab === "archive"
          ? (s: Memo["status"]) => s === "archived"
          : (s: Memo["status"]) => s === "trashed";
    return memos
      .filter((m) => m.play_mode !== "offer_card" && wanted(m.status))
      .map((m) => ({
        id: m.id,
        sender: DIRECTOR_NAMES[m.director_role],
        subject: m.subject,
        preview: m.read_body,
        unread: m.status === "unread",
        timestamp: m.created_at,
        href: `/inbox/memo/${m.id}`,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [memos, mailTab]);

  const staffUnread = useMemo(
    () => memos.filter((m) => m.play_mode !== "offer_card" && m.status === "unread").length,
    [memos],
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkUpdate = async (status: "read" | "archived" | "trashed") => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await fetch("/api/inbox/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status }),
      });
    } catch {
      /* silent */
    }
    setSelected(new Set());
    flash(
      `${status === "read" ? "Marked read" : status === "archived" ? "Archived" : "Deleted"}: ${
        ids.length
      }`,
    );
    fetchAll();
  };

  /* --------------------- Negotiation board ------------------------ */

  const tiles = useMemo<NegotiationTileData[]>(() => {
    const out: NegotiationTileData[] = [];
    for (const t of threads) {
      const latest = t.latest_offer;
      const offers = t.offers ?? [];
      if (!latest || offers.length === 0) continue;
      const counterpartId = t.team_a_id === rosterId ? t.team_b_id : t.team_a_id;
      const counterpart = rosterNames[counterpartId] || `Team ${counterpartId}`;
      const isFromUser = latest.from_team_id === rosterId;
      const isReceiver = latest.to_team_id === rosterId;

      const pending = latest.status === "pending";
      let status: TileStatus;
      if (pending) status = isReceiver ? "our_court" : "on_them";
      else if (latest.status === "accepted") status = "accepted";
      else if (latest.status === "declined") status = "declined";
      else if (latest.status === "withdrawn") status = "withdrawn";
      else continue;

      // Every offer in the thread is a flippable version of the deal, always
      // rendered from OUR side of the table.
      const versions = offers.map((o, i) => {
        const oIsReceiver = o.to_team_id === rosterId;
        const author = o.from_team_id === rosterId ? "YOUR" : "THEIR";
        return {
          label: `V${i + 1}.0`,
          caption: `${author} ${i === 0 ? "OPENING" : "COUNTER"}`,
          youGet: assetSummary(oIsReceiver ? o.assets_from : o.assets_to),
          youGive: assetSummary(oIsReceiver ? o.assets_to : o.assets_from),
        };
      });

      // The dot pulses until the team that needs to see the latest state has
      // opened the thread: recipient of a pending offer, sender of a resolved
      // one (withdrawn flips back to the recipient). Freshness-capped so
      // pre-feature resolutions (read_at was never stamped) don't flare up.
      const fresh =
        Date.now() - new Date(latest.updated_at).getTime() < CLOSURE_WINDOW_MS;
      const unseen =
        (pending && isReceiver && !latest.read_at) ||
        (!pending &&
          !latest.read_at &&
          fresh &&
          (latest.status === "withdrawn" ? isReceiver : isFromUser));

      out.push({
        threadId: t.id,
        counterpart,
        logoUrl: logoFor(counterpart),
        versions,
        status,
        unseen,
        timestamp: pending ? latest.created_at : latest.updated_at,
      });
    }
    out.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return out;
  }, [threads, rosterNames, rosterId]);

  const isActiveTile = (t: NegotiationTileData) =>
    t.status === "our_court" || t.status === "on_them";

  const boardCounts = useMemo<Record<BoardFilter, number>>(
    () => ({
      all: tiles.length,
      active: tiles.filter(isActiveTile).length,
      closed: tiles.filter((t) => !isActiveTile(t)).length,
    }),
    [tiles],
  );

  const visibleTiles = useMemo(() => {
    if (boardFilter === "active") return tiles.filter(isActiveTile);
    if (boardFilter === "closed") return tiles.filter((t) => !isActiveTile(t));
    return tiles;
  }, [tiles, boardFilter]);

  /* ------------------------- Render ------------------------------- */

  if (!rosterId) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F0E6",
          padding: 20,
        }}
      >
        <div
          style={{
            background: "#FEFCF9",
            border: "3px solid #1A1A1A",
            boxShadow: "4px 4px 0 #1A1A1A",
            padding: "28px 32px",
            textAlign: "center",
          }}
        >
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
            Sign in to access the front office
          </div>
          <div style={{ fontSize: 13, color: "#8C7E6A" }}>
            Log in to see your negotiations and staff mail.
          </div>
        </div>
      </div>
    );
  }

  const sectionEyebrow: React.CSSProperties = {
    fontFamily: FM,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: "#8C7E6A",
    textTransform: "uppercase",
  };

  const pillStyle = (active: boolean, muted?: boolean): React.CSSProperties => ({
    background: active ? "#1A1A1A" : "#FEFCF9",
    color: active ? "#FEFCF9" : muted ? "#8C7E6A" : "#1A1A1A",
    border: "1.5px solid #1A1A1A",
    padding: "5px 9px",
    fontFamily: FM,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E6", color: "#1A1A1A" }}>
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#3366CC",
            color: "#FEFCF9",
            border: "2px solid #1A1A1A",
            boxShadow: "3px 3px 0 #1A1A1A",
            padding: "8px 20px",
            fontFamily: FM,
            fontSize: 12,
            fontWeight: 700,
            zIndex: 60,
          }}
        >
          {toast}
        </div>
      )}

      <UnifiedTopbar />
      <div style={{ height: 3, background: "#E8503A" }} />

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          minHeight: "calc(100vh - 200px)",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: isMobile ? "14px 14px 72px" : "18px 22px 32px",
          }}
        >
          {loading ? (
            <div
              style={{
                padding: "40px 20px",
                textAlign: "center",
                fontFamily: FM,
                fontSize: 12,
                color: "#8C7E6A",
              }}
            >
              Loading…
            </div>
          ) : (
            <>
              {/* ------------------ From your staff ------------------ */}
              <div style={{ marginBottom: 26 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontFamily: FH, fontWeight: 800, fontSize: isMobile ? 18 : 20 }}>
                      From your staff
                    </span>
                    {staffUnread > 0 && (
                      <span style={sectionEyebrow}>{staffUnread} unread</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {MAIL_TABS.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => {
                          setMailTab(t.value);
                          setSelected(new Set());
                        }}
                        style={pillStyle(mailTab === t.value, t.value !== "inbox")}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {selected.size > 0 && !isMobile && (
                  <ActionBar
                    count={selected.size}
                    onMarkRead={() => bulkUpdate("read")}
                    onArchive={() => bulkUpdate("archived")}
                    onDelete={() => bulkUpdate("trashed")}
                    onClear={() => setSelected(new Set())}
                  />
                )}

                <div style={{ background: "#FEFCF9", border: "3px solid #1A1A1A" }}>
                  {memoItems.length === 0 ? (
                    <EmptyState kind={mailTab} compact />
                  ) : (
                    memoItems.map((it) => (
                      <InboxRow
                        key={it.id}
                        item={it}
                        selected={selected.has(it.id)}
                        onToggle={() => toggleSelect(it.id)}
                        onOpen={() => {
                          window.location.href = it.href;
                        }}
                        isMobile={isMobile}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* ------------------- Negotiations -------------------- */}
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontFamily: FH, fontWeight: 800, fontSize: isMobile ? 18 : 20 }}>
                    Negotiations
                  </span>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                    {BOARD_FILTERS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setBoardFilter(f.value)}
                        style={pillStyle(boardFilter === f.value, f.value === "closed")}
                      >
                        {f.label} {boardCounts[f.value]}
                      </button>
                    ))}
                  </div>
                </div>

                {visibleTiles.length === 0 ? (
                  <div style={{ background: "#FEFCF9", border: "3px solid #1A1A1A" }}>
                    <EmptyState kind={boardFilter} />
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile
                        ? "repeat(2, minmax(0, 1fr))"
                        : "repeat(auto-fill, minmax(225px, 1fr))",
                      gap: 14,
                    }}
                  >
                    {visibleTiles.map((tile) => (
                      <NegotiationTile
                        key={tile.threadId}
                        tile={tile}
                        onOpen={() => {
                          window.location.href = `/inbox/${tile.threadId}`;
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {!isMobile && <InsiderPanel items={insider} />}
      </div>

      {isMobile && selected.size > 0 && (
        <MobileActionBar
          count={selected.size}
          onMarkRead={() => bulkUpdate("read")}
          onArchive={() => bulkUpdate("archived")}
          onDelete={() => bulkUpdate("trashed")}
          onClear={() => setSelected(new Set())}
        />
      )}

      {isMobile && selected.size === 0 && <MobileInsiderBar items={insider} />}
    </div>
  );
}
