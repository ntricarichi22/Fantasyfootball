"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "../../lib/storedTeam";
import DealCard, { type DealAsset } from "./DealCard";
import AIAdvisor, { type AdvisorSuggestion } from "./AIAdvisor";
import PlayerRow, { AVAILABILITY_CHIPS } from "./PlayerRow";
import TierDivider from "./TierDivider";
import RoutingPopup from "./RoutingPopup";
import type { CartItem } from "./CartSidebar";

type Props = { initialCart: CartItem[]; initialTeams: { id: string; name: string }[]; onBack: () => void };
type RosterPlayer = { key: string; name: string; meta: string; rosterMeta: string; tier: string; value: number; position: string; posGroup: string; type: "player" | "pick"; fitScore: number };
type StratProfile = { team_id: string; wants_more: string[]; qb_market: string; rb_market: string; wr_market: string; te_market: string };

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

const POS_SECTIONS = [
  { key: "QB", label: "Quarterbacks" },
  { key: "RB", label: "Running Backs" },
  { key: "PASS", label: "Pass Catchers" },
  { key: "PICK", label: "Draft Picks" },
];

function adjustedValue(base: number, pos: string, p: StratProfile | null): number {
  if (!p) return base;
  const m = pos === "QB" ? p.qb_market : pos === "RB" ? p.rb_market : pos === "WR" || pos === "TE" ? p.wr_market : "hold";
  return Math.round(base * (m === "buy" ? 1.25 : m === "sell" ? 0.8 : 1));
}

function teamNick(name: string): string { const p = name.split(" "); return p.length > 1 ? p.slice(1).join(" ") : name; }

