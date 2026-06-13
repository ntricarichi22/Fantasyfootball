"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import { Icon } from "@/shared/ui/Icon";
import { InnerTopbar } from "@/shared/ui/InnerTopbar";
import {
  Sidebar,
  ActionBar,
  MobileActionBar,
  InboxRow,
  EmptyState,
  InsiderPanel,
  MobileInsiderBar,
  type Filter,
  type InboxItem,
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
  play_mode: "single_cta" | "ranked";
  play_payload: unknown;
  status: "unread" | "read" | "archived" | "trashed";
  created_at: string;
  updated_at: string;
};

type TradeThread = {
  id: string;
  team_a_id: string;
  team_b_id: string;
  status: string;
  last_activity_at: string;
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
  created_at: string;
  updated_at: string;
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

function extractName(label: string | undefined): string {
  if (!label) return "Unknown";
  return label.split(" (")[0];
}

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
/*  Main Page                                                           */
/* ------------------------------------------------------------------ */

export default function InboxPage() {
  const stored = readStoredTeam() as
    | { rosterId?: string; teamName?: string; name?: string }
    | null;
  const rosterId = stored?.rosterId ?? "";
  const isMobile = !!useIsMobile();

  const [filter, setFilter] = useState<Filter>("inbox");
  const [searchTerm, setSearchTerm] = useState("");
  const [memos, setMemos] = useState<Memo[]>([]);
  const [threadData, setThreadData] = useState<
    { thread: TradeThread; offers: TradeOffer[] }[]
  >([]);
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const [insider, setInsider] = useState<InsiderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");

  const flash = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3000);
  }, []);

  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  const includeArchived = filter === "archive";
  const includeTrashed = filter === "trash";

  const fetchAll = useCallback(async () => {
    if (!rosterId) return;
    try {
      // Compose-on-read: the director's inbound-offer emails (and the one
      // polite reminder) are minted by an idempotent sweep before we list, so
      // "the email arrived while you were away" — failure is non-fatal.
      try {
        await fetch("/api/inbox/memos/sweep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_id: rosterId }),
        });
      } catch { /* sweep is best-effort */ }

      const memosUrl = new URL("/api/inbox/memos", window.location.origin);
      memosUrl.searchParams.set("teamId", rosterId);
      if (includeArchived) memosUrl.searchParams.set("includeArchived", "1");
      if (includeTrashed) memosUrl.searchParams.set("includeTrashed", "1");

      const [memosRes, threadsRes, insiderRes] = await Promise.all([
        fetch(memosUrl.toString()),
        fetch(`/api/inbox/threads?teamId=${encodeURIComponent(rosterId)}`),
        fetch("/api/inbox/insider"),
      ]);

      const memosJson = memosRes.ok ? await memosRes.json() : { memos: [] };
      const threadsJson = threadsRes.ok ? await threadsRes.json() : { data: [] };
      const insiderJson = insiderRes.ok ? await insiderRes.json() : { items: [] };

      setMemos(memosJson.memos ?? []);
      setInsider(insiderJson.items ?? []);

      const threads: TradeThread[] = threadsJson.data ?? [];
      const details = await Promise.all(
        threads.map(async (t) => {
          try {
            const r = await fetch(`/api/inbox/threads/${encodeURIComponent(t.id)}`);
            const j = r.ok ? await r.json() : { offers: [] };
            return { thread: t, offers: (j.offers ?? []) as TradeOffer[] };
          } catch {
            return { thread: t, offers: [] as TradeOffer[] };
          }
        })
      );
      setThreadData(details);
    } finally {
      setLoading(false);
    }
  }, [rosterId, includeArchived, includeTrashed]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30_000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const allItems = useMemo<InboxItem[]>(() => {
    const items: InboxItem[] = [];

    for (const m of memos) {
      items.push({
        kind: "memo",
        id: m.id,
        sender: DIRECTOR_NAMES[m.director_role],
        subject: m.subject,
        preview: m.read_body,
        unread: m.status === "unread",
        timestamp: m.created_at,
        href: `/inbox/memo/${m.id}`,
      });
    }

    for (const td of threadData) {
      const counterpartId =
        td.thread.team_a_id === rosterId ? td.thread.team_b_id : td.thread.team_a_id;
      const counterpartName = rosterNames[counterpartId] || `Team ${counterpartId}`;

      for (const offer of td.offers) {
        const isFromUser = offer.from_team_id === rosterId;
        const isReceiver = offer.to_team_id === rosterId;
        // The Personnel director now emails us about every inbound offer
        // awaiting our response (the offer-card memo, minted by the inbox
        // sweep), so the legacy raw-offer row for it would be a duplicate.
        // Drop it. We keep everything else: offers WE sent (the director
        // doesn't email those), and any resolved/countered offer (history and
        // active negotiations — once we counter, the live offer flips outbound
        // and reappears here, which is correct).
        if (offer.status === "pending" && isReceiver) continue;
        const youGet = isReceiver ? offer.assets_from : offer.assets_to;
        const youGive = isReceiver ? offer.assets_to : offer.assets_from;

        let preview = "";
        if (offer.status === "pending") {
          try {
            const q = offer.ai_quip ? JSON.parse(offer.ai_quip) : null;
            preview = (isReceiver ? q?.to : q?.from) ?? "";
          } catch {
            /* silent */
          }
          if (!preview) {
            preview = `They want ${extractName(youGive[0]?.label)}${
              youGive.length > 1 ? ` and ${youGive.length - 1} more` : ""
            }.`;
          }
        } else {
          preview = `${offer.status[0].toUpperCase()}${offer.status.slice(1)}.`;
        }

        items.push({
          kind: "trade",
          id: offer.id,
          sender: counterpartName,
          subject: `Offer for ${extractName(youGet[0]?.label)}`,
          preview,
          unread: offer.status === "pending" && isReceiver,
          timestamp: offer.created_at,
          href: `/inbox/${td.thread.id}`,
          tradeFromUser: isFromUser,
          tradeStatus: offer.status,
        });
      }
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items;
  }, [memos, threadData, rosterNames, rosterId]);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const matches = (it: InboxItem) =>
      !term ||
      it.sender.toLowerCase().includes(term) ||
      it.subject.toLowerCase().includes(term) ||
      it.preview.toLowerCase().includes(term);

    if (filter === "inbox") {
      return allItems.filter((it) => {
        if (!matches(it)) return false;
        if (it.kind === "memo") {
          const m = memos.find((x) => x.id === it.id);
          return m?.status !== "trashed" && m?.status !== "archived";
        }
        return it.tradeFromUser !== true;
      });
    }
    if (filter === "sent") {
      return allItems.filter(
        (it) => it.kind === "trade" && it.tradeFromUser === true && matches(it)
      );
    }
    if (filter === "trash") {
      return allItems.filter((it) => {
        if (it.kind !== "memo") return false;
        const m = memos.find((x) => x.id === it.id);
        return m?.status === "trashed" && matches(it);
      });
    }
    return allItems.filter((it) => {
      if (it.kind === "memo") {
        const m = memos.find((x) => x.id === it.id);
        return m?.status === "archived" && matches(it);
      }
      return it.tradeStatus !== undefined && it.tradeStatus !== "pending" && matches(it);
    });
  }, [allItems, filter, searchTerm, memos]);

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
    const memoIds = ids.filter((id) => memos.some((m) => m.id === id));
    if (memoIds.length) {
      try {
        await fetch("/api/inbox/memos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: memoIds, status }),
        });
      } catch {
        /* silent */
      }
    }
    setSelected(new Set());
    flash(
      `${status === "read" ? "Marked read" : status === "archived" ? "Archived" : "Deleted"}: ${
        ids.length
      }`
    );
    fetchAll();
  };

  const unreadCount = useMemo(
    () => allItems.filter((it) => it.unread).length,
    [allItems]
  );

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
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
            Sign in to access the inbox
          </div>
          <div style={{ fontSize: 13, color: "#8C7E6A" }}>
            Log in to see your trade activity and memos.
          </div>
        </div>
      </div>
    );
  }

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

      <InnerTopbar
        breadcrumb="INBOX"
        onMenuClick={isMobile ? () => setDrawerOpen(true) : undefined}
        mobileSearch={
          isMobile
            ? { placeholder: "Search inbox", value: searchTerm, onChange: setSearchTerm }
            : undefined
        }
      />

      <div style={{ height: 3, background: "#E8503A" }} />

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          minHeight: "calc(100vh - 200px)",
          paddingRight: !isMobile ? 14 : 0,
        }}
      >
        {!isMobile && (
          <Sidebar
            active={filter}
            onChange={(f) => {
              setFilter(f);
              setSelected(new Set());
            }}
            isMobile={false}
            unreadCount={unreadCount}
          />
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: isMobile ? 0 : "16px 16px 24px",
            paddingBottom: isMobile ? (selected.size > 0 ? 64 : 56) : undefined,
          }}
        >
          {isMobile && (
            <div style={{ padding: "14px 14px 10px" }}>
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  color: "#8C7E6A",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {filter === "inbox" && `${unreadCount} unread · ${filtered.length} total`}
                {filter === "sent" && `${filtered.length} ${filtered.length === 1 ? "offer" : "offers"}`}
                {filter === "trash" && `${filtered.length} ${filtered.length === 1 ? "item" : "items"}`}
                {filter === "archive" && `${filtered.length} closed`}
              </div>
              <div
                style={{
                  fontFamily: "Syne, sans-serif",
                  fontWeight: 800,
                  fontSize: 22,
                  letterSpacing: "-0.005em",
                  color: "#1A1A1A",
                }}
              >
                {filter === "inbox" && "Inbox"}
                {filter === "sent" && "Sent"}
                {filter === "trash" && "Trash"}
                {filter === "archive" && "Archive"}
              </div>
            </div>
          )}

          {!isMobile && (
            <div
              style={{
                background: "#FEFCF9",
                border: "3px solid #1A1A1A",
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <Icon name="search" size={15} />
              <input
                type="text"
                placeholder="Search inbox"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: 13,
                  color: "#1A1A1A",
                  fontFamily: FB,
                }}
              />
            </div>
          )}

          {selected.size > 0 && !isMobile && (
            <ActionBar
              count={selected.size}
              onMarkRead={() => bulkUpdate("read")}
              onArchive={() => bulkUpdate("archived")}
              onDelete={() => bulkUpdate("trashed")}
              onClear={() => setSelected(new Set())}
            />
          )}

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
          ) : filtered.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <div style={{ background: "#FEFCF9", border: isMobile ? "none" : "3px solid #1A1A1A" }}>
              {filtered.map((it) => (
                <InboxRow
                  key={`${it.kind}-${it.id}`}
                  item={it}
                  selected={selected.has(it.id)}
                  onToggle={() => toggleSelect(it.id)}
                  onOpen={() => {
                    window.location.href = it.href;
                  }}
                  isMobile={isMobile}
                />
              ))}
            </div>
          )}
        </div>

        {!isMobile && <InsiderPanel items={insider} />}
      </div>

      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26,26,26,0.5)",
            zIndex: 80,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ height: "100%", maxWidth: "85%" }}>
            <Sidebar
              active={filter}
              onChange={(f) => {
                setFilter(f);
                setSelected(new Set());
              }}
              isMobile
              onClose={() => setDrawerOpen(false)}
              unreadCount={unreadCount}
            />
          </div>
        </div>
      )}

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