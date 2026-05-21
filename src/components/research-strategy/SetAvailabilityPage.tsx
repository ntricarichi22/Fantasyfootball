"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { InnerTopbar } from "@/shared/ui/InnerTopbar";
import DirectorTwoBox from "@/shared/components/DirectorTwoBox";

import RosterPlayerCard from "./RosterPlayerCard";
import RosterPickCard from "./RosterPickCard";
import PlayerEditorOverlay from "./PlayerEditorOverlay";
import PickEditorOverlay, { type ClassScope, type ClassStrength } from "./PickEditorOverlay";
import {
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

const TABS: { key: TabKey; label: string }[] = [
  { key: "QB", label: "QUARTERBACKS" },
  { key: "RB", label: "RUNNING BACKS" },
  { key: "PC", label: "PASS CATCHERS" },
  { key: "PICKS", label: "PICKS" },
];

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

export default function SetAvailabilityPage() {
  const { rosterId = "" } = readStoredTeam();
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [picks, setPicks] = useState<PickAsset[]>([]);
  const [anchors, setAnchors] = useState<PickAnchors>(DEFAULT_PICK_ANCHORS);
  const [attachments, setAttachments] = useState<Record<string, AttachmentLevel>>({});
  const [pickState, setPickState] = useState<Record<string, PickCounts>>({});
  const [classByKey, setClassByKey] = useState<Record<string, ClassStrength>>({});
  const [activeTab, setActiveTab] = useState<TabKey>("QB");
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

  const getAttachment = (id: string): AttachmentLevel => attachments[id] ?? "listening";
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
    return rows
      .filter((r) => positionMatchesTab(r.position, activeTab))
      .sort((a, b) => b.final_value - a.final_value);
  }, [rows, activeTab]);

  const openRow = rows.find((r) => r.sleeper_player_id === openPlayerId) ?? null;
  const openPick = picks.find((p) => p.key === openPickKey) ?? null;

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E6", color: "#1A1A1A" }}>
      <InnerTopbar breadcrumb="SET AVAILABILITY" />
      <div style={{ height: 3, background: "#E8503A" }} />

      <div
        style={{
          padding: "20px 24px",
          maxWidth: 1100,
          margin: "0 auto",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
      <div style={{ margin: "0 0 16px" }}>
        <DirectorTwoBox
          avatarSrc="/avatars/strategy.png"
          label="Strategy Director"
          message={STRATEGY_INTRO}
        />
      </div>

      {error && (
        <p style={{ color: "#E8503A", fontSize: 13, fontWeight: 700, margin: "0 0 12px" }}>{error}</p>
      )}

      <div
        style={{
          position: "relative",
          display: "flex",
          margin: "0 46px 0 40px",
          border: "3px solid #1A1A1A",
          boxShadow: "4px 4px 0 #1A1A1A",
          background: "#F5F0E6",
        }}
      >
        {/* Binder ring holes down the left edge */}
        {[18, 50, 82].map((topPct) => (
          <span
            key={topPct}
            aria-hidden
            style={{
              position: "absolute",
              left: -40,
              top: `${topPct}%`,
              transform: "translateY(-50%)",
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#D9D2C4",
              border: "3px solid #1A1A1A",
              boxShadow: "2px 2px 0 #1A1A1A",
            }}
          />
        ))}

        <div style={{ flex: 1, padding: 16, minHeight: 440 }}>
          {loading && rows.length === 0 ? (
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8C7E6A" }}>
              Loading roster values&hellip;
            </p>
          ) : activeTab === "PICKS" ? (
            picks.length === 0 ? (
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8C7E6A" }}>
                No picks found.
              </p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                {picks.map((pick) => (
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
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#8C7E6A" }}>
              No players at this position.
            </p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {visibleRows.map((row) => (
                <RosterPlayerCard
                  key={row.sleeper_player_id}
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
        <div
          style={{
            position: "absolute",
            right: -34,
            top: 40,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                  height: 140,
                  background: isActive ? "#1A1A1A" : "#FEFCF9",
                  color: isActive ? "#FEFCF9" : "#1A1A1A",
                  border: "3px solid #1A1A1A",
                  borderLeft: "none",
                  boxShadow: "3px 3px 0 #1A1A1A",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  padding: "14px 9px",
                  cursor: "pointer",
                }}
              >
                {tab.label}
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