export default function TradeBuilder({ initialCart, initialTeams, onBack }: Props) {
  const { rosterId = "", teamName: myTeamName = "" } = readStoredTeam();
  const myTeamId = rosterId;
  const [teams, setTeams] = useState(() => {
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
  const [routingPopup, setRoutingPopup] = useState<{ key: string; name: string; fromTeamId: string } | null>(null);
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
          r[rid] = (raw[rid] ?? []).map((p: RosterPlayer) => ({ ...p, tier: p.tier === "core_piece" ? "core" : (p.tier || "core"), rosterMeta: p.rosterMeta ?? p.meta }));
        }
        setRosters(r); setProfiles(j.profiles ?? {});
      })
      .catch(() => {}).finally(() => setLoading(false));
  }, [myTeamId]);

  const computeGap = useCallback(() => {
    const mySends = dealAssets.filter(a => a.fromTeamId === myTeamId);
    const myRecvs = dealAssets.filter(a => a.toTeamId === myTeamId);
    const myP = profiles[myTeamId] ?? null;
    let sv = 0;
    for (const a of mySends) { const p = (rosters[myTeamId] ?? []).find(r => r.key === a.key); if (p) sv += adjustedValue(p.value, p.position, myP); }
    let rv = 0;
    for (const a of myRecvs) { const fr = rosters[a.fromTeamId] ?? []; const fp = profiles[a.fromTeamId] ?? null; const p = fr.find(r => r.key === a.key); if (p) rv += adjustedValue(p.value, p.position, fp); }
    return { sv, rv };
  }, [dealAssets, rosters, profiles, myTeamId]);

  const gradeData = useMemo(() => {
    const { sv, rv } = computeGap();
    const hasSend = dealAssets.some(a => a.fromTeamId === myTeamId);
    const hasRecv = dealAssets.some(a => a.toTeamId === myTeamId);
    if (!hasSend && !hasRecv) return { grade: "", gradeColor: "#8C7E6A", suggestions: [] as AdvisorSuggestion[] };
    const ratio = sv > 0 ? rv / sv : 0;
    let grade = ""; let gradeColor = "#8C7E6A";
    if (hasSend && hasRecv) {
      if (ratio > 1.2 || ratio < 0.8) { grade = ratio > 1 ? "Great deal for you" : "Way off"; gradeColor = "#E8503A"; }
      else if (ratio > 1.1 || ratio < 0.9) { grade = ratio > 1 ? "You're ahead" : "You're reaching"; gradeColor = "#F5C230"; }
      else { grade = "In the range"; gradeColor = "#4CAF50"; }
    } else if (hasRecv) { grade = "Add your pieces"; gradeColor = "#F5C230"; }
    else { grade = "Pick your targets"; gradeColor = "#F5C230"; }

    const suggestions: AdvisorSuggestion[] = [];
    const myP = profiles[myTeamId] ?? null;
    const otherTeam = otherTeams[0];
    const otherP = otherTeam ? (profiles[otherTeam.id] ?? null) : null;
    const otherBuying: string[] = [];
    if (otherP) { if (otherP.qb_market === "buy") otherBuying.push("QB"); if (otherP.rb_market === "buy") otherBuying.push("RB"); if (otherP.wr_market === "buy") otherBuying.push("WR"); if (otherP.te_market === "buy") otherBuying.push("TE"); }
    const otherWants = new Set(otherP?.wants_more ?? []);
    const mySelling: string[] = [];
    if (myP) { if (myP.qb_market === "sell") mySelling.push("QB"); if (myP.rb_market === "sell") mySelling.push("RB"); if (myP.wr_market === "sell") mySelling.push("WR"); if (myP.te_market === "sell") mySelling.push("TE"); }
    const myWants = new Set(myP?.wants_more ?? []);

    const filterMyAsset = (p: RosterPlayer): boolean => {
      if (dealKeys.has(p.key) || p.tier === "untouchable" || p.value <= 0) return false;
      if (myWants.has("draft_picks") && p.type === "pick") return false;
      const pm = p.position === "QB" ? myP?.qb_market : p.position === "RB" ? myP?.rb_market : p.position === "WR" || p.position === "TE" ? myP?.wr_market : "hold";
      return pm !== "buy";
    };
    const scoreMyAsset = (p: RosterPlayer): number => {
      let s = 0;
      if (mySelling.includes(p.position)) s += 50;
      if (otherBuying.includes(p.position)) s += 30;
      if (otherWants.has("draft_picks") && p.type === "pick") s += 20;
      if (otherWants.has("elite_producers") && p.value >= 6000) s += 15;
      if (otherWants.has("young_upside") && p.meta.includes("2")) s += 10;
      return s;
    };

    const needsSuggestions = (hasSend && hasRecv && (ratio < 0.95 || ratio > 1.05)) || (hasRecv && !hasSend) || (hasSend && !hasRecv);
    if (needsSuggestions) {
      if (hasSend && hasRecv && ratio < 0.95) {
        const needed = rv - sv;
        const avail = (rosters[myTeamId] ?? []).filter(filterMyAsset).map(p => ({ ...p, adjVal: adjustedValue(p.value, p.position, myP), fit: scoreMyAsset(p) })).sort((a, b) => b.fit - a.fit || Math.abs(a.adjVal - needed) - Math.abs(b.adjVal - needed));
        const singles = avail.filter(p => p.adjVal >= needed * 0.7 && p.adjVal <= needed * 1.3);
        for (const p of singles.slice(0, 3)) suggestions.push({ key: p.key, name: p.name, meta: `${p.rosterMeta} · Your roster` });
        if (!suggestions.length) { for (let i = 0; i < Math.min(avail.length, 8); i++) for (let j = i + 1; j < Math.min(avail.length, 8); j++) { if (avail[i].adjVal + avail[j].adjVal >= needed * 0.7 && avail[i].adjVal + avail[j].adjVal <= needed * 1.3) { suggestions.push({ key: avail[i].key, name: `${avail[i].name} + ${avail[j].name}`, meta: "Combo · Your roster" }); break; } if (suggestions.length) break; } }
        if (!suggestions.length) for (const p of avail.slice(0, 3)) suggestions.push({ key: p.key, name: p.name, meta: `${p.rosterMeta} · Your roster` });
      } else if (hasSend && hasRecv && ratio > 1.05) {
        const surplus = sv - rv;
        const avail = (rosters[otherTeam?.id ?? ""] ?? []).filter(p => !dealKeys.has(p.key) && p.value > 0).sort((a, b) => Math.abs(a.value - surplus) - Math.abs(b.value - surplus));
        for (const p of avail.filter(p => p.value >= surplus * 0.5 && p.value <= surplus * 1.5).slice(0, 3)) suggestions.push({ key: p.key, name: p.name, meta: `${p.rosterMeta} · Their roster` });
      } else if (hasRecv && !hasSend) {
        const avail = (rosters[myTeamId] ?? []).filter(filterMyAsset).map(p => ({ ...p, adjVal: adjustedValue(p.value, p.position, myP), fit: scoreMyAsset(p) })).sort((a, b) => b.fit - a.fit || b.adjVal - a.adjVal);
        const singles = avail.filter(p => p.adjVal >= rv * 0.7 && p.adjVal <= rv * 1.3);
        for (const p of (singles.length ? singles : avail).slice(0, 3)) suggestions.push({ key: p.key, name: p.name, meta: `${p.rosterMeta} · Your roster` });
      } else if (hasSend && !hasRecv && otherTeam) {
        const avail = (rosters[otherTeam.id] ?? []).filter(p => !dealKeys.has(p.key) && p.value > 0).sort((a, b) => b.value - a.value);
        for (const p of avail.filter(p => p.value >= sv * 0.7 && p.value <= sv * 1.3).slice(0, 3)) suggestions.push({ key: p.key, name: p.name, meta: `${p.rosterMeta} · Their roster` });
      }
    }
    return { grade, gradeColor, suggestions };
  }, [computeGap, dealAssets, rosters, profiles, myTeamId, otherTeams, dealKeys]);

  useEffect(() => {
    if (advisorTimer.current) clearTimeout(advisorTimer.current);
    if (!dealAssets.length) { setAdvisorProse("Add players or picks to both sides to get my take."); return; }
    setAdvisorLoading(true);
    advisorTimer.current = setTimeout(async () => {
      const { sv, rv } = computeGap();
      const myRoster = (rosters[myTeamId] ?? []).map(p => ({ name: p.name, position: p.position, value: p.value, tier: p.tier }));
      const otherRosters: Record<string, { name: string; position: string; value: number; tier: string }[]> = {};
      for (const t of otherTeams) otherRosters[t.id] = (rosters[t.id] ?? []).map(p => ({ name: p.name, position: p.position, value: p.value, tier: p.tier }));
      try {
        const res = await fetch("/api/trades/advisor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ my_team_id: myTeamId, other_team_ids: otherTeams.map(t => t.id), deal_assets: dealAssets, my_sends_value: sv, my_receives_value: rv, my_roster: myRoster, other_rosters: otherRosters }) });
        if (res.ok) { const j = await res.json(); if (j.prose) setAdvisorProse(j.prose); }
      } catch {} finally { setAdvisorLoading(false); }
    }, 2000);
    return () => { if (advisorTimer.current) clearTimeout(advisorTimer.current); };
  }, [dealAssets, myTeamId, otherTeams, computeGap, rosters]);

  const removeDealAsset = useCallback((key: string) => { setDealAssets(prev => prev.filter(a => a.key !== key)); }, []);
  const addDealAsset = useCallback((key: string, name: string, fromTeamId: string, toTeamId: string) => {
    const from = teams.find(t => t.id === fromTeamId); const to = teams.find(t => t.id === toTeamId);
    setDealAssets(prev => prev.some(a => a.key === key) ? prev : [...prev, { key, name, fromTeamId, toTeamId, fromTeamName: from?.name ?? fromTeamId, toTeamName: to?.name ?? toTeamId }]);
  }, [teams]);
  const handleRosterTap = useCallback((key: string, name: string) => {
    if (dealKeys.has(key)) { removeDealAsset(key); return; }
    if (threeTeam) { setRoutingPopup({ key, name, fromTeamId: activeTab }); return; }
    if (activeTab === myTeamId) { const o = otherTeams[0]; if (o) addDealAsset(key, name, myTeamId, o.id); }
    else addDealAsset(key, name, activeTab, myTeamId);
  }, [activeTab, threeTeam, myTeamId, otherTeams, dealKeys, addDealAsset, removeDealAsset]);
  const handleRoutingSelect = useCallback((toTeamId: string) => { if (!routingPopup) return; addDealAsset(routingPopup.key, routingPopup.name, routingPopup.fromTeamId, toTeamId); setRoutingPopup(null); }, [routingPopup, addDealAsset]);
  const handleAddFromTeam = useCallback((teamId: string) => { if (teamId === "__universal__") setRoutingPopup({ key: "__browse__", name: "", fromTeamId: "__universal__" }); else { setActiveTab(teamId); setRosterSearch(""); } }, []);
  const handleUniversalBrowse = useCallback((teamId: string) => { setRoutingPopup(null); setActiveTab(teamId); setRosterSearch(""); }, []);
  const handleSuggestionTap = useCallback((key: string) => {
    const s = gradeData.suggestions.find(x => x.key === key); if (!s) return;
    if (s.meta.includes("Your roster")) { const o = otherTeams[0]; if (o) addDealAsset(key, s.name.split(" + ")[0], myTeamId, o.id); }
    else addDealAsset(key, s.name, otherTeams[0]?.id ?? "", myTeamId);
  }, [gradeData.suggestions, otherTeams, myTeamId, addDealAsset]);
  const handleSendOffer = useCallback(async () => {
    if (sending) return;
    const ms = dealAssets.filter(a => a.fromTeamId === myTeamId); const mr = dealAssets.filter(a => a.toTeamId === myTeamId);
    if (!ms.length || !mr.length) { flash("Add assets to both sides."); return; }
    setSending(true);
    try {
      const to = otherTeams[0]; if (!to) return;
      const res = await fetch("/api/trades/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_team_id: myTeamId, to_team_id: to.id, assets_from: ms.map(a => ({ key: a.key, label: a.name, type: a.key.startsWith("player:") ? "player" : "pick", value: 0 })), assets_to: mr.map(a => ({ key: a.key, label: a.name, type: a.key.startsWith("player:") ? "player" : "pick", value: 0 })), from_value: 0, to_value: 0, grade_label: gradeData.grade || "Fair" }) });
      if (res.ok) { flash("Offer sent!"); setTimeout(() => { window.location.href = "/trades"; }, 1000); }
      else { const j = await res.json().catch(() => ({})); flash(j.error || "Failed"); }
    } catch { flash("Failed"); } finally { setSending(false); }
  }, [sending, dealAssets, myTeamId, otherTeams, gradeData.grade, flash]);

  const activeRoster = useMemo(() => {
    let players = rosters[activeTab] ?? [];
    if (rosterSearch.trim()) { const q = rosterSearch.toLowerCase(); players = players.filter(p => p.name.toLowerCase().includes(q) || p.meta.toLowerCase().includes(q) || p.rosterMeta.toLowerCase().includes(q)); }
    return players;
  }, [rosters, activeTab, rosterSearch]);

  const posSections = useMemo(() => POS_SECTIONS.map(sec => ({ ...sec, items: activeRoster.filter(p => (p.posGroup ?? "OTHER") === sec.key).sort((a, b) => b.value - a.value) })).filter(s => s.items.length > 0), [activeRoster]);

  const canSend = dealAssets.some(a => a.fromTeamId === myTeamId) && dealAssets.some(a => a.toTeamId === myTeamId);
  const tabFontSize = teams.length > 2 ? Math.min(11, Math.floor(90 / Math.max(...teams.map(t => teamNick(t.name).length), 1))) : 11;

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>}
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
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "58% 42%", minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", borderRight: "2px solid #1A1A1A", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0 }}>
            <DealCard myTeamId={myTeamId} teams={teams} assets={dealAssets} onRemove={removeDealAsset} onAddFromTeam={handleAddFromTeam} threeTeam={threeTeam} />
            <AIAdvisor grade={gradeData.grade} gradeColor={gradeData.gradeColor} prose={advisorProse} suggestions={gradeData.suggestions} onTapSuggestion={handleSuggestionTap} loading={advisorLoading} />
          </div>
          <div style={{ padding: "12px 20px", borderTop: "2px solid #1A1A1A", flexShrink: 0, background: "#F5F0E6" }}>
            <div onClick={canSend ? handleSendOffer : undefined} style={{ background: canSend ? "#E8503A" : "#C8C3B8", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: canSend ? "3px 3px 0 #1A1A1A" : "none", padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 14, cursor: canSend ? "pointer" : "not-allowed", textTransform: "uppercase", letterSpacing: "0.04em", opacity: canSend ? 1 : 0.5 }}>{sending ? "Sending…" : "Send offer"}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", background: "#FEFCF9", overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "2.5px solid #1A1A1A", flexShrink: 0 }}>
            {teams.map((t, i) => <div key={t.id} onClick={() => { setActiveTab(t.id); setRosterSearch(""); }} style={{ flex: 1, padding: "10px 4px", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: tabFontSize, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", background: activeTab === t.id ? "#1A1A1A" : "#FEFCF9", color: activeTab === t.id ? "#FEFCF9" : "#8C7E6A", borderRight: i < teams.length - 1 ? "1px solid " + (activeTab === t.id ? "#FEFCF9" : "#C8C3B8") : "none" }}>{teamNick(t.name)}</div>)}
          </div>
          <div style={{ padding: "8px 14px", borderBottom: "1.5px solid #C8C3B8", flexShrink: 0 }}>
            <input type="text" placeholder={`Search ${teamNick(teams.find(t => t.id === activeTab)?.name ?? "")} roster…`} value={rosterSearch} onChange={e => setRosterSearch(e.target.value)} style={{ width: "100%", border: "2px solid #1A1A1A", padding: "6px 10px", fontSize: 11, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px", minHeight: 0 }}>
            {loading ? <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>Loading roster…</div>
            : posSections.length === 0 ? <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>No players found.</div>
            : posSections.map(sec => <div key={sec.key}><TierDivider label={sec.label} />{sec.items.map(p => <PlayerRow key={p.key} name={p.name} meta={p.rosterMeta} selected={dealKeys.has(p.key)} onToggle={() => handleRosterTap(p.key, p.name)} chip={AVAILABILITY_CHIPS[p.tier]} />)}</div>)}
            <div style={{ height: 12 }} />
          </div>
        </div>
      </div>
      {routingPopup && routingPopup.key === "__browse__" ? <RoutingPopup teams={teams} onSelect={handleUniversalBrowse} onClose={() => setRoutingPopup(null)} />
      : routingPopup ? <RoutingPopup teams={teams.filter(t => t.id !== routingPopup.fromTeamId)} onSelect={handleRoutingSelect} onClose={() => setRoutingPopup(null)} /> : null}
    </div>
  );
}
