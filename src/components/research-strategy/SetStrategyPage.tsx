"use client";

import { useCallback, useEffect, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { InnerTopbar } from "@/shared/ui/InnerTopbar";
import DirectorTwoBox from "@/shared/components/DirectorTwoBox";
import StrategyEditorOverlay from "./StrategyEditorOverlay";

/* ── palette ── */
const INK = "#1A1A1A";
const PAPER = "#FEFCF9";
const CREAM = "#F5F0E6";
const GOLD = "#B8862E";
const BLUE = "#3366CC";
const RED = "#E8503A";
const MUTED = "#8C7E6A";
const MUTEDB = "#D8CFBC";

const mono = "'JetBrains Mono', ui-monospace, monospace";
const serif = "Georgia, 'Playfair Display', serif";

type Market = "buy" | "hold" | "sell";
type MarketKey = "qb_market" | "rb_market" | "pc_market" | "picks_market";
type ArrKey =
  | "qb_buy_intent"
  | "rb_buy_intent"
  | "pc_buy_intent"
  | "picks_buy_kind"
  | "qb_sell_move"
  | "rb_sell_move"
  | "pc_sell_move"
  | "picks_sell_move";
type TabKey = "QB" | "RB" | "PC" | "PICKS";

type Profile = {
  wants_more: string[];
  qb_market: Market;
  rb_market: Market;
  pc_market: Market;
  picks_market: Market;
  qb_buy_intent: string[];
  rb_buy_intent: string[];
  pc_buy_intent: string[];
  picks_buy_kind: string[];
  qb_sell_move: string[];
  rb_sell_move: string[];
  pc_sell_move: string[];
  picks_sell_move: string[];
  own_guys_preference: string;
  gm_persona: string;
};

type Opt = { value: string; label: string; desc: string; short: string };

const BUY_OPTS: Opt[] = [
  { value: "difference_maker", label: "Land a difference-maker", desc: "Studs and clear starter upgrades", short: "Difference-maker" },
  { value: "insurance", label: "Get insurance for our starters", desc: "Someone who steps in if a starter goes down", short: "Insurance" },
  { value: "young", label: "Find young guys to build around", desc: "Building blocks down to cheap fliers", short: "Young guys" },
];
const SELL_OPTS: Opt[] = [
  { value: "consolidate", label: "Consolidate our depth", desc: "Package the surplus into one better player here", short: "Consolidate" },
  { value: "fill_need", label: "Fill a different need", desc: "Route the surplus to a spot we flagged thin", short: "Fill a need" },
];
const PICKS_BUY_OPTS: Opt[] = [
  { value: "premium", label: "Premium picks", desc: "This year's first-rounders", short: "Premium" },
  { value: "day2", label: "Day-2 capital", desc: "This year's 2nds and 3rds", short: "Day-2" },
  { value: "future", label: "Future picks", desc: "Build the war chest for later", short: "Future" },
];
const PICKS_SELL_OPTS: Opt[] = [
  { value: "consolidate", label: "Consolidate picks", desc: "Package picks to move up the board", short: "Consolidate" },
  { value: "fill_need", label: "Fill a different need", desc: "Spend the picks on a spot we flagged thin", short: "Fill a need" },
];

type CardCfg = {
  tab: TabKey;
  display: string;
  marketKey: MarketKey;
  buyKey: ArrKey;
  sellKey: ArrKey;
  lines: string[];
  isPicks: boolean;
};
const CARDS: CardCfg[] = [
  { tab: "QB", display: "QUARTERBACK", marketKey: "qb_market", buyKey: "qb_buy_intent", sellKey: "qb_sell_move", lines: ["Quarterback"], isPicks: false },
  { tab: "RB", display: "RUNNING BACK", marketKey: "rb_market", buyKey: "rb_buy_intent", sellKey: "rb_sell_move", lines: ["Running", "Back"], isPicks: false },
  { tab: "PC", display: "PASS CATCHERS", marketKey: "pc_market", buyKey: "pc_buy_intent", sellKey: "pc_sell_move", lines: ["Pass", "Catchers"], isPicks: false },
  { tab: "PICKS", display: "DRAFT PICKS", marketKey: "picks_market", buyKey: "picks_buy_kind", sellKey: "picks_sell_move", lines: ["Draft", "Picks"], isPicks: true },
];

const STANCES: { value: Market; label: string; color: string }[] = [
  { value: "buy", label: "WE'RE THIN", color: RED },
  { value: "hold", label: "WE'RE SET", color: BLUE },
  { value: "sell", label: "WE'RE DEEP", color: GOLD },
];

const TWO_BOX_MSG =
  "Give me an honest read on each spot — are we thin, set, or deep? Where we're thin or deep, tell me what we're after and I'll point the Personnel Department at the right kind of player.";

const optsFor = (cfg: CardCfg, stance: Market): Opt[] =>
  stance === "buy"
    ? cfg.isPicks
      ? PICKS_BUY_OPTS
      : BUY_OPTS
    : stance === "sell"
      ? cfg.isPicks
        ? PICKS_SELL_OPTS
        : SELL_OPTS
      : [];

const CSS = `
.ss-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:14px;}
.ss-bnav{display:none;}
@media (max-width:700px){
  .ss-wrap{padding-bottom:96px;}
  .ss-grid{grid-template-columns:1fr;}
  .ss-card{display:none;}
  .ss-card.active{display:block;}
  .ss-bnav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:50;background:${PAPER};border-top:3px solid ${INK};}
  .ss-bnav button{flex:1;border:none;border-right:2px solid ${INK};padding:14px 4px;cursor:pointer;font-family:${mono};font-size:12px;font-weight:800;letter-spacing:0.06em;}
  .ss-bnav button:last-child{border-right:none;}
}`;

function BannerTag({ lines }: { lines: string[] }) {
  const two = lines.length > 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
      <div style={{ width: 2, height: 38, background: INK }} />
      <svg width={158} height={86} viewBox="0 0 180 96" style={{ marginTop: -1 }}>
        <path d="M 90 6 L 168 28 L 168 88 L 12 88 L 12 28 Z" fill={CREAM} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <circle cx={90} cy={19} r={4.5} fill={PAPER} stroke={INK} strokeWidth={2.5} />
        {two ? (
          <>
            <text x={90} y={56} textAnchor="middle" fontFamily={serif} fontSize={17} fontWeight={700} fill={INK}>{lines[0]}</text>
            <text x={90} y={76} textAnchor="middle" fontFamily={serif} fontSize={17} fontWeight={700} fill={INK}>{lines[1]}</text>
          </>
        ) : (
          <text x={90} y={64} textAnchor="middle" fontFamily={serif} fontSize={20} fontWeight={700} fill={INK}>{lines[0]}</text>
        )}
      </svg>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, position: "sticky", top: 0, background: CREAM, zIndex: 5, padding: "10px 0" }}>
      <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 800, letterSpacing: "0.2em", color: INK, whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 2.5, background: INK }} />
    </div>
  );
}

