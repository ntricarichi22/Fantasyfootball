"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import DirectorTwoBox from "@/shared/components/DirectorTwoBox";

import RosterPlayerCard from "./RosterPlayerCard";
import RosterPickCard from "./RosterPickCard";
import PlayerEditorOverlay from "./PlayerEditorOverlay";
import PickEditorOverlay, { type ClassScope, type ClassStrength } from "./PickEditorOverlay";
import {
  AVAILABILITY_CONFIG,
  AVAILABILITY_ORDER,
  DEFAULT_PICK_ANCHORS,
  composeFromPicks,
  decomposeToPicks,
  normalizeAttachment,
  type AttachmentLevel,
  type PickAnchors,
  type PickCounts,
} from "./availabilityConfig";
import { parsePickKey, type ParsedPick } from "./pickDisplay";

type TradeRow = {
  sleeper_player_id: string;
  player_name: string | null;
  position: string | null;
  nfl_team: string | null;
  final_value: number;
  manual_override_value: number | null;
};

// Adjusted pick, sourced entirely from the shared-backed pick-values route.
type PickAsset = { key: string; value: number; parsed: ParsedPick; ownerSuffix: string };

type TabKey = "QB" | "RB" | "PC" | "PICKS";
type LevelFilter = "ALL" | AttachmentLevel;

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FB = "'Bowlby One SC', var(--font-headline, 'Syne', sans-serif)";

const COLORS = {
  ink: "#1A1A1A",
  paper: "#FEFCF9",
  cream: "#F5F0E6",
  muted: "#8C7E6A",
  mutedDark: "#5C5C58",
  yellow: "#F5C230",
};

// Binder tab colors follow the big-board tier palette: the color IS the tab.
const TABS: { key: TabKey; label: string; color: string; on: string }[] = [
  { key: "QB", label: "QUARTERBACKS", color: "#F5C230", on: "#1A1A1A" },
  { key: "RB", label: "RUNNING BACKS", color: "#3366CC", on: "#FEFCF9" },
  { key: "PC", label: "PASS CATCHERS", color: "#E8503A", on: "#FEFCF9" },
  { key: "PICKS", label: "PICKS", color: "#2F7D4F", on: "#FEFCF9" },
];

// Short chip labels for the scoreboard strip (full words crowd the ticker).
const LEVEL_CHIP: Record<AttachmentLevel, string> = {
  untouchable: "UNTOUCHABLE",
  core_piece: "CORE",
  listening: "LISTENING",
  moveable: "MOVEABLE",
};

// Strategy Director greeting for this surface. Set Availability is a work
// surface — one tone-setting line, not per-card narration (see R&S spec).
const STRATEGY_INTRO =
  "Tell me who's available and what they're worth to us. I'll let the Personnel Director know so they can hold the line when other teams call about our guys.";

const positionMatchesTab = (position: string | null, tab: TabKey): boolean => {
  if (!position) return false;
  const p = position.toUpperCase();
  if (tab === "QB") return p === "QB";
  if (tab === "RB") return p === "RB";
  if (tab === "PC") return p === "WR" || p === "TE";
  return false;
};

const headshotUrl = (sleeperPlayerId: string) =>
  `https://sleepercdn.com/content/nfl/players/${sleeperPlayerId}.jpg`;

const priceOf = (row: TradeRow) =>
  row.manual_override_value != null ? row.manual_override_value : row.final_value;

// Picks sort: year ascending, round ascending, slot ascending (unknown last).
const sortPicks = (a: PickAsset, b: PickAsset) => {
  if (a.parsed.year !== b.parsed.year) return a.parsed.year - b.parsed.year;
  if (a.parsed.round !== b.parsed.round) return a.parsed.round - b.parsed.round;
  return (a.parsed.slot ?? 999) - (b.parsed.slot ?? 999);
};

