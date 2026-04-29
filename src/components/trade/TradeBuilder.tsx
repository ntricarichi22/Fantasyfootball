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
const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

type AttachRow = { team_id: string; sleeper_player_id: string; attachment: string };

export default function TradeBuilder({ initialCart, initialTeams, onBack }: Props) {
  const { rosterId = "", teamName: myTeamName = "" } = readStoredTeam();
  const myTeamId = rosterId;

  const [teams, setTeams] = useState<{ id: string; name: string }[]>(() => {
    const me = { id: myTeamId, name: myTeamName || `Team ${myTeamId}` };
    const others = initialTeams.filter((t) => t.id !== myTeamId);
    return [me, ...others];
  });
  const [dealAssets, setDealAssets] = useState<DealAsset[]>(() =>
    initialCart.map((c) => ({ key: c.key, name: c.name, fromTeamId: c.teamId, toTeamId: myTeamId, fromTeamName: c.teamName, toTeamName: myTeamName || `Team ${myTeamId}` }))
  );
  const [activeTab, setActiveTab] = useState(myTeamId);
  const [rosters, setRosters] = useState<Record<string, RosterPlayer[]>>({});
  const [attachments, setAttachments] = useState<AttachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [routingPopup, setRoutingPopup] = useState<{ key: string; name: string; meta: string; fromTeamId: string; pos?: { top: number; left: number } } | null>(null);
  const [advisorData, setAdvisorData] = useState({ grade: "", gradeColor: "#4CAF50", prose: "", suggestions: [] as AdvisorSuggestion[] });
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const threeTeam = teams.length > 2;
  const dealKeys = useMemo(() => new Set(dealAssets.map((a) => a.key)), [dealAssets]);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const [rosterRes, playerRes, valRes, attRes] = await Promise.all([
          LEAGUE_ID_ENV ? fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`) : Promise.resolve(null),
          LEAGUE_ID_ENV ? fetch("https://api.sleeper.app/v1/players/nfl") : Promise.resolve(null),
          fetch("/api/player-values"),
          fetch(`/api/trades/targets?teamId=${encodeURIComponent(myTeamId)}`),
        ]);
        const rosterJson = rosterRes?.ok ? await rosterRes.json() : [];
        const playerJson = playerRes?.ok ? await playerRes.json() : {};
        const valJson = valRes.ok ? await valRes.json() : {};
        const attJson = attRes.ok ? await attRes.json() : {};
        const values: Record<string, number> = valJson.data ?? {};
        const attList: AttachRow[] = [];
        for (const t of attJson.targets ?? []) { attList.push({ team_id: t.teamId, sleeper_player_id: t.key.replace("player:", ""), attachment: t.tier }); }
        setAttachments(attList);
        const rMap: Record<string, RosterPlayer[]> = {};
        for (const roster of rosterJson) {
          const rid = String(roster.roster_id);
          const players: RosterPlayer[] = [];
          for (const pid of roster.players ?? []) {
            const id = String(pid);
            const info = playerJson[id];
            if (!info) continue;
            const value = values[id] ?? 0;
            if (!value) continue;
            const name = info.full_name || [info.first_name, info.last_name].filter(Boolean).join(" ") || id;
            const pos = info.position?.toUpperCase() || "–";
            const age = info.age ? String(info.age) : "–";
            const att = attList.find((a) => a.team_id === rid && a.sleeper_player_id === id);
            const tier = att?.attachment || "core";
            players.push({ key: `player:${id}`, name, meta: `${pos} · ${info.team || "FA"} · ${age}`, tier, value });
          }
          players.sort((a, b) => b.value - a.value);
          rMap[rid] = players;
        }
        setRosters(rMap);
      } catch { /* silent */ }
      finally { setLoading(false); }
    }
    loadData();
  }, [myTeamId]);

  const removeDealAsset = useCallback((key: string) => {
    setDealAssets((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const addDealAsset = useCallback((key: string, name: string, fromTeamId: string, toTeamId: string) => {
    const fromTeam = teams.find((t) => t.id === fromTeamId);
    const toTeam = teams.find((t) => t.id === toTeamId);
    setDealAssets((prev) => {
      if (prev.some((a) => a.key === key)) return prev;
      return [...prev, { key, name, fromTeamId, toTeamId, fromTeamName: fromTeam?.name ?? fromTeamId, toTeamName: toTeam?.name ?? toTeamId }];
    });
  }, [teams]);

  const handleRosterTap = useCallback((key: string, name: string, meta: string) => {
    if (dealKeys.has(key)) { removeDealAsset(key); return; }
    const fromTeamId = activeTab;
    const otherTeams = teams.filter((t) => t.id !== fromTeamId);
    if (otherTeams.length === 1) {
      addDealAsset(key, name, fromTeamId, otherTeams[0].id);
    } else {
      setRoutingPopup({ key, name, meta, fromTeamId });
    }
  }, [activeTab, teams, dealKeys, addDealAsset, removeDealAsset]);

  const handleRoutingSelect = useCallback((toTeamId: string) => {
    if (!routingPopup) return;
    addDealAsset(routingPopup.key, routingPopup.name, routingPopup.fromTeamId, toTeamId);
    setRoutingPopup(null);
  }, [routingPopup, addDealAsset]);

  const handleAddClick = useCallback(() => {
    const otherTeams = teams.filter((t) => t.id !== myTeamId);
    if (otherTeams.length > 0) setActiveTab(otherTeams[0].id);
  }, [teams, myTeamId]);

  const handleSendOffer = useCallback(async () => {
    if (sending || dealAssets.length === 0) return;
    setSending(true);
    try {
      const mySends = dealAssets.filter((a) => a.fromTeamId === myTeamId);
      const myReceives = dealAssets.filter((a) => a.toTeamId === myTeamId);
      const toTeam = teams.find((t) => t.id !== myTeamId);
      if (!toTeam) return;
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
  }, [sending, dealAssets, myTeamId, teams, advisorData.grade, flash]);

  useEffect(() => {
    if (dealAssets.length < 2) { setAdvisorData({ grade: "", gradeColor: "#8C7E6A", prose: "Add assets from both sides to see the AI's take on this deal.", suggestions: [] }); return; }
    setAdvisorLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/trades/ai-counter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thread_id: "__preview__", counter_team_id: myTeamId, aggression: 50 }),
        });
        if (res.ok) {
          const j = await res.json();
          setAdvisorData({
            grade: j.brief?.includes("overpay") ? "You're reaching" : j.brief?.includes("lopsided") ? "Lopsided" : "In the range",
            gradeColor: j.brief?.includes("overpay") ? "#E8503A" : j.brief?.includes("lopsided") ? "#F5C230" : "#4CAF50",
            prose: j.brief || "This deal looks balanced based on current values.",
            suggestions: (j.suggestions ?? []).slice(0, 3).map((s: { number: number; label: string; description: string; delta_points: number }) => ({
              key: `suggest-${s.number}`,
              name: s.label,
              meta: `${s.description}`,
            })),
          });
        }
      } catch { /* silent */ }
      finally { setAdvisorLoading(false); }
    }, 800);
    return () => clearTimeout(timer);
  }, [dealAssets, myTeamId]);

  const activeRoster = useMemo(() => {
    const players = rosters[activeTab] ?? [];
    const tierOrder: Record<string, number> = { moveable: 0, listening: 1, core_piece: 2, core: 2, untouchable: 3 };
    return [...players].sort((a, b) => (tierOrder[a.tier] ?? 4) - (tierOrder[b.tier] ?? 4) || b.value - a.value);
  }, [rosters, activeTab]);

  const tiers = useMemo(() => {
    const groups: Record<string, RosterPlayer[]> = {};
    for (const p of activeRoster) {
      const t = p.tier === "core_piece" ? "core" : p.tier;
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

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>{toast}</div>}

      <div style={{ background: "#F5F0E6", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div onClick={onBack} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer" }}>← Back</div>
          <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
          <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>{teams.map((t) => t.name.split(" ").pop()).join(" × ")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>Change team</div>
          {teams.length < 3 && <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#3366CC", cursor: "pointer", border: "1.5px solid #3366CC", padding: "4px 10px", letterSpacing: "0.04em", textTransform: "uppercase" }}>+ Add team</div>}
        </div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "58% 42%", minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", borderRight: "2px solid #1A1A1A", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <DealCard myTeamId={myTeamId} teams={teams} assets={dealAssets} onRemove={removeDealAsset} onAddClick={handleAddClick} threeTeam={threeTeam} />
            <AIAdvisor grade={advisorData.grade} gradeColor={advisorData.gradeColor} prose={advisorData.prose} suggestions={advisorData.suggestions} onTapSuggestion={() => {}} loading={advisorLoading} />
          </div>
          <div style={{ padding: "12px 20px", borderTop: "2px solid #1A1A1A", flexShrink: 0, background: "#F5F0E6" }}>
            <div onClick={handleSendOffer} style={{ background: dealAssets.length >= 2 ? "#E8503A" : "#C8C3B8", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: dealAssets.length >= 2 ? "3px 3px 0 #1A1A1A" : "none", padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 14, cursor: dealAssets.length >= 2 ? "pointer" : "not-allowed", textTransform: "uppercase", letterSpacing: "0.04em", opacity: dealAssets.length >= 2 ? 1 : 0.5 }}>{sending ? "Sending…" : "Send offer"}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", background: "#FEFCF9" }}>
          <div style={{ display: "flex", borderBottom: "2.5px solid #1A1A1A" }}>
            {teams.map((t, i) => (
              <div key={t.id} onClick={() => setActiveTab(t.id)} style={{
                flex: 1, padding: "10px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: teams.length > 2 ? 10 : 11,
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                background: activeTab === t.id ? "#1A1A1A" : "#FEFCF9", color: activeTab === t.id ? "#FEFCF9" : "#8C7E6A",
                borderRight: i < teams.length - 1 ? "1px solid " + (activeTab === t.id ? "#FEFCF9" : "#C8C3B8") : "none",
              }}>{t.name.split(" ").pop()}</div>
            ))}
          </div>
          <div style={{ padding: "8px 14px", borderBottom: "1.5px solid #C8C3B8" }}>
            <input type="text" placeholder={`Search ${teams.find((t) => t.id === activeTab)?.name ?? ""} roster…`} style={{ width: "100%", border: "2px solid #1A1A1A", padding: "6px 10px", fontSize: 11, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px" }}>
            {loading ? (
              <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>Loading roster…</div>
            ) : tiers.length === 0 ? (
              <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>No players loaded.</div>
            ) : (
              tiers.map((tier) => (
                <div key={tier.key}>
                  <TierDivider label={tier.label} />
                  {tier.items.map((p) => (
                    <PlayerRow key={p.key} name={p.name} meta={p.meta} selected={dealKeys.has(p.key)} onToggle={() => handleRosterTap(p.key, p.name, p.meta)} />
                  ))}
                </div>
              ))
            )}
            <div style={{ height: 12 }} />
          </div>
        </div>
      </div>

      {routingPopup && (
        <RoutingPopup
          teams={teams.filter((t) => t.id !== routingPopup.fromTeamId)}
          onSelect={handleRoutingSelect}
          onClose={() => setRoutingPopup(null)}
          position={routingPopup.pos}
        />
      )}
    </div>
  );
}