function PMCard({
  cfg,
  profile,
  onStance,
  onOpenMarker,
}: {
  cfg: CardCfg;
  profile: Profile;
  onStance: (m: Market) => void;
  onOpenMarker: () => void;
}) {
  const value = profile[cfg.marketKey];
  const current = STANCES.find((s) => s.value === value) ?? STANCES[1];
  const opts = optsFor(cfg, value);
  const key: ArrKey | null = value === "buy" ? cfg.buyKey : value === "sell" ? cfg.sellKey : null;
  const selected = key ? profile[key] : [];
  const shorts = selected.map((v) => opts.find((o) => o.value === v)?.short).filter(Boolean) as string[];
  const showMarker = value === "buy" || value === "sell";

  return (
    <div style={{ background: PAPER, borderRadius: 16, boxShadow: "0 3px 10px rgba(0,0,0,0.14)", padding: 13, display: "flex", flexDirection: "column" }}>
      <div style={{ border: `3px solid ${INK}`, borderRadius: 10, height: 176, background: current.color }}>
        <BannerTag lines={cfg.lines} />
      </div>
      {STANCES.map((s) => {
        const sel = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => onStance(s.value)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              textAlign: "left",
              background: PAPER,
              cursor: "pointer",
              border: `${sel ? "2.5px" : "2px"} solid ${sel ? s.color : MUTEDB}`,
              borderRadius: 8,
              padding: "10px 14px",
              marginTop: 8,
            }}
          >
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: sel ? s.color : MUTED }}>
              {sel ? `\u2713 ${s.label}` : s.label}
            </span>
          </button>
        );
      })}
      {showMarker && (
        <div
          onClick={onOpenMarker}
          style={{ marginTop: 10, cursor: "pointer", background: CREAM, border: `2px solid ${INK}`, borderRadius: 8, padding: "9px 12px" }}
        >
          <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 800, letterSpacing: "0.01em", color: INK, lineHeight: 1.3 }}>
            {shorts.length ? shorts.join("  +  ") : "Tap to choose"}
          </div>
          <div style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", color: MUTED, marginTop: 4 }}>TAP TO EDIT</div>
        </div>
      )}
    </div>
  );
}

