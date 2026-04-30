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
type RosterPlayer = {
  key: string;
  name: string;
  meta: string;
  rosterMeta: string;
  tier: string;
  value: number;
  position: string;
  posGroup: string;
  type: "player" | "pick";
  fitScore: number;
  isStud: boolean;
  isYouth: boolean;
};

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const POS_SECTIONS = [
  { key: "QB", label: "Quarterbacks" },
  { key: "RB", label: "Running Backs" },
  { key: "PASS", label: "Pass Catchers" },
  { key: "PICK", label: "Draft Picks" },
];

function teamNick(name: string): string {
  const p = name.split(" ");
  return p.length > 1 ? p.slice(1).join(" ") : name;
}

export default function TradeBuilder({ initialCart, initialTeams, onBack }: Props) {
  const { rosterId = "", teamName: myTeamName = "" } = readStoredTeam();
  const myTeamId = rosterId;
  const [teams] = useState(() => {
    const me = { id: myTeamId, name: myTeamName || `Team ${myTeamId}` };
    return [me, ...initialTeams.filter(t => t.id !== myTeamId)];
  });
  const [dealAssets, setDealAssets] = useState<DealAsset[]>(() =>
    initialCart.map(c => ({
      key: c.key,
      name: c.name,
      fromTeamId: c.teamId,
      toTeamId: myTeamId,
      fromTeamName: c.teamName,
      toTeamName: myTeamName || `Team ${myTeamId}`,
    }))
  );
  const [activeTab, setActiveTab] = useState(myTeamId);
  const [rosters, setRosters] = useState<Record<string, RosterPlayer[]>>({});
  const [loading, setLoading] = useState(true);
  const [routingPopup, setRoutingPopup] = useState<{ key: string; name: string; fromTeamId: string } | null>(null);

  // Advisor state — single source of truth from server
  const [advisorProse, setAdvisorProse] = useState("Add assets to both sides to get my take on this deal.");
  const [advisorGrade, setAdvisorGrade] = useState("");
  const [advisorGradeColor, setAdvisorGradeColor] = useState("#8C7E6A");
  const [advisorSuggestions, setAdvisorSuggestions] = useState<AdvisorSuggestion[]>([]);
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
          r[rid] = (raw[rid] ?? []).map((p: RosterPlayer) => ({
            ...p,
            tier: p.tier === "core_piece" ? "core" : (p.tier || "core"),
            rosterMeta: p.rosterMeta ?? p.meta,
            isStud: p.isStud ?? false,
            isYouth: p.isYouth ?? false,
          }));
        }
        setRosters(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [myTeamId]);

  // Single advisor call — server returns prose + grade + suggestions together
  useEffect(() => {
    if (advisorTimer.current) clearTimeout(advisorTimer.current);

    if (!dealAssets.length) {
      setAdvisorProse("Add players or picks to both sides to get my take.");
      setAdvisorGrade("");
      setAdvisorGradeColor("#8C7E6A");
      setAdvisorSuggestions([]);
      return;
    }

    setAdvisorLoading(true);
    advisorTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/trades/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            my_team_id: myTeamId,
            other_team_ids: otherTeams.map(t => t.id),
            deal_assets: dealAssets,
            rosters,
          }),
        });
        if (res.ok) {
          const j = await res.json();
          if (j.prose) setAdvisorProse(j.prose);
          setAdvisorGrade(j.grade ?? "");
          setAdvisorGradeColor(j.gradeColor ?? "#8C7E6A");
          setAdvisorSuggestions(Array.isArray(j.suggestions) ? j.suggestions : []);
        }
      } catch {
        // keep previous state on error
      } finally {
        setAdvisorLoading(false);
      }
    }, 1500);

    return () => {
      if (advisorTimer.current) clearTimeout(advisorTimer.current);
    };
  }, [dealAssets, myTeamId, otherTeams, rosters]);

  const removeDealAsset = useCallback((key: string) => {
    setDealAssets(prev => prev.filter(a => a.key !== key));
  }, []);

  const addDealAsset = useCallback((key: string, name: string, fromTeamId: string, toTeamId: string) => {
    const from = teams.find(t => t.id === fromTeamId);
    const to = teams.find(t => t.id === toTeamId);
    setDealAssets(prev => prev.some(a => a.key === key) ? prev : [...prev, {
      key, name, fromTeamId, toTeamId,
      fromTeamName: from?.name ?? fromTeamId,
      toTeamName: to?.name ?? toTeamId,
    }]);
  }, [teams]);

  const handleRosterTap = useCallback((key: string, name: string) => {
    if (dealKeys.has(key)) { removeDealAsset(key); return; }
    if (threeTeam) { setRoutingPopup({ key, name, fromTeamId: activeTab }); return; }
    if (activeTab === myTeamId) {
      const o = otherTeams[0];
      if (o) addDealAsset(key, name, myTeamId, o.id);
    } else {
      addDealAsset(key, name, activeTab, myTeamId);
    }
  }, [activeTab, threeTeam, myTeamId, otherTeams, dealKeys, addDealAsset, removeDealAsset]);

  const handleRoutingSelect = useCallback((toTeamId: string) => {
    if (!routingPopup) return;
    addDealAsset(routingPopup.key, routingPopup.name, routingPopup.fromTeamId, toTeamId);
    setRoutingPopup(null);
  }, [routingPopup, addDealAsset]);

  const handleAddFromTeam = useCallback((teamId: string) => {
    if (teamId === "__universal__") {
      setRoutingPopup({ key: "__browse__", name: "", fromTeamId: "__universal__" });
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

  // Suggestions are bundles — tapping adds ALL assets in the suggestion atomically
  const handleSuggestionTap = useCallback((suggestion: AdvisorSuggestion) => {
    const otherTeam = otherTeams[0];
    if (!otherTeam) return;
    const fromTeamId = suggestion.direction === "send" ? myTeamId : otherTeam.id;
    const toTeamId = suggestion.direction === "send" ? otherTeam.id : myTeamId;
    const fromTeam = teams.find(t => t.id === fromTeamId);
    const toTeam = teams.find(t => t.id === toTeamId);

    setDealAssets(prev => {
      const existing = new Set(prev.map(a => a.key));
      const additions: DealAsset[] = [];
      for (const asset of suggestion.assets) {
        if (existing.has(asset.key)) continue;
        additions.push({
          key: asset.key,
          name: asset.name,
          fromTeamId,
          toTeamId,
          fromTeamName: fromTeam?.name ?? fromTeamId,
          toTeamName: toTeam?.name ?? toTeamId,
        });
      }
      return [...prev, ...additions];
    });
  }, [otherTeams, myTeamId, teams]);

  const handleSendOffer = useCallback(async () => {
    if (sending) return;
    const ms = dealAssets.filter(a => a.fromTeamId === myTeamId);
    const mr = dealAssets.filter(a => a.toTeamId === myTeamId);
    if (!ms.length || !mr.length) { flash("Add assets to both sides."); return; }
    setSending(true);
    try {
      const to = otherTeams[0];
      if (!to) return;
      const res = await fetch("/api/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: myTeamId,
          to_team_id: to.id,
          assets_from: ms.map(a => ({ key: a.key, label: a.name, type: a.key.startsWith("player:") ? "player" : "pick", value: 0 })),
          assets_to: mr.map(a => ({ key: a.key, label: a.name, type: a.key.startsWith("player:") ? "player" : "pick", value: 0 })),
          from_value: 0,
          to_value: 0,
          grade_label: advisorGrade || "Fair",
        }),
      });
      if (res.ok) {
        flash("Offer sent!");
        setTimeout(() => { window.location.href = "/trades"; }, 1000);
      } else {
        const j = await res.json().catch(() => ({}));
        flash(j.error || "Failed");
      }
    } catch {
      flash("Failed");
    } finally {
      setSending(false);
    }
  }, [sending, dealAssets, myTeamId, otherTeams, advisorGrade, flash]);

  const activeRoster = useMemo(() => {
    let players = rosters[activeTab] ?? [];
    if (rosterSearch.trim()) {
      const q = rosterSearch.toLowerCase();
      players = players.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.meta.toLowerCase().includes(q) ||
        p.rosterMeta.toLowerCase().includes(q)
      );
    }
    return players;
  }, [rosters, activeTab, rosterSearch]);

  const posSections = useMemo(() =>
    POS_SECTIONS.map(sec => ({
      ...sec,
      items: activeRoster.filter(p => (p.posGroup ?? "OTHER") === sec.key).sort((a, b) => b.value - a.value),
    })).filter(s => s.items.length > 0)
  , [activeRoster]);

  const canSend = dealAssets.some(a => a.fromTeamId === myTeamId) && dealAssets.some(a => a.toTeamId === myTeamId);
  const tabFontSize = teams.length > 2 ? Math.min(11, Math.floor(90 / Math.max(...teams.map(t => teamNick(t.name).length), 1))) : 11;

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 50, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>
          {toast}
        </div>
      )}
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
            <AIAdvisor
              grade={advisorGrade}
              gradeColor={advisorGradeColor}
              prose={advisorProse}
              suggestions={advisorSuggestions}
              onTapSuggestion={handleSuggestionTap}
              loading={advisorLoading}
            />
          </div>
          <div style={{ padding: "12px 20px", borderTop: "2px solid #1A1A1A", flexShrink: 0, background: "#F5F0E6" }}>
            <div onClick={canSend ? handleSendOffer : undefined} style={{ background: canSend ? "#E8503A" : "#C8C3B8", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: canSend ? "3px 3px 0 #1A1A1A" : "none", padding: "12px 0", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: 14, cursor: canSend ? "pointer" : "not-allowed", textTransform: "uppercase", letterSpacing: "0.04em", opacity: canSend ? 1 : 0.5 }}>
              {sending ? "Sending…" : "Send offer"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", background: "#FEFCF9", overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "2.5px solid #1A1A1A", flexShrink: 0 }}>
            {teams.map((t, i) => (
              <div key={t.id} onClick={() => { setActiveTab(t.id); setRosterSearch(""); }} style={{ flex: 1, padding: "10px 4px", textAlign: "center", fontFamily: FH, fontWeight: 800, fontSize: tabFontSize, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer", background: activeTab === t.id ? "#1A1A1A" : "#FEFCF9", color: activeTab === t.id ? "#FEFCF9" : "#8C7E6A", borderRight: i < teams.length - 1 ? "1px solid " + (activeTab === t.id ? "#FEFCF9" : "#C8C3B8") : "none" }}>
                {teamNick(t.name)}
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 14px", borderBottom: "1.5px solid #C8C3B8", flexShrink: 0 }}>
            <input
              type="text"
              placeholder={`Search ${teamNick(teams.find(t => t.id === activeTab)?.name ?? "")} roster…`}
              value={rosterSearch}
              onChange={e => setRosterSearch(e.target.value)}
              style={{ width: "100%", border: "2px solid #1A1A1A", padding: "6px 10px", fontSize: 11, background: "#FEFCF9", fontFamily: F, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px", minHeight: 0 }}>
            {loading ? (
              <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>Loading roster…</div>
            ) : posSections.length === 0 ? (
              <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>No players found.</div>
            ) : (
              posSections.map(sec => (
                <div key={sec.key}>
                  <TierDivider label={sec.label} />
                  {sec.items.map(p => (
                    <PlayerRow
                      key={p.key}
                      name={p.name}
                      meta={p.rosterMeta}
                      selected={dealKeys.has(p.key)}
                      onToggle={() => handleRosterTap(p.key, p.name)}
                      chip={AVAILABILITY_CHIPS[p.tier]}
                    />
                  ))}
                </div>
              ))
            )}
            <div style={{ height: 12 }} />
          </div>
        </div>
      </div>
      {routingPopup && routingPopup.key === "__browse__" ? (
        <RoutingPopup teams={teams} onSelect={handleUniversalBrowse} onClose={() => setRoutingPopup(null)} />
      ) : routingPopup ? (
        <RoutingPopup teams={teams.filter(t => t.id !== routingPopup.fromTeamId)} onSelect={handleRoutingSelect} onClose={() => setRoutingPopup(null)} />
      ) : null}
    </div>
  );
}
