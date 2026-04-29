"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "../../lib/storedTeam";
import DealCard, { type DealAsset } from "./DealCard";
import AIAdvisor, { type AdvisorSuggestion } from "./AIAdvisor";
import PlayerRow from "./PlayerRow";
import TierDivider from "./TierDivider";
import RoutingPopup from "./RoutingPopup";
import type { CartItem } from "./CartSidebar";

type Props = { initialCart: CartItem[]; initialTeams: { id: string; name: string }[]; onBack: () => void };
type RosterPlayer = { key: string; name: string; meta: string; tier: string; value: number; position: string; type: "player" | "pick" };
type StratProfile = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

function adjustedValue(baseVal: number, pos: string, profile: StratProfile | null): number {
  if (!profile || !pos) return baseVal;
  const m = pos === "QB" ? profile.qb_market : pos === "RB" ? profile.rb_market : pos === "WR" ? profile.wr_market : pos === "TE" ? profile.te_market : "hold";
  return Math.round(baseVal * (m === "buy" ? 1.25 : m === "sell" ? 0.8 : 1));
}

function teamNick(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

export default function TradeBuilder({ initialCart, initialTeams, onBack }: Props) {
  const { rosterId = "", teamName: myTeamName = "" } = readStoredTeam();
  const myTeamId = rosterId;
  const [teams, setTeams] = useState<{ id: string; name: string }[]>(() => {
    const me = { id: myTeamId, name: myTeamName || `Team ${myTeamId}` };
    return [me, ...initialTeams.filter(t => t.id !== myTeamId)];
  });
  const [dealAssets, setDealAssets] = useState<DealAsset[]>(() =>
    initialCart.map(c => ({ key: c.key, name: c.name, fromTeamId: c.teamId, toTeamId: myTeamId, fromTeamName: c.teamName, toTeamName: myTeamName || `Team ${myTeamId}` }))
  );
  const [activeTab, setActiveTab] = useState(myTeamId);
  const [rosters, setRosters] = useState<Record<string, RosterPlayer[]>>({});
  const [profiles, setProfiles] = useState<Record<string, StratProfile>>({});
  const [loading, setLoading] = useState(true);
  const [routingPopup, setRoutingPopup] = useState<{ key: string; name: string; meta: string; fromTeamId: string } | null>(null);
  const [advisorProse, setAdvisorProse] = useState("Add assets to both sides to get my take on this deal.");
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const advisorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const threeTeam = teams.length > 2;
  const dealKeys = useMemo(() => new Set(dealAssets.map(a => a.key)), [dealAssets]);
  const otherTeams = useMemo(() => teams.filter(t => t.id !== myTeamId), [teams, myTeamId]);
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  useEffect(() => {
    if (!myTeamId) return;
    fetch(`/api/trades/targets?teamId=${encodeURIComponent(myTeamId)}`)
      .then(r => r.json())
      .then(j => {
        const raw = j.rosters ?? {};
        const r: Record<string, RosterPlayer[]> = {};
        for (const rid of Object.keys(raw)) {
          r[rid] = (raw[rid] ?? []).map((p: RosterPlayer) => ({ ...p, tier: p.tier === "core_piece" ? "core" : (p.tier || "core") }));
        }
        setRosters(r);
        setProfiles(j.profiles ?? {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [myTeamId]);

  // Compute team-adjusted values for gap calculation
  const computeGap = useCallback(() => {
    const mySends = dealAssets.filter(a => a.fromTeamId === myTeamId);
    const myReceives = dealAssets.filter(a => a.toTeamId === myTeamId);
    const myProfile = profiles[myTeamId] ?? null;
    let sendVal = 0;
    for (const a of mySends) {
      const p = (rosters[myTeamId] ?? []).find(r => r.key === a.key);
      if (p) sendVal += adjustedValue(p.value, p.position, myProfile);
    }
    let recvVal = 0;
    for (const a of myReceives) {
      const fromRoster = rosters[a.fromTeamId] ?? [];
      const fromProfile = profiles[a.fromTeamId] ?? null;
      const p = fromRoster.find(r => r.key === a.key);
      if (p) recvVal += adjustedValue(p.value, p.position, fromProfile);
    }
    return { sendVal, recvVal };
  }, [dealAssets, rosters, profiles, myTeamId]);

  // Client-side grade + suggestions
  const gradeData = useMemo(() => {
    const { sendVal, recvVal } = computeGap();
    const hasSend = dealAssets.some(a => a.fromTeamId === myTeamId);
    const hasRecv = dealAssets.some(a => a.toTeamId === myTeamId);
    if (!hasSend && !hasRecv) return { grade: "", gradeColor: "#8C7E6A", suggestions: [] as AdvisorSuggestion[] };

    const gap = recvVal - sendVal;
    const ratio = sendVal > 0 ? recvVal / sendVal : 0;
    let grade = ""; let gradeColor = "#8C7E6A";

    if (hasSend && hasRecv) {
      if (ratio > 1.2 || ratio < 0.8) { grade = ratio > 1 ? "Great deal for you" : "Way off"; gradeColor = "#E8503A"; }
      else if (ratio > 1.1 || ratio < 0.9) { grade = ratio > 1 ? "You're ahead" : "You're reaching"; gradeColor = "#F5C230"; }
      else { grade = "In the range"; gradeColor = "#4CAF50"; }
    } else if (hasRecv) { grade = "Add your pieces"; gradeColor = "#F5C230"; }
    else { grade = "Pick your targets"; gradeColor = "#F5C230"; }

    // Find gap-closing suggestions
    const suggestions: AdvisorSuggestion[] = [];
    const otherTeam = otherTeams[0];
    const otherProfile = otherTeam ? (profiles[otherTeam.id] ?? null) : null;
    const otherWants = new Set(otherProfile?.wants_more ?? []);
    const otherNeeds: string[] = [];
    if (otherProfile) {
      if (otherProfile.qb_market === "buy") otherNeeds.push("QB");
      if (otherProfile.rb_market === "buy") otherNeeds.push("RB");
      if (otherProfile.wr_market === "buy") otherNeeds.push("WR");
      if (otherProfile.te_market === "buy") otherNeeds.push("TE");
    }

    if (hasSend && hasRecv && ratio < 0.95 && sendVal > 0) {
      // I need to add more to my send side — find assets that close the gap
      const needed = recvVal - sendVal; // positive = I need to add this much
      const myProfile = profiles[myTeamId] ?? null;
      const available = (rosters[myTeamId] ?? [])
        .filter(p => !dealKeys.has(p.key) && p.value > 0 && p.tier !== "untouchable")
        .map(p => ({ ...p, adjVal: adjustedValue(p.value, p.position, myProfile), fitsTheirNeeds: otherNeeds.includes(p.position) || (otherWants.has("draft_picks") && p.type === "pick") || (otherWants.has("young_upside") && p.meta.includes("2")) }))
        .sort((a, b) => (b.fitsTheirNeeds ? 1 : 0) - (a.fitsTheirNeeds ? 1 : 0) || Math.abs(a.adjVal - needed) - Math.abs(b.adjVal - needed));
      // Find single assets within 80-120% of gap
      const singles = available.filter(p => p.adjVal >= needed * 0.8 && p.adjVal <= needed * 1.2);
      for (const p of singles.slice(0, 2)) {
        suggestions.push({ key: p.key, name: p.name, meta: `${p.meta} · Your roster` });
      }
      // If no singles, find 2-asset combos
      if (suggestions.length === 0) {
        for (let i = 0; i < Math.min(available.length, 6); i++) {
          for (let j = i + 1; j < Math.min(available.length, 6); j++) {
            const combo = available[i].adjVal + available[j].adjVal;
            if (combo >= needed * 0.8 && combo <= needed * 1.2) {
              suggestions.push({ key: available[i].key, name: `${available[i].name} + ${available[j].name}`, meta: "Combo · Your roster" });
              break;
            }
          }
          if (suggestions.length > 0) break;
        }
      }
    } else if (hasRecv && !hasSend) {
      // Only receive side — suggest what to send
      const myProfile = profiles[myTeamId] ?? null;
      const available = (rosters[myTeamId] ?? [])
        .filter(p => !dealKeys.has(p.key) && p.value > 0 && p.tier !== "untouchable")
        .map(p => ({ ...p, adjVal: adjustedValue(p.value, p.position, myProfile), fitsTheirNeeds: otherNeeds.includes(p.position) || (otherWants.has("draft_picks") && p.type === "pick") }))
        .sort((a, b) => (b.fitsTheirNeeds ? 1 : 0) - (a.fitsTheirNeeds ? 1 : 0) || b.adjVal - a.adjVal);
      // Find assets that would roughly match the receive value
      const target = recvVal;
      const singles = available.filter(p => p.adjVal >= target * 0.7 && p.adjVal <= target * 1.3);
      for (const p of singles.slice(0, 3)) {
        suggestions.push({ key: p.key, name: p.name, meta: `${p.meta} · Your roster` });
      }
    } else if (hasSend && !hasRecv && otherTeam) {
      // Only send side — suggest what to receive
      const otherRoster = rosters[otherTeam.id] ?? [];
      const available = otherRoster.filter(p => !dealKeys.has(p.key) && p.value > 0).sort((a, b) => b.value - a.value);
      const target = sendVal;
      const singles = available.filter(p => p.value >= target * 0.7 && p.value <= target * 1.3);
      for (const p of singles.slice(0, 3)) {
        suggestions.push({ key: p.key, name: p.name, meta: `${p.meta} · Their roster` });
      }
    }

    if (suggestions.length > 0 && hasSend && hasRecv && ratio < 0.95) {
      // Don't need to append text - the AI prose will handle it
    }
    return { grade, gradeColor, suggestions };
  }, [computeGap, dealAssets, rosters, profiles, myTeamId, otherTeams, dealKeys]);

  // Async Anthropic prose
  useEffect(() => {
    if (advisorTimer.current) clearTimeout(advisorTimer.current);
    const hasBoth = dealAssets.some(a => a.fromTeamId === myTeamId) && dealAssets.some(a => a.toTeamId === myTeamId);
    const hasAny = dealAssets.length > 0;
    if (!hasAny) { setAdvisorProse("Add players or picks to both sides to get my take on this deal."); return; }
    if (!hasBoth) { setAdvisorProse("Add assets to the other side to see how this deal stacks up."); }
    setAdvisorLoading(true);
    advisorTimer.current = setTimeout(async () => {
      const { sendVal, recvVal } = computeGap();
      try {
        const res = await fetch("/api/trades/advisor", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ my_team_id: myTeamId, other_team_ids: otherTeams.map(t => t.id), deal_assets: dealAssets, my_sends_value: sendVal, my_receives_value: recvVal }),
        });
        if (res.ok) { const j = await res.json(); if (j.prose) setAdvisorProse(j.prose); }
      } catch { /* keep existing prose */ }
      finally { setAdvisorLoading(false); }
    }, 2000);
    return () => { if (advisorTimer.current) clearTimeout(advisorTimer.current); };
  }, [dealAssets, myTeamId, otherTeams, computeGap]);

  const removeDealAsset = useCallback((key: string) => { setDealAssets(prev => prev.filter(a => a.key !== key)); }, []);
  const addDealAsset = useCallback((key: string, name: string, fromTeamId: string, toTeamId: string) => {
    const from = teams.find(t => t.id === fromTeamId);
    const to = teams.find(t => t.id === toTeamId);
    setDealAssets(prev => prev.some(a => a.key === key) ? prev : [...prev, { key, name, fromTeamId, toTeamId, fromTeamName: from?.name ?? fromTeamId, toTeamName: to?.name ?? toTeamId }]);
  }, [teams]);

  const handleRosterTap = useCallback((key: string, name: string) => {
    if (dealKeys.has(key)) { removeDealAsset(key); return; }
    if (threeTeam) { setRoutingPopup({ key, name, meta: "", fromTeamId: activeTab }); return; }
    // 2-team auto-route
    if (activeTab === myTeamId) { const other = otherTeams[0]; if (other) addDealAsset(key, name, myTeamId, other.id); }
    else { addDealAsset(key, name, activeTab, myTeamId); }
  }, [activeTab, threeTeam, myTeamId, otherTeams, dealKeys, addDealAsset, removeDealAsset]);

  const handleRoutingSelect = useCallback((toTeamId: string) => {
    if (!routingPopup) return;
    addDealAsset(routingPopup.key, routingPopup.name, routingPopup.fromTeamId, toTeamId);
    setRoutingPopup(null);
  }, [routingPopup, addDealAsset]);

  const handleAddFromTeam = useCallback((teamId: string) => {
    if (teamId === "__universal__") {
      // 3-team: show routing popup to pick which team's roster
      setRoutingPopup({ key: "__browse__", name: "", meta: "", fromTeamId: "__universal__" });
    } else {
      setActiveTab(teamId);
      setRosterSearch("");
    }
  }, []);

  const handleUniversalBrowse = useCallback((teamId: string) => {
    setRoutingPopup(null);
    setActiveTab(teamId);
    setRosterSearch("");
  }, []);

  const handleSuggestionTap = useCallback((key: string) => {
    const suggestion = gradeData.suggestions.find(s => s.key === key);
    if (!suggestion) return;
    const isMyRoster = suggestion.meta.includes("Your roster");
    if (isMyRoster) { const other = otherTeams[0]; if (other) addDealAsset(key, suggestion.name.split(" + ")[0], myTeamId, other.id); }
    else { addDealAsset(key, suggestion.name, otherTeams[0]?.id ?? "", myTeamId); }
  }, [gradeData.suggestions, otherTeams, myTeamId, addDealAsset]);

  const handleSendOffer = useCallback(async () => {
    if (sending) return;
    const mySends = dealAssets.filter(a => a.fromTeamId === myTeamId);
    const myReceives = dealAssets.filter(a => a.toTeamId === myTeamId);
    if (mySends.length === 0 || myReceives.length === 0) { flash("Add assets to both sides."); return; }
    setSending(true);
    try {
      const toTeam = otherTeams[0];
      if (!toTeam) return;
      const res = await fetch("/api/trades/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: myTeamId, to_team_id: toTeam.id,
          assets_from: mySends.map(a => ({ key: a.key, label: a.name, type: a.key.startsWith("player:") ? "player" : "pick", value: 0 })),
          assets_to: myReceives.map(a => ({ key: a.key, label: a.name, type: a.key.startsWith("player:") ? "player" : "pick", value: 0 })),
          from_value: 0, to_value: 0, grade_label: gradeData.grade || "Fair",
        }),
      });
      if (res.ok) { flash("Offer sent!"); setTimeout(() => { window.location.href = "/trades"; }, 1000); }
      else { const j = await res.json().catch(() => ({})); flash(j.error || "Failed"); }
    } catch { flash("Failed to send"); }
    finally { setSending(false); }
  }, [sending, dealAssets, myTeamId, otherTeams, gradeData.grade, flash]);

  const activeRoster = useMemo(() => {
    let players = rosters[activeTab] ?? [];
    if (rosterSearch.trim()) { const q = rosterSearch.toLowerCase(); players = players.filter(p => p.name.toLowerCase().includes(q) || p.meta.toLowerCase().includes(q)); }
    return players;
  }, [rosters, activeTab, rosterSearch]);

  const tiers = useMemo(() => {
    const g: Record<string, RosterPlayer[]> = {};
    for (const p of activeRoster) { const t = p.tier === "core_piece" ? "core" : (p.tier || "core"); if (!g[t]) g[t] = []; g[t].push(p); }
    return [{ key: "moveable", label: "Moveable", items: g["moveable"] ?? [] }, { key: "listening", label: "Listening", items: g["listening"] ?? [] }, { key: "core", label: "Core", items: g["core"] ?? [] }, { key: "untouchable", label: "Untouchable", items: g["untouchable"] ?? [] }].filter(t => t.items.length > 0);
  }, [activeRoster]);

  const canSend = dealAssets.some(a => a.fromTeamId === myTeamId) && dealAssets.some(a => a.toTeamId === myTeamId);

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>}
      {/* Header */}
      <div style={{ background: "#F5F0E6", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div onClick={onBack} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer" }}>← Back</div>
          <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
          <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>{teams.map(t => teamNick(t.name)).join(" × ")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Change team</div>
          {teams.length < 3 && <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>+ Add team</div>}
        </div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "58% 42%", minHeight: 0, overflow: "hidden" }}>
        {/* Left: scrollable deal + AI */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: "2px solid #1A1A1A", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
            <DealCard myTeamId={myTeamId} teams={teams} assets={dealAssets} onRemove={removeDealAsset} onAddFromTeam={handleAddFromTeam} threeTeam={threeTeam} />
            <AIAdvisor grade={gradeData.grade} gradeColor={gradeData.gradeColor} prose={advisorProse} suggestions={gradeData.suggestions} onTapSuggestion={handleSuggestionTap} loading={advisorLoading} />
          </div>
          <div style={{ padding: "12px 20px", borderTop: "2px solid #1A1A1A", flexShrink: 0, background: "#F5F0E6" }}>
            <div onClick={canSend ? handleSendOffer : undefined} style={{ background: canSend ? "#E8503A" : "#C8C3B8", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: canSend ? "3px 3px 0 #1A1A1A" : "none", padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 14, cursor: canSend ? "pointer" : "not-allowed", textTransform: "uppercase", letterSpacing: "0.04em", opacity: canSend ? 1 : 0.5 }}>{sending ? "Sending…" : "Send offer"}</div>
          </div>
        </div>
        {/* Right: roster */}
        <div style={{ display: "flex", flexDirection: "column", background: "#FEFCF9", overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "2.5px solid #1A1A1A", flexShrink: 0 }}>
            {teams.map((t, i) => <div key={t.id} onClick={() => { setActiveTab(t.id); setRosterSearch(""); }} style={{ flex: 1, padding: "10px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: teams.length > 2 ? 10 : 11, textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer", background: activeTab === t.id ? "#1A1A1A" : "#FEFCF9", color: activeTab === t.id ? "#FEFCF9" : "#8C7E6A", borderRight: i < teams.length - 1 ? "1px solid " + (activeTab === t.id ? "#FEFCF9" : "#C8C3B8") : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{teamNick(t.name)}</div>)}
          </div>
          <div style={{ padding: "8px 14px", borderBottom: "1.5px solid #C8C3B8", flexShrink: 0 }}>
            <input type="text" placeholder={`Search ${teamNick(teams.find(t => t.id === activeTab)?.name ?? "")} roster…`} value={rosterSearch} onChange={e => setRosterSearch(e.target.value)} style={{ width: "100%", border: "2px solid #1A1A1A", padding: "6px 10px", fontSize: 11, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px", minHeight: 0 }}>
            {loading ? <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>Loading roster…</div>
            : tiers.length === 0 ? <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>No players found.</div>
            : tiers.map(tier => <div key={tier.key}><TierDivider label={tier.label} />{tier.items.map(p => <PlayerRow key={p.key} name={p.name} meta={p.meta} selected={dealKeys.has(p.key)} onToggle={() => handleRosterTap(p.key, p.name)} />)}</div>)}
            <div style={{ height: 12 }} />
          </div>
        </div>
      </div>
      {/* Routing popup */}
      {routingPopup && routingPopup.key === "__browse__" ? (
        <RoutingPopup teams={teams} onSelect={handleUniversalBrowse} onClose={() => setRoutingPopup(null)} />
      ) : routingPopup ? (
        <RoutingPopup teams={teams.filter(t => t.id !== routingPopup.fromTeamId)} onSelect={handleRoutingSelect} onClose={() => setRoutingPopup(null)} />
      ) : null}
    </div>
  );
}
