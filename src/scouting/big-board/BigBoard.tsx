"use client";

import {
  useState, useEffect, useMemo, useCallback, useRef,
  type CSSProperties,
  type DragEvent as RDragEvent,
  type TouchEvent as RTouchEvent,
  type ReactNode,
} from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";

const F  = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

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

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

function TierDivider({
  tierLabel,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp,
  canMoveDown,
}: {
  tierLabel: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div style={{
      background: COLORS.red,
      color: COLORS.paper,
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 16px",
      borderTop: `2px solid ${COLORS.ink}`,
      borderBottom: `2px solid ${COLORS.ink}`,
    }}>
      <span style={{
        fontFamily: FM,
        fontSize: 11,
        letterSpacing: "0.22em",
        fontWeight: 700,
        color: COLORS.paper,
        textTransform: "uppercase",
      }}>
        {tierLabel}
      </span>
      <span style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: 4 }}>
        <TierCtrlButton onClick={onMoveUp} disabled={!canMoveUp} title="Move boundary up">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </TierCtrlButton>
        <TierCtrlButton onClick={onMoveDown} disabled={!canMoveDown} title="Move boundary down">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </TierCtrlButton>
        <TierCtrlButton onClick={onDelete} title="Delete tier">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </TierCtrlButton>
      </div>
    </div>
  );
}

function TierCtrlButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 24,
        height: 24,
        background: "transparent",
        border: `2px solid ${COLORS.paper}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        color: COLORS.paper,
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

function PlayerRow({
  player,
  rank,
  starred,
  onToggleStar,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
  isDropTarget,
}: {
  player: BoardPlayer;
  rank: number;
  starred: boolean;
  onToggleStar: (playerId: string) => void;
  onDragStart: (playerId: string) => void;
  onDragOver: (e: RDragEvent<HTMLDivElement>, playerId: string) => void;
  onDrop: (playerId: string) => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(player.id)}
      onDragOver={(e) => onDragOver(e, player.id)}
      onDrop={() => onDrop(player.id)}
      style={{
        display: "grid",
        gridTemplateColumns: "28px 60px 1fr 70px 70px 50px 80px",
        alignItems: "center",
        borderTop: `2px solid ${COLORS.ink}`,
        fontFamily: F,
        background: starred ? "rgba(245, 194, 48, 0.08)" : "transparent",
        opacity: isDragging ? 0.4 : 1,
        borderBottom: isDropTarget ? `3px solid ${COLORS.blue}` : undefined,
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.muted,
        cursor: "grab",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </div>
      <div style={{
        fontFamily: FH,
        fontWeight: 900,
        fontSize: 18,
        color: COLORS.ink,
        padding: "14px 0",
        textAlign: "center",
      }}>
        {rank || "—"}
      </div>
      <div style={{
        padding: "14px 12px",
        fontFamily: F,
        fontSize: 14.5,
        fontWeight: 700,
        color: COLORS.ink,
      }}>
        {player.name}
      </div>
      <div style={cellMonoStyle}>{player.position}</div>
      <div style={cellMonoStyle}>{player.team || "—"}</div>
      <div style={cellMonoStyle}>{player.age ?? "—"}</div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggleStar(player.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleStar(player.id);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "14px 0",
          cursor: "pointer",
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill={starred ? COLORS.yellow : "none"}
          stroke={COLORS.ink}
          strokeWidth="2"
          strokeLinejoin="round"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </div>
    </div>
  );
}

const cellMonoStyle: CSSProperties = {
  padding: "14px 12px",
  fontFamily: FM,
  fontSize: 12,
  fontWeight: 700,
  color: COLORS.ink,
  letterSpacing: "0.04em",
};

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

function BoardToolbar({
  query,
  onQueryChange,
  positionFilter,
  onPositionFilterChange,
  starredOnly,
  onToggleStarredOnly,
  onAddTier,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  positionFilter: Position | "ALL";
  onPositionFilterChange: (p: Position | "ALL") => void;
  starredOnly: boolean;
  onToggleStarredOnly: () => void;
  onAddTier: () => void;
}) {
  return (
    <div style={{
      padding: "0 26px 18px 26px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap",
    }}>
      <div style={{
        flex: 1,
        minWidth: 220,
        background: COLORS.paper,
        border: `3px solid ${COLORS.ink}`,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        height: 42,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.ink} strokeWidth="2.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="22" y2="22" />
        </svg>
        <input
          type="text"
          placeholder="Search players…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: F,
            fontSize: 14,
            color: COLORS.ink,
            padding: "8px 8px",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <ChipButton active={positionFilter === "ALL"} onClick={() => onPositionFilterChange("ALL")}>
          All
        </ChipButton>
        {POSITIONS.map((p) => (
          <ChipButton key={p} active={positionFilter === p} onClick={() => onPositionFilterChange(p)}>
            {p}
          </ChipButton>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleStarredOnly}
        style={{
          background: starredOnly ? COLORS.ink : COLORS.paper,
          color: starredOnly ? COLORS.paper : COLORS.ink,
          border: `3px solid ${COLORS.ink}`,
          padding: "0 14px",
          height: 42,
          display: "flex",
          alignItems: "center",
          gap: 7,
          fontFamily: FH,
          fontWeight: 800,
          fontSize: 11,
          letterSpacing: "0.16em",
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={starredOnly ? COLORS.yellow : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        Show starred
      </button>

      <button
        type="button"
        onClick={onAddTier}
        style={{
          background: COLORS.blue,
          color: COLORS.paper,
          border: `3px solid ${COLORS.ink}`,
          boxShadow: `3px 3px 0 ${COLORS.ink}`,
          padding: "0 16px",
          height: 42,
          fontFamily: FH,
          fontWeight: 800,
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.paper} strokeWidth="3" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add tier
      </button>
    </div>
  );
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? COLORS.ink : COLORS.paper,
        color: active ? COLORS.paper : COLORS.ink,
        border: `3px solid ${COLORS.ink}`,
        padding: "0 14px",
        height: 42,
        display: "flex",
        alignItems: "center",
        fontFamily: FH,
        fontWeight: 800,
        fontSize: 11,
        letterSpacing: "0.16em",
        cursor: "pointer",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

type DisplayRow = {
  player: BoardPlayer;
  ranking: Ranking | undefined;
  displayRank: number;
};

export function BigBoard() {
  const { rosterId = "" } = readStoredTeam();
  const isMobile = useIsMobile();

  const [pool, setPool] = useState<BoardPlayer[]>([]);
  const [state, setState] = useState<BoardState>({ tiers: [], rankings: [], stars: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState<Position | "ALL">("ALL");
  const [starredOnly, setStarredOnly] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

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
  // computed displayRank that reflects each row's visual position on the
  // board (1 at the top, increasing down the page). The displayRank is what
  // the user sees — it never sticks to a player, it sticks to a position.
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
      const withDisplay: DisplayRow[] = arr.map((row) => ({
        ...row,
        displayRank: pos++,
      }));
      result.set(tier.id, withDisplay);
    }

    const unranked = grouped.get(null) ?? [];
    const unrankedWithDisplay: DisplayRow[] = unranked.map((row) => ({
      ...row,
      displayRank: pos++,
    }));
    result.set(null, unrankedWithDisplay);

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

  // Move the boundary line between this tier and the tier immediately above
  // by one player position. "up" grows this tier (absorbs the last player
  // of the previous tier); "down" shrinks this tier (pushes its first
  // player back up into the previous tier).
  const shiftTierBoundary = useCallback(async (tierId: string, direction: "up" | "down") => {
    setState((s) => {
      const sortedTiers = [...s.tiers].sort((a, b) => a.order - b.order);
      const thisIdx = sortedTiers.findIndex((t) => t.id === tierId);
      if (thisIdx <= 0) return s;
      const prevTier = sortedTiers[thisIdx - 1];
      const thisTier = sortedTiers[thisIdx];

      if (direction === "up") {
        const prevTierRankings = s.rankings.filter((r) => r.tierId === prevTier.id);
        if (prevTierRankings.length === 0) return s;
        const lastPlayer = prevTierRankings.reduce((a, b) => (a.rank > b.rank ? a : b));
        const newRankings = s.rankings.map((r) =>
          r.playerId === lastPlayer.playerId ? { ...r, tierId: thisTier.id } : r
        );
        return { ...s, rankings: newRankings };
      }

      if (direction === "down") {
        const thisTierRankings = s.rankings.filter((r) => r.tierId === thisTier.id);
        if (thisTierRankings.length === 0) return s;
        const firstPlayer = thisTierRankings.reduce((a, b) => (a.rank < b.rank ? a : b));
        const newRankings = s.rankings.map((r) =>
          r.playerId === firstPlayer.playerId ? { ...r, tierId: prevTier.id } : r
        );
        return { ...s, rankings: newRankings };
      }

      return s;
    });

    try {
      await fetch("/api/scouting/big-board/rankings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roster_id: rosterId,
          action: "shift_tier_boundary",
          tier_id: tierId,
          direction,
        }),
      });
    } catch (err) {
      console.error("Shift tier boundary failed", err);
    }
  }, [rosterId]);

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

  const reorderPlayer = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setState((s) => {
      const sorted = [...s.rankings].sort((a, b) => a.rank - b.rank);
      const fromIdx = sorted.findIndex((r) => r.playerId === draggedId);
      const toIdx = sorted.findIndex((r) => r.playerId === targetId);
      if (fromIdx < 0 || toIdx < 0) return s;
      const [moved] = sorted.splice(fromIdx, 1);
      const target = sorted[toIdx];
      moved.tierId = target.tierId;
      sorted.splice(toIdx, 0, moved);
      const renumbered = sorted.map((r, i) => ({ ...r, rank: i + 1 }));
      fetch("/api/scouting/big-board/rankings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roster_id: rosterId,
          action: "reorder_players",
          rankings: renumbered,
        }),
      }).catch((err) => console.error("Reorder failed", err));
      return { ...s, rankings: renumbered };
    });
  }, [rosterId]);

  const handleDragStart = useCallback((playerId: string) => {
    setDraggingId(playerId);
  }, []);

  const handleDragOver = useCallback((e: RDragEvent<HTMLDivElement>, playerId: string) => {
    e.preventDefault();
    setDropTargetId(playerId);
  }, []);

  const handleDrop = useCallback((targetPlayerId: string) => {
    if (draggingId && draggingId !== targetPlayerId) {
      reorderPlayer(draggingId, targetPlayerId);
    }
    setDraggingId(null);
    setDropTargetId(null);
  }, [draggingId, reorderPlayer]);

  if (loading) {
    return (
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
    );
  }

  if (isMobile) {
    return (
      <MobileBigBoard
        pool={pool}
        state={state}
        starredSet={starredSet}
        query={query}
        onQueryChange={setQuery}
        positionFilter={positionFilter}
        onPositionFilterChange={setPositionFilter}
        starredOnly={starredOnly}
        onToggleStarredOnly={() => setStarredOnly((v) => !v)}
        onAddTier={addTier}
        onShiftTierBoundary={shiftTierBoundary}
        onDeleteTier={deleteTier}
        onReorderPlayer={reorderPlayer}
        onToggleStar={toggleStar}
        tiersByOrder={tiersByOrder}
        groupedRows={groupedRows}
      />
    );
  }

  return (
    <div style={{ background: COLORS.cream, minHeight: "100vh", paddingBottom: 60 }}>
      <div style={{
        padding: "26px 26px 18px 26px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 24,
      }}>
        <div style={{
          fontFamily: FH,
          fontWeight: 900,
          fontSize: 36,
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
          paddingBottom: 6,
        }}>
          {pool.length} players · {state.tiers.length} tiers · {starredSet.size} starred
        </div>
      </div>

      <BoardToolbar
        query={query}
        onQueryChange={setQuery}
        positionFilter={positionFilter}
        onPositionFilterChange={setPositionFilter}
        starredOnly={starredOnly}
        onToggleStarredOnly={() => setStarredOnly((v) => !v)}
        onAddTier={addTier}
      />

      <div style={{
        margin: "0 26px",
        background: COLORS.paper,
        border: `3px solid ${COLORS.ink}`,
        boxShadow: `5px 5px 0 ${COLORS.ink}`,
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "28px 60px 1fr 70px 70px 50px 80px",
          alignItems: "center",
          background: COLORS.ink,
          color: COLORS.paper,
          fontFamily: FM,
          fontSize: 10,
          letterSpacing: "0.18em",
          fontWeight: 700,
          textTransform: "uppercase",
          height: 36,
        }}>
          <div />
          <div style={{ padding: "0 12px", textAlign: "center" }}>#</div>
          <div style={{ padding: "0 12px" }}>Name</div>
          <div style={{ padding: "0 12px" }}>Pos</div>
          <div style={{ padding: "0 12px" }}>Team</div>
          <div style={{ padding: "0 12px" }}>Age</div>
          <div style={{ padding: "0 12px", textAlign: "center" }}>My Guy</div>
        </div>

        {tiersByOrder.map((tier, tierIdx) => {
          const rows = groupedRows.get(tier.id) ?? [];
          const isFirstTier = tierIdx === 0;
          const prevTierId = !isFirstTier ? tiersByOrder[tierIdx - 1].id : null;
          const prevTierHasPlayers = prevTierId
            ? (groupedRows.get(prevTierId)?.length ?? 0) > 0
            : false;
          const thisTierHasPlayers = rows.length > 0;

          return (
            <div key={tier.id}>
              <TierDivider
                tierLabel={tier.label ?? `Tier ${tier.order}`}
                onMoveUp={() => shiftTierBoundary(tier.id, "up")}
                onMoveDown={() => shiftTierBoundary(tier.id, "down")}
                onDelete={() => deleteTier(tier.id)}
                canMoveUp={!isFirstTier && prevTierHasPlayers}
                canMoveDown={!isFirstTier && thisTierHasPlayers}
              />
              {rows.map(({ player, displayRank }) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  rank={displayRank}
                  starred={starredSet.has(player.id)}
                  onToggleStar={toggleStar}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  isDragging={draggingId === player.id}
                  isDropTarget={dropTargetId === player.id}
                />
              ))}
            </div>
          );
        })}

        {(groupedRows.get(null) ?? []).length > 0 && (
          <div>
            <TierDivider
              tierLabel="Unranked"
              onMoveUp={() => {}}
              onMoveDown={() => {}}
              onDelete={() => {}}
              canMoveUp={false}
              canMoveDown={false}
            />
            {(groupedRows.get(null) ?? []).map(({ player, displayRank }) => (
              <PlayerRow
                key={player.id}
                player={player}
                rank={displayRank}
                starred={starredSet.has(player.id)}
                onToggleStar={toggleStar}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                isDragging={draggingId === player.id}
                isDropTarget={dropTargetId === player.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type MobileProps = {
  pool: BoardPlayer[];
  state: BoardState;
  starredSet: Set<string>;
  query: string;
  onQueryChange: (q: string) => void;
  positionFilter: Position | "ALL";
  onPositionFilterChange: (p: Position | "ALL") => void;
  starredOnly: boolean;
  onToggleStarredOnly: () => void;
  onAddTier: () => void;
  onShiftTierBoundary: (tierId: string, direction: "up" | "down") => void;
  onDeleteTier: (tierId: string) => void;
  onReorderPlayer: (draggedId: string, targetId: string) => void;
  onToggleStar: (playerId: string) => void;
  tiersByOrder: Tier[];
  groupedRows: Map<string | null, DisplayRow[]>;
};

function MobileBigBoard(props: MobileProps) {
  const {
    pool, state, starredSet, query, onQueryChange, positionFilter, onPositionFilterChange,
    starredOnly, onToggleStarredOnly, onAddTier, onShiftTierBoundary, onDeleteTier,
    onReorderPlayer, onToggleStar, tiersByOrder, groupedRows,
  } = props;

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const longPressTimer = useRef<number | null>(null);

  const handleTouchStart = useCallback((playerId: string) => {
    longPressTimer.current = window.setTimeout(() => {
      setDraggingId(playerId);
    }, 400);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (draggingId && dropTargetId) {
      onReorderPlayer(draggingId, dropTargetId);
    }
    setDraggingId(null);
    setDropTargetId(null);
  }, [draggingId, dropTargetId, onReorderPlayer]);

  const handleTouchMove = useCallback((e: RTouchEvent<HTMLDivElement>) => {
    if (!draggingId) return;
    e.preventDefault();
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const row = target?.closest("[data-player-id]") as HTMLElement | null;
    const pid = row?.dataset.playerId;
    if (pid && pid !== draggingId) setDropTargetId(pid);
  }, [draggingId]);

  return (
    <div style={{ background: COLORS.cream, minHeight: "100vh", paddingBottom: 80 }}>
      <div style={{ padding: "18px 16px 12px 16px" }}>
        <div style={{
          fontFamily: FH,
          fontWeight: 900,
          fontSize: 24,
          color: COLORS.ink,
          letterSpacing: "-0.01em",
        }}>
          Big Board
        </div>
        <div style={{
          fontFamily: FM,
          fontSize: 10,
          letterSpacing: "0.16em",
          color: COLORS.mutedDark,
          fontWeight: 700,
          textTransform: "uppercase",
          marginTop: 4,
        }}>
          {pool.length} players · {state.tiers.length} tiers · {starredSet.size} starred
        </div>
      </div>

      <div style={{ padding: "0 16px 14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{
          background: COLORS.paper,
          border: `3px solid ${COLORS.ink}`,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          height: 40,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.ink} strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="22" y2="22" />
          </svg>
          <input
            type="text"
            placeholder="Search players…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: F,
              fontSize: 14,
              padding: "8px",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["ALL", ...POSITIONS] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPositionFilterChange(p)}
              style={{
                background: positionFilter === p ? COLORS.ink : COLORS.paper,
                color: positionFilter === p ? COLORS.paper : COLORS.ink,
                border: `2.5px solid ${COLORS.ink}`,
                padding: "6px 10px",
                fontFamily: FH,
                fontWeight: 800,
                fontSize: 10,
                letterSpacing: "0.12em",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {p === "ALL" ? "All" : p}
            </button>
          ))}
          <button
            type="button"
            onClick={onToggleStarredOnly}
            style={{
              background: starredOnly ? COLORS.ink : COLORS.paper,
              color: starredOnly ? COLORS.paper : COLORS.ink,
              border: `2.5px solid ${COLORS.ink}`,
              padding: "6px 10px",
              fontFamily: FH,
              fontWeight: 800,
              fontSize: 10,
              letterSpacing: "0.12em",
              cursor: "pointer",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill={starredOnly ? COLORS.yellow : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Starred
          </button>
          <button
            type="button"
            onClick={onAddTier}
            style={{
              background: COLORS.blue,
              color: COLORS.paper,
              border: `2.5px solid ${COLORS.ink}`,
              padding: "6px 10px",
              fontFamily: FH,
              fontWeight: 800,
              fontSize: 10,
              letterSpacing: "0.12em",
              cursor: "pointer",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            + Tier
          </button>
        </div>
      </div>

      <div
        style={{
          margin: "0 16px",
          background: COLORS.paper,
          border: `3px solid ${COLORS.ink}`,
          boxShadow: `4px 4px 0 ${COLORS.ink}`,
        }}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div style={{
          display: "grid",
          gridTemplateColumns: "36px 1fr 44px 50px 44px",
          alignItems: "center",
          background: COLORS.ink,
          color: COLORS.paper,
          fontFamily: FM,
          fontSize: 9,
          letterSpacing: "0.16em",
          fontWeight: 700,
          textTransform: "uppercase",
          height: 32,
        }}>
          <div style={{ textAlign: "center" }}>#</div>
          <div style={{ padding: "0 8px" }}>Player</div>
          <div style={{ textAlign: "center" }}>Pos</div>
          <div style={{ textAlign: "center" }}>Team</div>
          <div style={{ textAlign: "center" }}>★</div>
        </div>

        {tiersByOrder.map((tier, tierIdx) => {
          const rows = groupedRows.get(tier.id) ?? [];
          const isFirstTier = tierIdx === 0;
          const prevTierId = !isFirstTier ? tiersByOrder[tierIdx - 1].id : null;
          const prevTierHasPlayers = prevTierId
            ? (groupedRows.get(prevTierId)?.length ?? 0) > 0
            : false;
          const thisTierHasPlayers = rows.length > 0;

          return (
            <div key={tier.id}>
              <TierDivider
                tierLabel={tier.label ?? `Tier ${tier.order}`}
                onMoveUp={() => onShiftTierBoundary(tier.id, "up")}
                onMoveDown={() => onShiftTierBoundary(tier.id, "down")}
                onDelete={() => onDeleteTier(tier.id)}
                canMoveUp={!isFirstTier && prevTierHasPlayers}
                canMoveDown={!isFirstTier && thisTierHasPlayers}
              />
              {rows.map(({ player, displayRank }) => (
                <div
                  key={player.id}
                  data-player-id={player.id}
                  onTouchStart={() => handleTouchStart(player.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr 44px 50px 44px",
                    alignItems: "center",
                    borderTop: `2px solid ${COLORS.ink}`,
                    background: starredSet.has(player.id) ? "rgba(245,194,48,0.08)" : "transparent",
                    opacity: draggingId === player.id ? 0.4 : 1,
                    borderBottom: dropTargetId === player.id ? `3px solid ${COLORS.blue}` : undefined,
                    touchAction: "pan-y",
                  }}
                >
                  <div style={{
                    fontFamily: FH,
                    fontWeight: 900,
                    fontSize: 14,
                    color: COLORS.ink,
                    padding: "12px 0",
                    textAlign: "center",
                  }}>
                    {displayRank}
                  </div>
                  <div style={{
                    padding: "12px 8px",
                    fontFamily: F,
                    fontSize: 13,
                    fontWeight: 700,
                    color: COLORS.ink,
                  }}>
                    {player.name}
                  </div>
                  <div style={{
                    padding: "12px 0",
                    fontFamily: FM,
                    fontSize: 11,
                    fontWeight: 700,
                    color: COLORS.ink,
                    textAlign: "center",
                  }}>
                    {player.position}
                  </div>
                  <div style={{
                    padding: "12px 0",
                    fontFamily: FM,
                    fontSize: 11,
                    fontWeight: 700,
                    color: COLORS.ink,
                    textAlign: "center",
                  }}>
                    {player.team || "—"}
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(player.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "12px 0",
                      cursor: "pointer",
                    }}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill={starredSet.has(player.id) ? COLORS.yellow : "none"}
                      stroke={COLORS.ink}
                      strokeWidth="2"
                      strokeLinejoin="round"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {(groupedRows.get(null) ?? []).length > 0 && (
          <div>
            <TierDivider
              tierLabel="Unranked"
              onMoveUp={() => {}}
              onMoveDown={() => {}}
              onDelete={() => {}}
              canMoveUp={false}
              canMoveDown={false}
            />
            {(groupedRows.get(null) ?? []).map(({ player, displayRank }) => (
              <div
                key={player.id}
                data-player-id={player.id}
                onTouchStart={() => handleTouchStart(player.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "36px 1fr 44px 50px 44px",
                  alignItems: "center",
                  borderTop: `2px solid ${COLORS.ink}`,
                  touchAction: "pan-y",
                }}
              >
                <div style={{ padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 900, fontSize: 14 }}>{displayRank}</div>
                <div style={{ padding: "12px 8px", fontFamily: F, fontSize: 13, fontWeight: 700 }}>{player.name}</div>
                <div style={{ padding: "12px 0", textAlign: "center", fontFamily: FM, fontSize: 11, fontWeight: 700 }}>{player.position}</div>
                <div style={{ padding: "12px 0", textAlign: "center", fontFamily: FM, fontSize: 11, fontWeight: 700 }}>{player.team || "—"}</div>
                <div
                  role="button"
                  onClick={(e) => { e.stopPropagation(); onToggleStar(player.id); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 0", cursor: "pointer" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={starredSet.has(player.id) ? COLORS.yellow : "none"} stroke={COLORS.ink} strokeWidth="2" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}