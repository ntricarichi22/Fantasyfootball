"use client";

import {
  useState, useEffect, useMemo, useCallback, useRef,
  type DragEvent as RDragEvent,
  type TouchEvent as RTouchEvent,
  type ReactNode,
} from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { NFL_TEAM_FULL_NAME, POSITION_FULL_NAME } from "@/components/research-strategy/availabilityConfig";

const F  = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FB = "'Bowlby One SC', var(--font-headline, 'Syne', sans-serif)";

const COLORS = {
  ink: "#1A1A1A",
  paper: "#FEFCF9",
  cream: "#F5F0E6",
  muted: "#8C7E6A",
  mutedDark: "#5C5C58",
  blue: "#3366CC",
  red: "#E8503A",
  yellow: "#F5C230",
};

// One pop color per tier, Ringer-style: the color IS the tier, painted across
// the rail chip and every card's photo block. `on` = readable text on `main`.
type TierColor = { main: string; dark: string; on: string };
const TIER_PALETTE: TierColor[] = [
  { main: "#F5C230", dark: "#7A5F0A", on: "#1A1A1A" },
  { main: "#3366CC", dark: "#0D2A5C", on: "#FEFCF9" },
  { main: "#E8503A", dark: "#5C150C", on: "#FEFCF9" },
  { main: "#2F7D4F", dark: "#123420", on: "#FEFCF9" },
  { main: "#7C5CBF", dark: "#2E1D52", on: "#FEFCF9" },
  { main: "#D4537E", dark: "#4B1528", on: "#FEFCF9" },
];
const UNRANKED_COLOR: TierColor = { main: "#8C7E6A", dark: "#3C362C", on: "#FEFCF9" };