const SA_CSS = `
.sa-binder{margin:0 46px 0 40px;box-shadow:4px 4px 0 #1A1A1A;}
.sa-content{padding:14px;}
.sa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;}
.sa-tabs{position:absolute;right:-34px;top:40px;display:flex;flex-direction:column;gap:8px;}
.sa-tab{writing-mode:vertical-rl;text-orientation:mixed;height:140px;border:3px solid #1A1A1A;border-left:none;border-radius:0 8px 8px 0;box-shadow:3px 3px 0 #1A1A1A;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:800;letter-spacing:0.1em;padding:14px 9px;cursor:pointer;}
.sa-tab-short{display:none;}
@media (max-width:700px){
  .sa-binder{margin:0;box-shadow:none;}
  .sa-hole{display:none;}
  .sa-content{padding:14px 14px 92px;}
  .sa-tabs{position:fixed;left:0;right:0;bottom:0;top:auto;flex-direction:row;gap:0;z-index:50;background:#FEFCF9;border-top:3px solid #1A1A1A;}
  .sa-tab{writing-mode:horizontal-tb;height:auto;flex:1;border:none;border-right:2px solid #1A1A1A;border-radius:0;box-shadow:none;padding:14px 4px;text-align:center;letter-spacing:0.06em;font-size:12px;}
  .sa-tab:last-child{border-right:none;}
  .sa-tab-full{display:none;}
  .sa-tab-short{display:inline;}
}`;