export default function SetStrategyPage() {
  const { rosterId = "" } = readStoredTeam();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("QB");
  const [openTab, setOpenTab] = useState<TabKey | null>(null);

  useEffect(() => {
    if (!rosterId) return;
    fetch(`/api/research-strategy/strategy?teamId=${encodeURIComponent(rosterId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.data) setProfile(j.data as Profile);
      })
      .catch(() => {});
  }, [rosterId]);

  const save = useCallback(
    (next: Profile) => {
      if (!rosterId) return;
      fetch("/api/research-strategy/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, profile: next }),
      }).catch(() => {});
    },
    [rosterId],
  );

  const setStance = (cfg: CardCfg, value: Market) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const changed = prev[cfg.marketKey] !== value;
      let next: Profile = { ...prev, [cfg.marketKey]: value };
      if (changed) next = { ...next, [cfg.buyKey]: [], [cfg.sellKey]: [] };
      save(next);
      return next;
    });
    setActiveTab(cfg.tab);
    setOpenTab(value === "hold" ? null : cfg.tab);
  };

  const openMarker = (cfg: CardCfg) => {
    setActiveTab(cfg.tab);
    setOpenTab(cfg.tab);
  };

  const openCfg = CARDS.find((c) => c.tab === openTab) ?? null;
  const openStance: Market | null = openCfg && profile ? profile[openCfg.marketKey] : null;
  const openKey: ArrKey | null =
    openCfg && openStance === "buy" ? openCfg.buyKey : openCfg && openStance === "sell" ? openCfg.sellKey : null;

  const toggleIntent = (val: string) => {
    if (!openKey) return;
    const k = openKey;
    setProfile((prev) => {
      if (!prev) return prev;
      const arr = prev[k];
      const next: Profile = { ...prev, [k]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] };
      save(next);
      return next;
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: CREAM }}>
      <style>{CSS}</style>
      <InnerTopbar breadcrumb="SET STRATEGY" />
      <div style={{ height: 3, background: RED }} />

      <div className="ss-wrap" style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 20px 60px" }}>
        <DirectorTwoBox avatarSrc="/avatars/strategy.png" label="Strategy Director" message={TWO_BOX_MSG} />

        {!profile ? (
          <p style={{ fontFamily: mono, fontSize: 12, color: MUTED, marginTop: 24 }}>Loading&hellip;</p>
        ) : (
          <div style={{ marginTop: 26 }}>
            <Divider label="WHERE WE STAND" />
            <div className="ss-grid">
              {CARDS.map((cfg) => (
                <div key={cfg.tab} className={"ss-card" + (activeTab === cfg.tab ? " active" : "")}>
                  <PMCard cfg={cfg} profile={profile} onStance={(m) => setStance(cfg, m)} onOpenMarker={() => openMarker(cfg)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="ss-bnav">
        {CARDS.map((cfg) => {
          const on = activeTab === cfg.tab;
          return (
            <button key={cfg.tab} type="button" onClick={() => setActiveTab(cfg.tab)} style={{ background: on ? INK : PAPER, color: on ? PAPER : INK }}>
              {cfg.tab}
            </button>
          );
        })}
      </div>

      {openCfg && openStance && openStance !== "hold" && profile && (
        <StrategyEditorOverlay
          heading={openCfg.display}
          question={openStance === "buy" ? (openCfg.isPicks ? "WHAT KIND?" : "WHAT DO WE NEED?") : "WHAT'S THE MOVE?"}
          accent={openStance === "buy" ? RED : GOLD}
          options={optsFor(openCfg, openStance)}
          selected={openKey ? profile[openKey] : []}
          onToggle={toggleIntent}
          onClose={() => setOpenTab(null)}
        />
      )}
    </div>
  );
}