const headshotUrl = (playerId: string) => `https://sleepercdn.com/content/nfl/players/${playerId}.jpg`;
const nflLogoUrl = (team: string) => `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;

export type Position = string;

export type BoardPlayer = {
  id: string;
  name: string;
  position: Position;
  team: string;
  age: number | null;
  isRookie: boolean;
  consensusRank: number | null;
};

export type Tier = {
  id: string;
  order: number;
  label?: string;
};

export type Ranking = {
  playerId: string;
  tierId: string | null;
  rank: number;
};

export type Star = {
  playerId: string;
  starred: boolean;
};

export type BoardState = {
  tiers: Tier[];
  rankings: Ranking[];
  stars: Star[];
};

type DisplayRow = {
  player: BoardPlayer;
  ranking: Ranking | undefined;
  displayRank: number;
};

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

function StarIcon({ filled, size = 15 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? COLORS.ink : "none"} stroke={COLORS.ink} strokeWidth="2" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

// The poster card: big rank numeral, NFL logo, name block, then the headshot
// sitting in a tier-colored block (grayscale + multiply = duotone in the tier
// color, and it swallows the photo's background). Star = "my guy" toggle.
function PlayerCard({
  player,
  rank,
  starred,
  color,
  isDragging,
  isDropTarget,
  onToggleStar,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onTouchStart,
}: {
  player: BoardPlayer;
  rank: number;
  starred: boolean;
  color: TierColor;
  isDragging: boolean;
  isDropTarget: boolean;
  onToggleStar: (playerId: string) => void;
  onDragStart: (playerId: string) => void;
  onDragOver: (e: RDragEvent<HTMLDivElement>, playerId: string) => void;
  onDrop: (playerId: string) => void;
  onDragEnd: () => void;
  onTouchStart: (playerId: string) => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const posLabel = POSITION_FULL_NAME[player.position] ?? player.position;
  const teamLabel = player.team ? (NFL_TEAM_FULL_NAME[player.team] ?? player.team) : "Free agent";
  const sub = [posLabel, teamLabel, player.age != null ? String(player.age) : null].filter(Boolean).join(" · ");

  return (
    <div
      draggable
      data-player-id={player.id}
      onDragStart={() => onDragStart(player.id)}
      onDragOver={(e) => onDragOver(e, player.id)}
      onDrop={() => onDrop(player.id)}
      onDragEnd={onDragEnd}
      onTouchStart={() => onTouchStart(player.id)}
      style={{
        background: COLORS.paper,
        border: `2px solid ${COLORS.ink}`,
        borderRadius: 12,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: "grab",
        opacity: isDragging ? 0.35 : 1,
        outline: isDropTarget ? `3px solid ${COLORS.blue}` : "none",
        outlineOffset: 2,
        touchAction: "pan-y",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "8px 10px 0", height: 34, boxSizing: "content-box" }}>
        <span style={{ fontFamily: FB, fontSize: 27, color: COLORS.ink, lineHeight: 0.95 }}>{rank || "—"}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          draggable={false}
          aria-label={starred ? "Unmark my guy" : "Mark as my guy"}
          title={starred ? "My guy" : "Mark as my guy"}
          onClick={(e) => { e.stopPropagation(); onToggleStar(player.id); }}
          onTouchStart={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: starred ? COLORS.yellow : COLORS.paper,
            border: `2px solid ${COLORS.ink}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <StarIcon filled={starred} size={14} />
        </button>
        {player.team ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={nflLogoUrl(player.team)} alt={player.team} style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }} />
        ) : (
          <span style={{ fontFamily: FM, fontSize: 9, fontWeight: 700, color: COLORS.muted, border: `1.5px solid ${COLORS.muted}`, borderRadius: 4, padding: "2px 5px", flexShrink: 0 }}>FA</span>
        )}
      </div>
      {/* Fixed-height text zone so every card (and its color block) lines up. */}
      <div style={{ padding: "5px 10px 8px" }}>
        <div style={{ fontFamily: F, fontSize: 14, fontWeight: 800, color: COLORS.ink, lineHeight: 1.15, height: 32, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{player.name}</div>
        <div style={{ fontFamily: F, fontSize: 10, fontWeight: 500, color: COLORS.mutedDark, marginTop: 2, lineHeight: 1.3, height: 26, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{sub}</div>
      </div>
      <div style={{ background: color.main, height: 122, position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={headshotUrl(player.id)}
            alt={player.name}
            onError={() => setImgOk(false)}
            draggable={false}
            style={{ width: "100%", height: 122, objectFit: "cover", objectPosition: "center top", display: "block", filter: "grayscale(100%)", mixBlendMode: "multiply" }}
          />
        ) : (
          <svg viewBox="0 0 80 62" style={{ width: "76%" }} aria-hidden="true">
            <circle cx="40" cy="20" r="15" fill={color.dark} />
            <path d="M8 62 Q12 38 40 38 Q68 38 72 62 Z" fill={color.dark} />
          </svg>
        )}
      </div>
    </div>
  );
}

// End-of-rail drop target: always there for empty tiers, appears everywhere
// else while a card is in hand.
function TierDropZone({
  tierId,
  active,
  empty,
  onDragOver,
  onDrop,
}: {
  tierId: string;
  active: boolean;
  empty: boolean;
  onDragOver: (e: RDragEvent<HTMLDivElement>, tierId: string) => void;
  onDrop: (tierId: string) => void;
}) {
  return (
    <div
      data-tier-drop={tierId}
      onDragOver={(e) => onDragOver(e, tierId)}
      onDrop={() => onDrop(tierId)}
      style={{
        border: `2px dashed ${active ? COLORS.blue : COLORS.muted}`,
        background: active ? "rgba(51,102,204,0.08)" : "transparent",
        borderRadius: 12,
        minHeight: empty ? 120 : 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: active ? 1 : 0.55,
      }}
    >
      <div style={{ textAlign: "center", color: active ? COLORS.blue : COLORS.muted, fontFamily: FM, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", padding: 10 }}>
        {empty ? "DROP PLAYERS HERE" : "DROP HERE"}
      </div>
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? COLORS.ink : COLORS.paper,
        color: active ? COLORS.paper : COLORS.ink,
        border: `3px solid ${COLORS.ink}`,
        padding: "0 13px",
        height: 40,
        display: "flex",
        alignItems: "center",
        fontFamily: FH,
        fontWeight: 800,
        fontSize: 11,
        letterSpacing: "0.14em",
        cursor: "pointer",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

export function BigBoard() {
  const { rosterId = "" } = readStoredTeam();

  const [pool, setPool] = useState<BoardPlayer[]>([]);
  const [state, setState] = useState<BoardState>({ tiers: [], rankings: [], stars: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState<Position | "ALL">("ALL");
  const [starredOnly, setStarredOnly] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropTierId, setDropTierId] = useState<string | null>(null);
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const longPressTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!rosterId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/scouting/big-board/rankings?roster_id=${encodeURIComponent(rosterId)}`);
        if (!r.ok) throw new Error("Failed to load rankings");
        const j = await r.json();
        if (cancelled) return;
        setPool(j.players ?? []);
        setState({
          tiers: j.tiers ?? [],
          rankings: j.rankings ?? [],
          stars: j.stars ?? [],
        });
      } catch (err) {
        console.error("Big Board load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rosterId]);

  const rankingByPlayer = useMemo(() => {
    const m = new Map<string, Ranking>();
    for (const r of state.rankings) m.set(r.playerId, r);
    return m;
  }, [state.rankings]);

  const starredSet = useMemo(() => {
    return new Set(state.stars.filter((s) => s.starred).map((s) => s.playerId));
  }, [state.stars]);

  const tiersByOrder = useMemo(() => {
    return [...state.tiers].sort((a, b) => a.order - b.order);
  }, [state.tiers]);

  // Group players by tier, sorted within each tier by stored rank, with a
  // computed displayRank for each row's visual position (1 at the top). The
  // rank sticks to the position, not the player — so it re-flows live as
  // players get drafted away or dragged around.
  const groupedRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = pool
      .filter((p) => positionFilter === "ALL" || p.position === positionFilter)
      .filter((p) => !starredOnly || starredSet.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q));

    const grouped = new Map<string | null, Array<{ player: BoardPlayer; ranking: Ranking | undefined }>>();
    for (const player of filtered) {
      const ranking = rankingByPlayer.get(player.id);
      const key = ranking?.tierId ?? null;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({ player, ranking });
    }

    for (const arr of grouped.values()) {
      arr.sort((a, b) => {
        const ra = a.ranking?.rank ?? Number.MAX_SAFE_INTEGER;
        const rb = b.ranking?.rank ?? Number.MAX_SAFE_INTEGER;
        return ra - rb;
      });
    }

    const result = new Map<string | null, DisplayRow[]>();
    let pos = 1;

    for (const tier of tiersByOrder) {
      const arr = grouped.get(tier.id) ?? [];
      result.set(tier.id, arr.map((row) => ({ ...row, displayRank: pos++ })));
    }

    const unranked = grouped.get(null) ?? [];
    result.set(null, unranked.map((row) => ({ ...row, displayRank: pos++ })));

    return result;
  }, [pool, query, positionFilter, starredOnly, starredSet, rankingByPlayer, tiersByOrder]);

  const toggleStar = useCallback(async (playerId: string) => {
    const currentlyStarred = starredSet.has(playerId);
    const next = !currentlyStarred;
    setState((s) => {
      const others = s.stars.filter((x) => x.playerId !== playerId);
      return { ...s, stars: [...others, { playerId, starred: next }] };
    });
    try {
      await fetch("/api/scouting/big-board/star", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, player_id: playerId, starred: next }),
      });
    } catch (err) {
      console.error("Star toggle failed; reverting", err);
      setState((s) => {
        const others = s.stars.filter((x) => x.playerId !== playerId);
        return { ...s, stars: [...others, { playerId, starred: currentlyStarred }] };
      });
    }
  }, [starredSet, rosterId]);

  const addTier = useCallback(async () => {
    const nextOrder = (tiersByOrder[tiersByOrder.length - 1]?.order ?? 0) + 1;
    const tempId = `tmp-${Date.now()}`;
    const tier: Tier = { id: tempId, order: nextOrder };
    setState((s) => ({ ...s, tiers: [...s.tiers, tier] }));
    try {
      const r = await fetch("/api/scouting/big-board/rankings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, action: "add_tier", tier_order: nextOrder }),
      });
      const j = await r.json();
      if (j.tier_id) {
        setState((s) => ({
          ...s,
          tiers: s.tiers.map((t) => (t.id === tempId ? { ...t, id: j.tier_id } : t)),
        }));
      }
    } catch (err) {
      console.error("Add tier failed", err);
    }
  }, [tiersByOrder, rosterId]);

  const deleteTier = useCallback((tierId: string) => {
    setState((s) => {
      const updatedTiers = s.tiers.filter((t) => t.id !== tierId);
      const updatedRankings = s.rankings.map((r) =>
        r.tierId === tierId ? { ...r, tierId: null } : r
      );
      fetch("/api/scouting/big-board/rankings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, action: "delete_tier", tier_id: tierId }),
      }).catch((err) => console.error("Delete tier failed", err));
      return { ...s, tiers: updatedTiers, rankings: updatedRankings };
    });
  }, [rosterId]);

  const persistRankings = useCallback((renumbered: Ranking[]) => {
    fetch("/api/scouting/big-board/rankings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roster_id: rosterId, action: "reorder_players", rankings: renumbered }),
    }).catch((err) => console.error("Reorder failed", err));
  }, [rosterId]);

  // Drop on a card: insert before it, adopting its tier. Dragging a player the
  // board has never ranked creates their ranking on the fly.
  const reorderPlayer = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setState((s) => {
      const sorted = [...s.rankings].sort((a, b) => a.rank - b.rank);
      if (!sorted.some((r) => r.playerId === targetId)) return s;
      const fromIdx = sorted.findIndex((r) => r.playerId === draggedId);
      const moved: Ranking = fromIdx >= 0 ? sorted.splice(fromIdx, 1)[0] : { playerId: draggedId, tierId: null, rank: 0 };
      const toIdx = sorted.findIndex((r) => r.playerId === targetId);
      moved.tierId = sorted[toIdx].tierId;
      sorted.splice(toIdx, 0, moved);
      const renumbered = sorted.map((r, i) => ({ ...r, rank: i + 1 }));
      persistRankings(renumbered);
      return { ...s, rankings: renumbered };
    });
  }, [persistRankings]);

  // Drop on a tier's tail zone: land at the end of that tier.
  const moveToTierEnd = useCallback((draggedId: string, tierId: string) => {
    setState((s) => {
      const sorted = [...s.rankings].sort((a, b) => a.rank - b.rank);
      const fromIdx = sorted.findIndex((r) => r.playerId === draggedId);
      const moved: Ranking = fromIdx >= 0 ? sorted.splice(fromIdx, 1)[0] : { playerId: draggedId, tierId: null, rank: 0 };
      moved.tierId = tierId;
      const tierPos = new Map(tiersByOrder.map((t, i) => [t.id, i]));
      const target = tierPos.get(tierId) ?? Infinity;
      let insertIdx = sorted.length;
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i].tierId != null ? (tierPos.get(sorted[i].tierId!) ?? Infinity) : Infinity;
        if (p > target) { insertIdx = i; break; }
      }
      sorted.splice(insertIdx, 0, moved);
      const renumbered = sorted.map((r, i) => ({ ...r, rank: i + 1 }));
      persistRankings(renumbered);
      return { ...s, rankings: renumbered };
    });
  }, [persistRankings, tiersByOrder]);

  const saveTierLabel = useCallback(async (tierId: string, raw: string) => {
    const trimmed = raw.trim().slice(0, 28);
    setEditingTierId(null);
    setState((s) => ({
      ...s,
      tiers: s.tiers.map((t) => (t.id === tierId ? { ...t, label: trimmed || undefined } : t)),
    }));
    try {
      await fetch("/api/scouting/big-board/rankings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, action: "set_tier_label", tier_id: tierId, label: trimmed }),
      });
    } catch (err) {
      console.error("Tier label save failed", err);
    }
  }, [rosterId]);

  // Re-cut the tier lines from clear CFC value drops along the current order.
  const suggestTiers = useCallback(async () => {
    if (!window.confirm("Rebuild tiers from clear drops in CFC value? Your player order is kept — only the tier lines move.")) return;
    setSuggesting(true);
    try {
      const r = await fetch("/api/scouting/big-board/rankings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, action: "auto_tier" }),
      });
      const j = await r.json();
      if (j.tiers && j.rankings) {
        setState((s) => ({ ...s, tiers: j.tiers, rankings: j.rankings }));
      }
    } catch (err) {
      console.error("Suggest tiers failed", err);
    } finally {
      setSuggesting(false);
    }
  }, [rosterId]);

  // Desktop mouse drag.
  const handleDragStart = useCallback((playerId: string) => setDraggingId(playerId), []);
  const handleCardDragOver = useCallback((e: RDragEvent<HTMLDivElement>, playerId: string) => {
    e.preventDefault();
    setDropTargetId(playerId);
    setDropTierId(null);
  }, []);
  const handleZoneDragOver = useCallback((e: RDragEvent<HTMLDivElement>, tierId: string) => {
    e.preventDefault();
    setDropTierId(tierId);
    setDropTargetId(null);
  }, []);
  const clearDrag = useCallback(() => {
    setDraggingId(null);
    setDropTargetId(null);
    setDropTierId(null);
  }, []);
  const handleCardDrop = useCallback((targetPlayerId: string) => {
    if (draggingId && draggingId !== targetPlayerId) reorderPlayer(draggingId, targetPlayerId);
    clearDrag();
  }, [draggingId, reorderPlayer, clearDrag]);
  const handleZoneDrop = useCallback((tierId: string) => {
    if (draggingId) moveToTierEnd(draggingId, tierId);
    clearDrag();
  }, [draggingId, moveToTierEnd, clearDrag]);

  // Touch: long-press a card to pick it up, slide, lift to drop.
  const handleTouchStart = useCallback((playerId: string) => {
    longPressTimer.current = window.setTimeout(() => setDraggingId(playerId), 400);
  }, []);
  const handleTouchMove = useCallback((e: RTouchEvent<HTMLDivElement>) => {
    if (!draggingId) return;
    e.preventDefault();
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const el = target?.closest("[data-player-id],[data-tier-drop]") as HTMLElement | null;
    if (el?.dataset.playerId && el.dataset.playerId !== draggingId) {
      setDropTargetId(el.dataset.playerId);
      setDropTierId(null);
    } else if (el?.dataset.tierDrop) {
      setDropTierId(el.dataset.tierDrop);
      setDropTargetId(null);
    }
  }, [draggingId]);
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (draggingId && dropTargetId) reorderPlayer(draggingId, dropTargetId);
    else if (draggingId && dropTierId) moveToTierEnd(draggingId, dropTierId);
    clearDrag();
  }, [draggingId, dropTargetId, dropTierId, reorderPlayer, moveToTierEnd, clearDrag]);

  if (loading) {
    return (
      <div style={{ background: COLORS.cream, minHeight: "100vh" }}>
        <UnifiedTopbar />
        <div style={{
          height: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FM,
          fontSize: 12,
          color: COLORS.muted,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}>
          Loading board…
        </div>
      </div>
    );
  }

  const unrankedRows = groupedRows.get(null) ?? [];

  const renderRail = (opts: {
    key: string;
    color: TierColor;
    title: string;
    tier?: Tier;
    rows: DisplayRow[];
  }) => {
    const { color, title, tier, rows } = opts;
    const first = rows[0]?.displayRank;
    const last = rows[rows.length - 1]?.displayRank;
    const rangeText = rows.length === 0 ? "EMPTY" : first === last ? `RANK ${first}` : `RANKS ${first}–${last}`;
    const editing = tier && editingTierId === tier.id;
    return (
      <div style={{
        display: "flex",
        alignItems: "stretch",
        border: `3px solid ${COLORS.ink}`,
        borderRadius: 8,
        overflow: "hidden",
        background: COLORS.paper,
        marginBottom: 13,
      }}>
        <span style={{
          background: color.main,
          color: color.on,
          padding: "8px 14px",
          fontFamily: FB,
          fontSize: 15,
          borderRight: `3px solid ${COLORS.ink}`,
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap",
        }}>
          {title}
        </span>
        {tier && (
          editing ? (
            <input
              autoFocus
              defaultValue={labelDraft}
              maxLength={28}
              placeholder="add a label…"
              onBlur={(e) => saveTierLabel(tier.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingTierId(null);
              }}
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: FM,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: COLORS.ink,
                padding: "0 12px",
                minWidth: 0,
                width: 180,
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => { setLabelDraft(tier.label ?? ""); setEditingTierId(tier.id); }}
              title="Edit tier label"
              style={{
                border: "none",
                background: "transparent",
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "0 12px",
                cursor: "text",
                fontFamily: FM,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: tier.label ? COLORS.ink : COLORS.muted,
                fontStyle: tier.label ? "normal" : "italic",
              }}
            >
              {tier.label || "add a label…"}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
          )
        )}
        <span style={{ flex: 1 }} />
        <span style={{
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          fontFamily: F,
          fontSize: 11,
          fontWeight: 700,
          color: COLORS.muted,
          letterSpacing: "0.08em",
          whiteSpace: "nowrap",
        }}>
          {rangeText}
        </span>
        {tier && (
          <button
            type="button"
            onClick={() => deleteTier(tier.id)}
            title="Delete tier (players drop to unranked)"
            style={{
              border: "none",
              borderLeft: `2px solid ${COLORS.ink}`,
              background: "transparent",
              color: COLORS.muted,
              width: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ background: COLORS.cream, minHeight: "100vh", paddingBottom: 60 }}>
      <UnifiedTopbar />
      <div
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 20px 0" }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{
            fontFamily: FH,
            fontWeight: 900,
            fontSize: 34,
            color: COLORS.ink,
            letterSpacing: "-0.015em",
            lineHeight: 1.04,
          }}>
            Big Board
          </div>
          <div style={{
            fontFamily: FM,
            fontSize: 11,
            letterSpacing: "0.16em",
            color: COLORS.mutedDark,
            fontWeight: 700,
            textTransform: "uppercase",
            paddingBottom: 5,
          }}>
            {pool.length} players · {state.tiers.length} tiers · {starredSet.size} starred
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 22 }}>
          <div style={{
            flex: 1,
            minWidth: 180,
            background: COLORS.paper,
            border: `3px solid ${COLORS.ink}`,
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            height: 40,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.ink} strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="22" y2="22" />
            </svg>
            <input
              type="text"
              placeholder="Search players…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: F,
                fontSize: 14,
                color: COLORS.ink,
                padding: "8px",
                minWidth: 0,
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ChipButton active={positionFilter === "ALL"} onClick={() => setPositionFilter("ALL")}>All</ChipButton>
            {POSITIONS.map((p) => (
              <ChipButton key={p} active={positionFilter === p} onClick={() => setPositionFilter(p)}>{p}</ChipButton>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setStarredOnly((v) => !v)}
            style={{
              background: starredOnly ? COLORS.ink : COLORS.paper,
              color: starredOnly ? COLORS.paper : COLORS.ink,
              border: `3px solid ${COLORS.ink}`,
              padding: "0 13px",
              height: 40,
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontFamily: FH,
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: "0.14em",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill={starredOnly ? COLORS.yellow : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            My guys
          </button>

          <button
            type="button"
            onClick={suggestTiers}
            disabled={suggesting}
            title="Re-cut tiers where CFC value clearly drops"
            style={{
              background: COLORS.yellow,
              color: COLORS.ink,
              border: `3px solid ${COLORS.ink}`,
              boxShadow: `3px 3px 0 ${COLORS.ink}`,
              padding: "0 15px",
              height: 40,
              fontFamily: FH,
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 7,
              cursor: suggesting ? "wait" : "pointer",
              opacity: suggesting ? 0.6 : 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" />
            </svg>
            {suggesting ? "Cutting…" : "Suggest tiers"}
          </button>

          <button
            type="button"
            onClick={addTier}
            style={{
              background: COLORS.blue,
              color: COLORS.paper,
              border: `3px solid ${COLORS.ink}`,
              boxShadow: `3px 3px 0 ${COLORS.ink}`,
              padding: "0 15px",
              height: 40,
              fontFamily: FH,
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 7,
              cursor: "pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={COLORS.paper} strokeWidth="3" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add tier
          </button>
        </div>

        {tiersByOrder.map((tier, tierIdx) => {
          const rows = groupedRows.get(tier.id) ?? [];
          const color = TIER_PALETTE[tierIdx % TIER_PALETTE.length];
          const showZone = rows.length === 0 || draggingId != null;
          return (
            <section key={tier.id} style={{ marginBottom: 26 }}>
              {renderRail({ key: tier.id, color, title: `TIER ${tierIdx + 1}`, tier, rows })}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                {rows.map(({ player, displayRank }) => (
                  <PlayerCard
                    key={player.id}
                    player={player}
                    rank={displayRank}
                    starred={starredSet.has(player.id)}
                    color={color}
                    isDragging={draggingId === player.id}
                    isDropTarget={dropTargetId === player.id}
                    onToggleStar={toggleStar}
                    onDragStart={handleDragStart}
                    onDragOver={handleCardDragOver}
                    onDrop={handleCardDrop}
                    onDragEnd={clearDrag}
                    onTouchStart={handleTouchStart}
                  />
                ))}
                {showZone && (
                  <TierDropZone
                    tierId={tier.id}
                    active={dropTierId === tier.id}
                    empty={rows.length === 0}
                    onDragOver={handleZoneDragOver}
                    onDrop={handleZoneDrop}
                  />
                )}
              </div>
            </section>
          );
        })}

        {unrankedRows.length > 0 && (
          <section style={{ marginBottom: 26 }}>
            {renderRail({ key: "unranked", color: UNRANKED_COLOR, title: "UNRANKED", rows: unrankedRows })}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {unrankedRows.map(({ player, displayRank }) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  rank={displayRank}
                  starred={starredSet.has(player.id)}
                  color={UNRANKED_COLOR}
                  isDragging={draggingId === player.id}
                  isDropTarget={dropTargetId === player.id}
                  onToggleStar={toggleStar}
                  onDragStart={handleDragStart}
                  onDragOver={handleCardDragOver}
                  onDrop={handleCardDrop}
                  onDragEnd={clearDrag}
                  onTouchStart={handleTouchStart}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
