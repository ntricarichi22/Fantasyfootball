"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import CartSidebar, { type CartItem } from "./CartSidebar";
import ConfirmModal, { type SuggestionItem } from "./ConfirmModal";
import RosterModal, { type RosterAsset } from "./RosterModal";

type Asset = { key: string; name: string; meta: string; rosterMeta: string; position: string; posGroup: string; tier: string; tierLabel: string; teamId: string; teamName: string; value: number; fitScore: number; type: "player" | "pick" };
type RankedTeam = { teamId: string; teamName: string; score: number; wantsLabels: string[]; headline: string };
type Props = { onCheckout: (cart: CartItem[], teams: { id: string; name: string }[]) => void };

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const CHIP_COLORS: Record<string, string> = { Moveable: "#007370", Listening: "#F5C230", Core: "#1A1A1A", Untouchable: "#E8503A" };

function SectionBar({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "6px 0" }}>
      <div style={{ background: "#1A1A1A", padding: "8px 14px", flexShrink: 0 }}>
        <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 13, color: "#FEFCF9" }}>{label}</span>
      </div>
      <div style={{ flex: 1, height: 0, borderBottom: "3px solid #1A1A1A" }} />
    </div>
  );
}

export default function LandingPage({ onCheckout }: Props) {
  const { rosterId = "" } = readStoredTeam();
  const [targets, setTargets] = useState<Asset[]>([]);
  const [rankings, setRankings] = useState<RankedTeam[]>([]);
  const [allRosters, setAllRosters] = useState<Record<string, Asset[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Asset[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<Asset | null>(null);
  const [rosterTeam, setRosterTeam] = useState<{ id: string; name: string } | null>(null);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!rosterId) return;
    fetch(`/api/pro-personnel/targets?teamId=${encodeURIComponent(rosterId)}`)
      .then(r => r.json())
      .then(j => { setTargets(j.targets ?? []); setRankings(j.rankings ?? []); setAllRosters(j.rosters ?? {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rosterId]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const q = search.toLowerCase();
    const results: Asset[] = []; const seen = new Set<string>();
    for (const rid of Object.keys(allRosters)) {
      if (rid === rosterId) continue;
      for (const p of allRosters[rid] ?? []) {
        if (seen.has(p.key)) continue;
        if (p.name.toLowerCase().includes(q) || p.meta.toLowerCase().includes(q)) { results.push(p); seen.add(p.key); }
      }
    }
    results.sort((a, b) => b.value - a.value);
    setSearchResults(results.slice(0, 10));
  }, [search, allRosters, rosterId]);

  const cartKeys = useMemo(() => new Set(cart.map(c => c.key)), [cart]);
  const hasCart = cart.length > 0;
  const isSearching = search.trim().length > 0;
  const displayTargets = isSearching ? searchResults : targets;

  const addToCart = useCallback((key: string, name: string, meta: string, teamId: string, teamName: string) => {
    setCart(prev => prev.some(c => c.key === key) ? prev : [...prev, { key, name, meta, teamId, teamName }]);
    setAddedKeys(prev => new Set(prev).add(key));
  }, []);
  const removeFromCart = useCallback((key: string) => {
    setCart(prev => prev.filter(c => c.key !== key));
    setAddedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
  }, []);
  const handlePlayerClick = useCallback((t: Asset) => { if (cartKeys.has(t.key)) return; addToCart(t.key, t.name, t.meta, t.teamId, t.teamName); setConfirmTarget(t); }, [addToCart, cartKeys]);
  const handleTeamClick = useCallback((team: RankedTeam) => { setRosterTeam({ id: team.teamId, name: team.teamName }); }, []);
  const handleCheckout = useCallback(() => { setConfirmTarget(null); setRosterTeam(null); const teamIds = [...new Set(cart.map(c => c.teamId))]; onCheckout(cart, teamIds.map(id => ({ id, name: cart.find(c => c.teamId === id)?.teamName ?? id }))); }, [cart, onCheckout]);
  const handleKeepShopping = useCallback(() => { setConfirmTarget(null); setRosterTeam(null); }, []);
  const handleSeeMore = useCallback(() => { if (confirmTarget) { setRosterTeam({ id: confirmTarget.teamId, name: confirmTarget.teamName }); setConfirmTarget(null); } }, [confirmTarget]);

  const confirmSuggestions = useMemo<SuggestionItem[]>(() => {
    if (!confirmTarget) return [];
    return (allRosters[confirmTarget.teamId] ?? [])
      .filter(t => t.key !== confirmTarget.key && (t.tier === "moveable" || t.tier === "listening" || t.type === "pick"))
      .slice(0, 4)
      .map(t => ({ key: t.key, row1: t.name.split(" ")[0] ?? t.name, row2: t.name.split(" ").slice(1).join(" ") || "", meta: t.type === "pick" ? "Draft pick" : t.meta.split(" · ").slice(0, 2).join(" · ") }));
  }, [confirmTarget, allRosters]);

  // Roster modal: use rosterMeta instead of meta for pick context
  const rosterAssets = useMemo<RosterAsset[]>(() => {
    if (!rosterTeam) return [];
    return (allRosters[rosterTeam.id] ?? []).map(t => ({
      key: t.key, name: t.name,
      meta: t.rosterMeta ?? t.meta,
      tier: t.tier === "core_piece" ? "core" : (t.tier || "core"),
      tierLabel: t.tierLabel,
      posGroup: t.posGroup,
      value: t.value,
      fitScore: t.fitScore,
    }));
  }, [rosterTeam, allRosters]);

  if (!rosterId) {
    return <div style={{ minHeight: "100vh", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F }}>
      <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "32px 40px", textAlign: "center" }}>
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Sign in to make offers</div>
      </div>
    </div>;
  }

  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ background: "#F5F0E6", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div onClick={() => { window.location.href = "/inbox"; }} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer" }}>← Back to inbox</div>
        <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>Who are you targeting?</div>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ border: "2.5px solid #1A1A1A", background: "#FEFCF9", display: "flex", alignItems: "center" }}>
            <div style={{ padding: "0 12px", display: "flex", alignItems: "center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8C7E6A" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg></div>
            <input type="text" placeholder="Search for a player or pick…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, padding: "12px 8px", fontSize: 13, border: "none", outline: "none", background: "transparent", fontFamily: F }} />
          </div>
          <SectionBar label={isSearching ? "Search results" : "On the block"} />
          {loading ? <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>Loading targets…</div>
          : displayTargets.length === 0 ? <div style={{ textAlign: "center", fontFamily: FM, fontSize: 11, color: "#8C7E6A", padding: "20px 0" }}>{isSearching ? "No results found." : "No players on the block right now."}</div>
          : <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {displayTargets.map(t => {
                const inCart = cartKeys.has(t.key);
                return <div key={t.key} onClick={() => handlePlayerClick(t)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", border: inCart ? "2px solid #185FA5" : "2px solid #1A1A1A", background: inCart ? "#E6F1FB" : "#FEFCF9", cursor: inCart ? "default" : "pointer" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: inCart ? "#185FA5" : "#1A1A1A" }}>{t.name}</span>
                    <span style={{ fontFamily: FM, fontSize: 8, color: inCart ? "#185FA5" : "#8C7E6A", marginLeft: 6 }}>{t.meta}</span>
                  </div>
                  {!inCart && <span style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "#FEFCF9", background: CHIP_COLORS[t.tierLabel] ?? "#1A1A1A", padding: "2px 5px", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>{t.tierLabel}</span>}
                  <div style={{ width: 22, height: 22, border: inCart ? "none" : "2.5px solid #1A1A1A", background: inCart ? "#185FA5" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FM, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                    {inCart ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#E6F1FB" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg> : "+"}
                  </div>
                </div>;
              })}
            </div>}
          {!isSearching && <>
            <SectionBar label="Trade partners" />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rankings.map((team, i) => <div key={team.teamId} onClick={() => handleTeamClick(team)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1.5px solid #C8C3B8", background: "#FEFCF9", cursor: "pointer" }}>
                <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 20, color: "#C8C3B8", width: 26, textAlign: "center", flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 13 }}>{team.teamName}</span>
                    {team.wantsLabels.map(l => <span key={l} style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, color: "#3366CC", border: "1.5px solid #3366CC", padding: "1px 5px", textTransform: "uppercase" }}>{l}</span>)}
                  </div>
                  <div style={{ fontSize: 11, color: "#8C7E6A", marginTop: 2 }}>{team.headline}</div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C8C3B8" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
              </div>)}
            </div>
          </>}
          <div style={{ height: 20 }} />
        </div>
        {hasCart && <CartSidebar items={cart} onRemove={removeFromCart} onCheckout={handleCheckout} />}
      </div>
      {confirmTarget && <ConfirmModal playerName={confirmTarget.name} teamName={confirmTarget.teamName} playerMeta={confirmTarget.meta} suggestions={confirmSuggestions} addedKeys={addedKeys}
        onAddSuggestion={key => { const t = (allRosters[confirmTarget.teamId] ?? []).find(x => x.key === key); if (t) addToCart(t.key, t.name, t.meta, t.teamId, t.teamName); }}
        onSeeMore={handleSeeMore} onCheckout={handleCheckout} onKeepShopping={handleKeepShopping} />}
      {rosterTeam && <RosterModal teamName={rosterTeam.name} assets={rosterAssets} selectedKeys={cartKeys}
        onToggle={key => { if (cartKeys.has(key)) removeFromCart(key); else { const t = (allRosters[rosterTeam.id] ?? []).find(x => x.key === key); if (t) addToCart(t.key, t.name, t.meta, t.teamId, t.teamName); } }}
        onCheckout={handleCheckout} onKeepShopping={handleKeepShopping} onClose={handleKeepShopping} />}
    </div>
  );
}