export default function SetAvailabilityPage() {
  const { rosterId = "" } = readStoredTeam();
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [picks, setPicks] = useState<PickAsset[]>([]);
  const [anchors, setAnchors] = useState<PickAnchors>(DEFAULT_PICK_ANCHORS);
  const [attachments, setAttachments] = useState<Record<string, AttachmentLevel>>({});
  const [pickState, setPickState] = useState<Record<string, PickCounts>>({});
  const [classByKey, setClassByKey] = useState<Record<string, ClassStrength>>({});
  const [activeTab, setActiveTab] = useState<TabKey>("QB");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("ALL");
  const [query, setQuery] = useState("");
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  const [openPickKey, setOpenPickKey] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Attachments (shared by players + picks; picks keyed by their pick: key).
  const fetchAttachments = useCallback(async (): Promise<Record<string, AttachmentLevel>> => {
    const res = await fetch(`/api/research-strategy/attachment?teamId=${encodeURIComponent(rosterId)}`);
    const json = await res.json();
    const map: Record<string, AttachmentLevel> = {};
    if (res.ok && Array.isArray(json.data)) {
      json.data.forEach((r: { sleeper_player_id: string; attachment: string }) => {
        map[r.sleeper_player_id] = normalizeAttachment(r.attachment);
      });
    }
    return map;
  }, [rosterId]);

  // The PICKS tab's single source: inventory + adjusted value + owner tag.
  const fetchPicks = useCallback(async (): Promise<PickAsset[]> => {
    const res = await fetch(`/api/research-strategy/pick-values?teamId=${encodeURIComponent(rosterId)}`);
    const json = await res.json();
    const list: PickAsset[] = [];
    if (res.ok && Array.isArray(json.data)) {
      json.data.forEach((r: { pick_key: string; final_value: number; owner_suffix?: string }) => {
        const parsed = parsePickKey(r.pick_key);
        if (parsed && typeof r.final_value === "number") {
          list.push({ key: r.pick_key, value: r.final_value, parsed, ownerSuffix: r.owner_suffix ?? "(own)" });
        }
      });
    }
    list.sort(sortPicks);
    return list;
  }, [rosterId]);

  // Stored draft-class-strength per pick (pick key -> strength).
  const fetchClassStrengths = useCallback(async (): Promise<Record<string, ClassStrength>> => {
    const res = await fetch(`/api/research-strategy/class-strength?teamId=${encodeURIComponent(rosterId)}`);
    const json = await res.json();
    const map: Record<string, ClassStrength> = {};
    if (res.ok && Array.isArray(json.data)) {
      json.data.forEach((r: { pick_key: string; strength: string }) => {
        if (r.strength === "weak" || r.strength === "average" || r.strength === "stacked") {
          map[r.pick_key] = r.strength;
        }
      });
    }
    return map;
  }, [rosterId]);

  // Refresh picks after the server has rebuilt their values.
  const reloadPicks = useCallback(async () => {
    setPicks(await fetchPicks());
  }, [fetchPicks]);

  // Lighter refresh after a PLAYER availability change: player values + attachments.
  const reloadValues = useCallback(async () => {
    if (!rosterId) return;
    try {
      const chartRes = await fetch(`/api/research-strategy/trade-chart?teamId=${encodeURIComponent(rosterId)}`);
      const chartJson = await chartRes.json();
      if (!chartRes.ok) throw new Error(chartJson?.error ?? "Failed to load values");
      setRows((chartJson.data ?? []) as TradeRow[]);
      if (chartJson.anchors?.first) setAnchors(chartJson.anchors as PickAnchors);
      setAttachments(await fetchAttachments());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  }, [rosterId, fetchAttachments]);

  const load = useCallback(async () => {
    if (!rosterId) {
      setError("No team selected.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Players: trade-chart, rebuilding on first-empty (unchanged).
      const chartRes = await fetch(`/api/research-strategy/trade-chart?teamId=${encodeURIComponent(rosterId)}`);
      const chartJson = await chartRes.json();
      if (!chartRes.ok) throw new Error(chartJson?.error ?? "Failed to load values");
      let data = (chartJson.data ?? []) as TradeRow[];
      if (chartJson.anchors?.first && chartJson.anchors?.second && chartJson.anchors?.third) {
        setAnchors(chartJson.anchors as PickAnchors);
      }
      if (data.length === 0) {
        const rebuildRes = await fetch("/api/research-strategy/trade-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: rosterId }),
        });
        const rebuildJson = await rebuildRes.json();
        if (!rebuildRes.ok) throw new Error(rebuildJson?.error ?? "Failed to build values");
        data = (rebuildJson.data ?? []) as TradeRow[];
        if (rebuildJson.anchors?.first) setAnchors(rebuildJson.anchors as PickAnchors);
      }
      setRows(data);

      // Picks: read from the shared-backed table; rebuild once if it's empty
      // (first visit), same first-empty pattern as players.
      let pickList = await fetchPicks();
      if (pickList.length === 0) {
        await fetch("/api/research-strategy/pick-values", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: rosterId }),
        });
        pickList = await fetchPicks();
      }
      setPicks(pickList);

      setAttachments(await fetchAttachments());
      setClassByKey(await fetchClassStrengths());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [rosterId, fetchAttachments, fetchClassStrengths, fetchPicks]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-derive each player's pick decomposition whenever values or anchors change.
  useEffect(() => {
    const next: Record<string, PickCounts> = {};
    rows.forEach((row) => {
      next[row.sleeper_player_id] = decomposeToPicks(priceOf(row), anchors);
    });
    setPickState(next);
  }, [rows, anchors]);

  const getAttachment = useCallback(
    (id: string): AttachmentLevel => attachments[id] ?? "listening",
    [attachments],
  );
  const getClass = (key: string): ClassStrength => classByKey[key] ?? "average";

  const setAttachment = async (id: string, level: AttachmentLevel) => {
    setAttachments((prev) => ({ ...prev, [id]: level }));
    if (!rosterId) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/research-strategy/attachment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, sleeperPlayerId: id, attachment: level }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save availability");
      // A pick's value lives in the pick table; a player's in the player path.
      if (id.startsWith("pick:")) {
        await reloadPicks();
      } else {
        await reloadValues();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save availability");
    } finally {
      setSavingId(null);
    }
  };

  const setClassStrength = async (pick: PickAsset, strength: ClassStrength, scope: ClassScope) => {
    const keys =
      scope === "just_this"
        ? [pick.key]
        : scope === "all_year"
          ? picks.filter((p) => p.parsed.year === pick.parsed.year).map((p) => p.key)
          : picks
              .filter((p) => p.parsed.year === pick.parsed.year && p.parsed.round === pick.parsed.round)
              .map((p) => p.key);

    setClassByKey((prev) => {
      const next = { ...prev };
      keys.forEach((k) => {
        next[k] = strength;
      });
      return next;
    });
    if (!rosterId) return;
    setSavingId(pick.key);
    try {
      const res = await fetch("/api/research-strategy/class-strength", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, pickKeys: keys, strength }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save class strength");
      await reloadPicks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save class strength");
    } finally {
      setSavingId(null);
    }
  };

  const adjustPick = async (id: string, key: keyof PickCounts, delta: number) => {
    const current = pickState[id] ?? { firsts: 0, seconds: 0, thirds: 0 };
    const updated = { ...current, [key]: Math.max(0, current[key] + delta) };
    setPickState((prev) => ({ ...prev, [id]: updated }));
    if (!rosterId) return;
    setSavingId(id);
    try {
      const manualOverrideValue = composeFromPicks(updated, anchors);
      const res = await fetch("/api/research-strategy/trade-chart/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, sleeperPlayerId: id, manualOverrideValue }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save price");
      setRows((json.data ?? []) as TradeRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save price");
    } finally {
      setSavingId(null);
    }
  };

  const visibleRows = useMemo(() => {
    if (activeTab === "PICKS") return [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => positionMatchesTab(r.position, activeTab))
      .filter((r) => levelFilter === "ALL" || getAttachment(r.sleeper_player_id) === levelFilter)
      .filter((r) => !q || (r.player_name ?? "").toLowerCase().includes(q))
      .sort((a, b) => priceOf(b) - priceOf(a));
  }, [rows, activeTab, levelFilter, query, getAttachment]);

  const visiblePicks = useMemo(() => {
    if (activeTab !== "PICKS") return [];
    const q = query.trim().toLowerCase();
    return picks
      .filter((p) => levelFilter === "ALL" || getAttachment(p.key) === levelFilter)
      .filter((p) => !q || `${p.parsed.year} round ${p.parsed.round} ${p.ownerSuffix}`.toLowerCase().includes(q));
  }, [picks, activeTab, levelFilter, query, getAttachment]);

  const levelCount = useCallback(
    (level: AttachmentLevel) =>
      rows.filter((r) => getAttachment(r.sleeper_player_id) === level).length +
      picks.filter((p) => getAttachment(p.key) === level).length,
    [rows, picks, getAttachment],
  );

  const openRow = rows.find((r) => r.sleeper_player_id === openPlayerId) ?? null;
  const openPick = picks.find((p) => p.key === openPickKey) ?? null;

  const tab = TABS.find((t) => t.key === activeTab) ?? TABS[0];
  const railNote = activeTab === "PICKS" ? "YEAR · ROUND · SLOT" : "SORTED BY VALUE";
  const railCount =
    activeTab === "PICKS"
      ? `${visiblePicks.length} IN THE VAULT`
      : `${visibleRows.length} ON ROSTER`;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.cream, color: COLORS.ink, paddingBottom: 60 }}>
      <style>{SA_CSS}</style>
      <UnifiedTopbar />

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 20px 0", fontFamily: F }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ fontFamily: FH, fontWeight: 900, fontSize: 34, color: COLORS.ink, letterSpacing: "-0.015em", lineHeight: 1.04 }}>
            Set Availability
          </div>
          <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: "0.16em", color: COLORS.mutedDark, fontWeight: 700, textTransform: "uppercase", paddingBottom: 5 }}>
            {rows.length} players · {picks.length} picks · {levelCount("untouchable")} untouchable · {levelCount("moveable")} on the block
          </div>
        </div>

        <div style={{ margin: "0 0 14px" }}>
          <DirectorTwoBox
            avatarSrc="/avatars/strategy.png"
            label="Strategy Director"
            message={STRATEGY_INTRO}
          />
        </div>

        {/* Scoreboard strip: search left, then availability filters — positions
            already live on the binder tabs, so the ticker filters by level. */}
        <div style={{ display: "flex", alignItems: "stretch", background: COLORS.ink, borderRadius: 8, overflowX: "auto", height: 38, marginBottom: 22 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 13px", minWidth: 150, flex: 1 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b9ab8d" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="22" y2="22" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search roster…"
              style={{ border: "none", outline: "none", background: "transparent", color: COLORS.paper, fontFamily: FM, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", width: "100%", minWidth: 90 }}
            />
          </span>
          <button
            type="button"
            onClick={() => setLevelFilter("ALL")}
            style={{
              border: "none",
              cursor: "pointer",
              fontFamily: FM,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.1em",
              padding: "0 14px",
              background: levelFilter === "ALL" ? COLORS.yellow : "transparent",
              color: levelFilter === "ALL" ? COLORS.ink : COLORS.paper,
            }}
          >
            ALL
          </button>
          {AVAILABILITY_ORDER.map((level) => {
            const cfg = AVAILABILITY_CONFIG[level];
            const isActive = levelFilter === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => setLevelFilter(isActive ? "ALL" : level)}
                style={{
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: FM,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  padding: "0 12px",
                  whiteSpace: "nowrap",
                  background: isActive ? cfg.fill : "transparent",
                  color: isActive ? cfg.text : COLORS.paper,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: isActive ? cfg.text : cfg.fill, flexShrink: 0 }} />
                {LEVEL_CHIP[level]}
              </button>
            );
          })}
        </div>

        {error && (
          <p style={{ color: "#E8503A", fontSize: 13, fontWeight: 700, margin: "0 0 12px" }}>{error}</p>
        )}

        <div className="sa-binder" style={{ position: "relative", display: "flex", border: `3px solid ${COLORS.ink}`, borderRadius: 8, background: COLORS.cream }}>
          {/* Binder ring holes down the left edge */}
          {[18, 50, 82].map((topPct) => (
            <span
              key={topPct}
              aria-hidden
              className="sa-hole"
              style={{
                position: "absolute",
                left: -40,
                top: `${topPct}%`,
                transform: "translateY(-50%)",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#D9D2C4",
                border: `3px solid ${COLORS.ink}`,
                boxShadow: "2px 2px 0 #1A1A1A",
              }}
            />
          ))}

          <div className="sa-content" style={{ flex: 1, minHeight: 440 }}>
            {/* Rail header: the binder page reads like a tier on the big board */}
            <div style={{ display: "flex", alignItems: "stretch", border: `3px solid ${COLORS.ink}`, borderRadius: 8, overflow: "hidden", background: COLORS.paper, marginBottom: 12 }}>
              <span style={{ background: tab.color, color: tab.on, padding: "7px 14px", fontFamily: FB, fontSize: 14, borderRight: `3px solid ${COLORS.ink}`, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                {tab.label}
              </span>
              <span style={{ display: "flex", alignItems: "center", padding: "0 12px", fontFamily: FM, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: COLORS.muted, fontStyle: "italic", whiteSpace: "nowrap" }}>
                {railNote}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ display: "flex", alignItems: "center", padding: "0 12px", fontFamily: F, fontSize: 11, fontWeight: 700, color: COLORS.muted, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                {railCount}
              </span>
            </div>

            {loading && rows.length === 0 ? (
              <p style={{ fontFamily: FM, fontSize: 12, color: COLORS.muted }}>
                Loading roster values&hellip;
              </p>
            ) : activeTab === "PICKS" ? (
              visiblePicks.length === 0 ? (
                <p style={{ fontFamily: FM, fontSize: 12, color: COLORS.muted }}>
                  No picks found.
                </p>
              ) : (
                <div className="sa-grid">
                  {visiblePicks.map((pick) => (
                    <RosterPickCard
                      key={pick.key}
                      parsed={pick.parsed}
                      attachment={getAttachment(pick.key)}
                      value={pick.value}
                      ownerSuffix={pick.ownerSuffix}
                      onOpen={() => setOpenPickKey(pick.key)}
                    />
                  ))}
                </div>
              )
            ) : visibleRows.length === 0 ? (
              <p style={{ fontFamily: FM, fontSize: 12, color: COLORS.muted }}>
                No players at this position.
              </p>
            ) : (
              <div className="sa-grid">
                {visibleRows.map((row, i) => (
                  <RosterPlayerCard
                    key={row.sleeper_player_id}
                    rank={i + 1}
                    playerName={row.player_name ?? row.sleeper_player_id}
                    position={row.position}
                    nflTeam={row.nfl_team}
                    photoUrl={headshotUrl(row.sleeper_player_id)}
                    attachment={getAttachment(row.sleeper_player_id)}
                    finalValue={priceOf(row)}
                    onOpen={() => setOpenPlayerId(row.sleeper_player_id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Binder tabs sticking out past the right edge */}
          <div className="sa-tabs">
            {TABS.map((t) => {
              const isActive = t.key === activeTab;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className="sa-tab"
                  style={{
                    background: isActive ? t.color : COLORS.paper,
                    color: isActive ? t.on : COLORS.ink,
                  }}
                >
                  <span className="sa-tab-full">{t.label}</span>
                  <span className="sa-tab-short">{t.key}</span>
                </button>
              );
            })}
          </div>
        </div>

        {openRow && (
          <PlayerEditorOverlay
            playerName={openRow.player_name ?? openRow.sleeper_player_id}
            position={openRow.position}
            nflTeam={openRow.nfl_team}
            attachment={getAttachment(openRow.sleeper_player_id)}
            finalValue={priceOf(openRow)}
            picks={pickState[openRow.sleeper_player_id] ?? { firsts: 0, seconds: 0, thirds: 0 }}
            saving={savingId === openRow.sleeper_player_id}
            onSetAttachment={(level) => setAttachment(openRow.sleeper_player_id, level)}
            onAdjustPick={(key, delta) => adjustPick(openRow.sleeper_player_id, key, delta)}
            onClose={() => setOpenPlayerId(null)}
          />
        )}

        {openPick && (
          <PickEditorOverlay
            parsed={openPick.parsed}
            attachment={getAttachment(openPick.key)}
            classStrength={getClass(openPick.key)}
            value={openPick.value}
            ownerSuffix={openPick.ownerSuffix}
            saving={savingId === openPick.key}
            onSetAttachment={(level) => setAttachment(openPick.key, level)}
            onSetClassStrength={(strength, scope) => setClassStrength(openPick, strength, scope)}
            onClose={() => setOpenPickKey(null)}
          />
        )}
      </div>
    </div>
  );
}
