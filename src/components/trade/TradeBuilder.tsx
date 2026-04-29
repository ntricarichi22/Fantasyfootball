"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "../../lib/storedTeam";
import DealCard, { type DealAsset } from "./DealCard";
import AIAdvisor, { type AdvisorSuggestion } from "./AIAdvisor";
import PlayerRow from "./PlayerRow";
import TierDivider from "./TierDivider";
import RoutingPopup from "./RoutingPopup";
import type { CartItem } from "./CartSidebar";

type Props = {
  initialCart: CartItem[];
  initialTeams: { id: string; name: string }[];
  onBack: () => void;
};

type RosterPlayer = { key: string; name: string; meta: string; tier: string; value: number };

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

export default function TradeBuilder({ initialCart, initialTeams, onBack }: Props) {
  const { rosterId = "", teamName: myTeamName = "" } = readStoredTeam();
  const myTeamId = rosterId;

  const [teams, setTeams] = useState<{ id: string; name: string }[]>(() => {
    const me = { id: myTeamId, name: myTeamName || `Team ${myTeamId}` };
    const others = initialTeams.filter((t) => t.id !== myTeamId);
    return [me, ...others];
  });

  const [dealAssets, setDealAssets] = useState<DealAsset[]>(() =>
    initialCart.map((c) => ({
      key: c.key, name: c.name,
      fromTeamId: c.teamId, toTeamId: myTeamId,
      fromTeamName: c.teamName, toTeamName: myTeamName || `Team ${myTeamId}`,
    }))
  );

  const [activeTab, setActiveTab] = useState(myTeamId);
  const [rosters, setRosters] = useState<Record<string, RosterPlayer[]>>({});
  const [loading, setLoading] = useState(true);
  const [routingPopup, setRoutingPopup] = useState<{ key: string; name: string; fromTeamId: string } | null>(null);
  const [advisorData, setAdvisorData] = useState({ grade: "", gradeColor: "#8C7E6A", prose: "Add assets from both sides to see the AI's take.", suggestions: [] as AdvisorSuggestion[] });
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");

  const threeTeam = teams.length > 2;
  const dealKeys = useMemo(() => new Set(dealAssets.map((a) => a.key)), [dealAssets]);
  const otherTeams = useMemo(() => teams.filter((t) => t.id !== myTeamId), [teams, myTeamId]);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // Fetch roster data for all teams in the trade
  useEffect(() => {
    if (!myTeamId) return;
    fetch(`/api/trades/targets?teamId=${encodeURIComponent(myTeamId)}`)
      .then((r) => r.json())
      .then((j) => {
        const apiRosters: Record<string, RosterPlayer[]> = {};
        const allRosters = j.rosters ?? {};
        for (const rid of Object.keys(allRosters)) {
          apiRosters[rid] = (allRosters[rid] ?? []).map((p: RosterPlayer) => ({
            key: p.key,
            name: p.name,
            meta: p.meta,
            tier: p.tier === "core_piece" ? "core" : p.tier,
            value: p.value ?? 0,
          }));
        }
        setRosters(apiRosters);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [myTeamId]);

  const removeDealAsset = useCallback((key: string) => {
    setDealAssets((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const addDealAsset = useCallback((key: string, name: string, fromTeamId: string, toTeamId: string) => {
    const fromTeam = teams.find((t) => t.id === fromTeamId);
    const toTeam = teams.find((t) => t.id === toTeamId);
    setDealAssets((prev) => {
      if (prev.some((a) => a.key === key)) return prev;
      return [...prev, {
        key, name,
        fromTeamId, toTeamId,
        fromTeamName: fromTeam?.name ?? fromTeamId,
        toTeamName: toTeam?.name ?? toTeamId,
      }];
    });
  }, [teams]);

  const handleRosterTap = useCallback((key: string, name: string) => {
    if (dealKeys.has(key)) { removeDealAsset(key); return; }

    const fromTeamId = activeTab;

    if (threeTeam) {
      // 3-team: always show routing popup
      setRoutingPopup({ key, name, fromTeamId });
    } else {
      // 2-team: auto-route
      if (fromTeamId === myTeamId) {
        // Tapping my player → "You send" (from me to them)
        const other = otherTeams[0];
        if (other) addDealAsset(key, name, myTeamId, other.id);
      } else {
        // Tapping their player → "You receive" (from them to me)
        addDealAsset(key, name, fromTeamId, myTeamId);
      }
    }
  }, [activeTab, threeTeam, myTeamId, otherTeams, dealKeys, addDealAsset, removeDealAsset]);

  const handleRoutingSelect = useCallback((toTeamId: string) => {
    if (!routingPopup) return;
    addDealAsset(routingPopup.key, routingPopup.name, routingPopup.fromTeamId, toTeamId);
    setRoutingPopup(null);
  }, [routingPopup, addDealAsset]);

  const handleAddClick = useCallback(() => {
    if (otherTeams.length > 0) setActiveTab(otherTeams[0].id);
  }, [otherTeams]);

  const handleSendOffer = useCallback(async () => {
    if (sending || dealAssets.length < 2) return;
    setSending(true);
    try {
      const mySends = dealAssets.filter((a) => a.fromTeamId === myTeamId);
      const myReceives = dealAssets.filter((a) => a.toTeamId === myTeamId);
      const toTeam = otherTeams[0];
      if (!toTeam || mySends.length === 0 || myReceives.length === 0) {
        flash("Add assets to both sides of the deal.");
        setSending(false);
        return;
      }
      const res = await fetch("/api/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: myTeamId,
          to_team_id: toTeam.id,
          assets_from: mySends.map((a) => ({ key: a.key, label: a.name, type: a.key.startsWith("player:") ? "player" : "pick", value: 0 })),
          assets_to: myReceives.map((a) => ({ key: a.key, label: a.name, type: a.key.startsWith("player:") ? "player" : "pick", value: 0 })),
          from_value: 0,
          to_value: 0,
          grade_label: advisorData.grade || "Fair",
        }),
      });
      if (res.ok) {
        flash("Offer sent!");
        setTimeout(() => { window.location.href = "/trades"; }, 1000);
      } else {
        const j = await res.json().catch(() => ({}));
        flash(j.error || "Failed to send");
      }
    } catch { flash("Failed to send"); }
    finally { setSending(false); }
  }, [sending, dealAssets, myTeamId, otherTeams, advisorData.grade, flash]);

  // AI advisor updates
  useEffect(() => {
    const hasBothSides = dealAssets.some((a) => a.fromTeamId === myTeamId) && dealAssets.some((a) => a.toTeamId === myTeamId);
    if (!hasBothSides) {
      setAdvisorData({ grade: "", gradeColor: "#8C7E6A", prose: "Add assets from both sides to see the AI's take on this deal.", suggestions: [] });
      return;
    }
    setAdvisorLoading(true);
    const timer = setTimeout(() => {
      // Deterministic advisor for now - uses deal balance
      const mySends = dealAssets.filter((a) => a.fromTeamId === myTeamId);
      const myReceives = dealAssets.filter((a) => a.toTeamId === myTeamId);
      const myRoster = rosters[myTeamId] ?? [];
      const sendValues = mySends.reduce((s, a) => s + (myRoster.find((p) => p.key === a.key)?.value ?? 0), 0);
      const otherTeamId = otherTeams[0]?.id ?? "";
      const otherRoster = rosters[otherTeamId] ?? [];
      const recvValues = myReceives.reduce((s, a) => s + (otherRoster.find((p) => p.key === a.key)?.value ?? 0), 0);
      const ratio = recvValues / Math.max(sendValues, 1);
      let grade = "In the range";
      let gradeColor = "#4CAF50";
      let prose = "This deal looks balanced. Both sides are getting fair value.";
      if (ratio < 0.85) { grade = "You're overpaying"; gradeColor = "#E8503A"; prose = `You're giving up more value than you're getting back. Consider pulling a piece from your side or asking for more in return.`; }
      else if (ratio < 0.95) { grade = "Slight overpay"; gradeColor = "#F5C230"; prose = `You're paying a small premium. Might be worth it for the right player, but you have room to negotiate.`; }
      else if (ratio > 1.15) { grade = "Great deal for you"; gradeColor = "#4CAF50"; prose = `You're getting more value than you're giving. The other team may push back — consider sweetening slightly to get it done.`; }
      // Suggestions
      const suggestions: AdvisorSuggestion[] = [];
      if (ratio < 0.95) {
        const available = myReceives.length > 0 ? otherRoster.filter((p) => !dealKeys.has(p.key) && p.value > 0).sort((a, b) => a.value - b.value).slice(0, 2) : [];
        for (const p of available) {
          suggestions.push({ key: p.key, name: p.name, meta: `${p.meta} · Their roster` });
        }
      } else if (ratio > 1.1) {
        const available = myRoster.filter((p) => !dealKeys.has(p.key) && p.value > 0 && p.tier !== "untouchable").sort((a, b) => a.value - b.value).slice(0, 2);
        for (const p of available) {
          suggestions.push({ key: p.key, name: p.name, meta: `${p.meta} · Your roster` });
        }
      }
      if (suggestions.length > 0) {
        prose += " If you want to tighten this up, consider these moves:";
      }
      setAdvisorData({ grade, gradeColor, prose, suggestions });
      setAdvisorLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [dealAssets, myTeamId, otherTeams, rosters, dealKeys]);

  // Roster for active tab, organized by tier
  const activeRoster = useMemo(() => {
    let players = rosters[activeTab] ?? [];
    if (rosterSearch.trim()) {
      const q = rosterSearch.toLowerCase();
      players = players.filter((p) => p.name.toLowerCase().includes(q) || p.meta.toLowerCase().includes(q));
    }
    return players;
  }, [rosters, activeTab, rosterSearch]);

  const tiers = useMemo(() => {
    const groups: Record<string, RosterPlayer[]> = {};
    for (const p of activeRoster) {
      const t = p.tier === "core_piece" ? "core" : (p.tier || "core");
      if (!groups[t]) groups[t] = [];
      groups[t].push(p);
    }
    return [
      { key: "moveable", label: "Moveable", items: groups["moveable"] ?? [] },
      { key: "listening", label: "Listening", items: groups["listening"] ?? [] },
      { key: "core", label: "Core", items: groups["core"] ?? [] },
      { key: "untouchable", label: "Untouchable", items: groups["untouchable"] ?? [] },
    ].filter((t) => t.items.length > 0);
  }, [activeRoster]);

  const canSend = useMemo(() => {
    return dealAssets.some((a) => a.fromTeamId === myTeamId) && dealAssets.some((a) => a.toTeamId === myTeamId);
  }, [dealAssets, myTeamId]);

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>}

      {/* Header */}
      <div style={{ background: "#F5F0E6", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div onClick={onBack} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer" }}>← Back</div>
          <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
          <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>{teams.map((t) => t.name).join(" × ")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Change team</div>
          {teams.length < 3 && <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>+ Add team</div>}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "58% 42%", minHeight: 0 }}>
        {/* Left: Deal + AI + Send */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: "2px solid #1A1A1A", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <DealCard myTeamId={myTeamId} teams={teams} assets={dealAssets} onRemove={removeDealAsset} onAddClick={handleAddClick} threeTeam={threeTeam} />
            <AIAdvisor grade={advisorData.grade} gradeColor={advisorData.gradeColor} prose={advisorData.prose} suggestions={advisorData.suggestions} onTapSuggestion={(key) => {
              const suggestion = advisorData.suggestions.find((s) => s.key === key);
              if (!suggestion) return;
              const isFromMyRoster = suggestion.meta.includes("Your roster");
              if (isFromMyRoster && otherTeams[0]) { addDealAsset(key, suggestion.name, myTeamId, otherTeams[0].id); }
              else if (!isFromMyRoster) { addDealAsset(key, suggestion.name, otherTeams[0]?.id ?? "", myTeamId); }
            }} loading={advisorLoading} />
          </div>
          <div style={{ padding: "12px 20px", borderTop: "2px solid #1A1A1A", flexShrink: 0, background: "#F5F0E6" }}>
            <div onClick={canSend ? handleSendOffer : undefined} style={{ background: canSend ? "#E8503A" : "#C8C3B8", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: canSend ? "3px 3px 0 #1A1A1A" : "none", padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 14, cursor: canSend ? "pointer" : "not-allowed", textTransform: "uppercase", letterSpacing: "0.04em", opacity: canSend ? 1 : 0.5 }}>{sending ? "Sending…" : "Send offer"}</div>
          </div>
        </div>

        {/* Right: Roster panel */}
        <div style={{ display: "flex", flexDirection: "column", background: "#FEFCF9" }}>
          <div style={{ display: "flex", borderBottom: "2.5px solid #1A1A1A" }}>
            {teams.map((t, i) => (
              <div key={t.id} onClick={() => { setActiveTab(t.id); setRosterSearch(""); }} style={{
                flex: 1, padding: "10px 0", textAlign: "center", fontFamily: FH, fontWeight: 800,
                fontSize: teams.length > 2 ? 10 : 11, textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                background: activeTab === t.id ? "#1A1A1A" : "#FEFCF9", color: activeTab === t.id ? "#FEFCF9" : "#8C7E6A",
                borderRight: i < teams.length - 1 ? "1px solid " + (activeTab === t.id ? "#FEFCF9" : "#C8C3B8") : "none",
              }}>{t.name}</div>
            ))}
          </div>
          <div style={{ padding: "8px 14px", borderBottom: "1.5px solid #C8C3B8" }}>
            <input type="text" placeholder={`Search ${teams.find((t) => t.id === activeTab)?.name ?? ""} roster…`} value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} style={{ width: "100%", border: "2px solid #1A1A1A", padding: "6px 10px", fontSize: 11, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px" }}>
            {loading ? (
              <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>Loading roster…</div>
            ) : tiers.length === 0 ? (
              <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>No players found.</div>
            ) : (
              tiers.map((tier) => (
                <div key={tier.key}>
                  <TierDivider label={tier.label} />
                  {tier.items.map((p) => (
                    <PlayerRow key={p.key} name={p.name} meta={p.meta} selected={dealKeys.has(p.key)} onToggle={() => handleRosterTap(p.key, p.name)} />
                  ))}
                </div>
              ))
            )}
            <div style={{ height: 12 }} />
          </div>
        </div>
      </div>

      {/* Routing popup (3-team only) */}
      {routingPopup && (
        <RoutingPopup
          teams={teams.filter((t) => t.id !== routingPopup.fromTeamId)}
          onSelect={handleRoutingSelect}
          onClose={() => setRoutingPopup(null)}
        />
      )}
    </div>
  );
}
