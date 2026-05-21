"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { InnerTopbar } from "@/shared/ui/InnerTopbar";
import DirectorTwoBox from "@/shared/components/DirectorTwoBox";

/* ── palette ── */
const INK = "#1A1A1A";
const PAPER = "#FEFCF9";
const CREAM = "#F5F0E6";
const GOLD = "#B8862E";
const BLUE = "#3366CC";
const RED = "#E8503A";
const MUTED = "#8C7E6A";
const MUTEDB = "#D8CFBC";

type Market = "buy" | "hold" | "sell";
type MarketKey = "qb_market" | "rb_market" | "pc_market" | "picks_market";
type Profile = {
  wants_more: string[];
  qb_market: Market;
  rb_market: Market;
  pc_market: Market;
  picks_market: Market;
  own_guys_preference: string;
  gm_persona: string;
};

const TWO_BOX_MSG =
  "Two things I need from you boss. First, an honest read of our current roster and team needs. Then, direction on how we want to fill those needs — build through the draft, go big-game hunting, or improve around the edges. Set both and I'll let the Personnel Department know who to target.";

const PM_CARDS: { key: MarketKey; lines: string[] }[] = [
  { key: "qb_market", lines: ["Quarterback"] },
  { key: "rb_market", lines: ["Running", "Back"] },
  { key: "pc_market", lines: ["Pass", "Catchers"] },
  { key: "picks_market", lines: ["Draft", "Picks"] },
];
const STANCES: { value: Market; label: string; color: string }[] = [
  { value: "buy", label: "WE'RE THIN", color: RED },
  { value: "hold", label: "WE'RE SET", color: BLUE },
  { value: "sell", label: "WE'RE DEEP", color: GOLD },
];
const WM_CARDS: { key: string; small: string; big: string; heroBg: string; heroText: string; mobile: string }[] = [
  { key: "picks", small: "BUILD THROUGH THE", big: "DRAFT", heroBg: GOLD, heroText: CREAM, mobile: "Build through the draft" },
  { key: "studs", small: "TARGET", big: "STUDS", heroBg: BLUE, heroText: CREAM, mobile: "Target studs" },
  { key: "youth", small: "GET", big: "YOUNGER", heroBg: CREAM, heroText: INK, mobile: "Get younger" },
  { key: "depth", small: "ROUND OUT THE", big: "DEPTH", heroBg: RED, heroText: CREAM, mobile: "Round out the depth" },
];

const mono = "'JetBrains Mono', ui-monospace, monospace";
const impact = "Impact, 'Anton', system-ui, sans-serif";
const serif = "Georgia, 'Playfair Display', serif";

const CSS = `
.ss-pm{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:14px;}
.ss-wm-d{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:14px;}
.ss-wm-m{display:none;margin-top:14px;}
.ss-pm-dots{display:none;}
@media (max-width:700px){
  .ss-pm{display:flex;gap:0;overflow-x:auto;scroll-snap-type:x mandatory;}
  .ss-pm>*{min-width:100%;flex:0 0 auto;scroll-snap-align:start;}
  .ss-wm-d{display:none;}
  .ss-wm-m{display:block;}
  .ss-pm-dots{display:flex;justify-content:center;gap:9px;margin-top:14px;}
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

function PMCard({ value, lines, onSet }: { value: Market; lines: string[]; onSet: (m: Market) => void }) {
  const current = STANCES.find((s) => s.value === value) ?? STANCES[1];
  return (
    <div style={{ background: PAPER, borderRadius: 16, boxShadow: "0 3px 10px rgba(0,0,0,0.14)", padding: 13, display: "flex", flexDirection: "column" }}>
      <div style={{ border: `3px solid ${INK}`, borderRadius: 10, height: 176, background: current.color }}>
        <BannerTag lines={lines} />
      </div>
      {STANCES.map((s) => {
        const sel = s.value === value;
        return (
          <button key={s.value} type="button" onClick={() => onSet(s.value)}
            style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", background: PAPER, cursor: "pointer",
              border: `${sel ? "2.5px" : "2px"} solid ${sel ? s.color : MUTEDB}`, borderRadius: 8, padding: "10px 14px", marginTop: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: sel ? s.color : MUTED }}>
              {sel ? `✓ ${s.label}` : s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WMCard({ card, on, onSet }: { card: (typeof WM_CARDS)[number]; on: boolean; onSet: (v: boolean) => void }) {
  const btn = (label: string, active: boolean, onClick: () => void) => (
    <button type="button" onClick={onClick}
      style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", cursor: "pointer",
        background: active ? INK : PAPER, border: `2px solid ${INK}`, borderRadius: 8, padding: "12px 14px", marginTop: 8 }}>
      <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: active ? PAPER : INK }}>
        {active ? `✓ ${label}` : label}
      </span>
    </button>
  );
  return (
    <div style={{ background: PAPER, borderRadius: 16, boxShadow: "0 3px 10px rgba(0,0,0,0.14)", padding: 13, display: "flex", flexDirection: "column" }}>
      <div style={{ border: `3px solid ${INK}`, borderRadius: 10, height: 224, background: card.heroBg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "system-ui, sans-serif", fontSize: 16, fontWeight: 600, letterSpacing: "0.09em", color: card.heroText }}>{card.small}</div>
        <div style={{ fontFamily: impact, fontSize: 64, fontWeight: 900, color: card.heroText, lineHeight: 0.9, transform: "skew(-5deg)", marginTop: 4 }}>{card.big}</div>
        <div style={{ width: 104, height: 6, background: card.heroText, marginTop: 12 }} />
      </div>
      {btn("YES", on, () => onSet(true))}
      {btn("NO", !on, () => onSet(false))}
    </div>
  );
}

function WMMobileCard({ wants, onToggle }: { wants: string[]; onToggle: (k: string) => void }) {
  return (
    <div style={{ background: PAPER, borderRadius: 16, boxShadow: "0 3px 10px rgba(0,0,0,0.14)", padding: 16 }}>
      <div style={{ border: `3px solid ${INK}`, borderRadius: 10, height: 120, background: GOLD, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
        <svg width={48} height={48} viewBox="0 0 40 40">
          <circle cx={20} cy={20} r={17} fill="none" stroke={CREAM} strokeWidth={3} />
          <circle cx={20} cy={20} r={9} fill="none" stroke={CREAM} strokeWidth={3} />
          <circle cx={20} cy={20} r={2.5} fill={CREAM} />
        </svg>
      </div>
      {WM_CARDS.map((c) => {
        const active = wants.includes(c.key);
        return (
          <button key={c.key} type="button" onClick={() => onToggle(c.key)}
            style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", cursor: "pointer",
              background: active ? INK : PAPER, border: `2px solid ${INK}`, borderRadius: 9, padding: "13px 15px", marginBottom: 9 }}>
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: active ? PAPER : INK }}>
              {active ? `✓ ${c.mobile}` : c.mobile}
            </span>
          </button>
        );
      })}
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

export default function SetStrategyPage() {
  const [rosterId, setRosterId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const pmRef = useRef<HTMLDivElement>(null);
  const [pmIdx, setPmIdx] = useState(0);

  useEffect(() => {
    const { rosterId: rid = "" } = readStoredTeam();
    setRosterId(rid);
  }, []);

  useEffect(() => {
    if (!rosterId) return;
    fetch(`/api/research-strategy/strategy?teamId=${encodeURIComponent(rosterId)}`)
      .then((r) => r.json())
      .then((j) => { if (j?.data) setProfile(j.data as Profile); })
      .catch(() => {});
  }, [rosterId]);

  const save = useCallback((next: Profile) => {
    if (!rosterId) return;
    fetch("/api/research-strategy/strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: rosterId, profile: next }),
    }).catch(() => {});
  }, [rosterId]);

  const setMarket = (key: MarketKey, value: Market) => {
    setProfile((prev) => { if (!prev) return prev; const next = { ...prev, [key]: value }; save(next); return next; });
  };
  const toggleWant = (k: string) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const has = prev.wants_more.includes(k);
      const next = { ...prev, wants_more: has ? prev.wants_more.filter((x) => x !== k) : [...prev.wants_more, k] };
      save(next); return next;
    });
  };

  const wants = profile?.wants_more ?? [];

  return (
    <div style={{ minHeight: "100vh", background: CREAM }}>
      <style>{CSS}</style>
      <InnerTopbar breadcrumb="SET STRATEGY" />
      <div style={{ height: 3, background: RED }} />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 20px 60px" }}>
        <DirectorTwoBox avatarSrc="/avatars/strategy.png" label="Strategy Director" message={TWO_BOX_MSG} />

        {!profile ? (
          <p style={{ fontFamily: mono, fontSize: 12, color: MUTED, marginTop: 24 }}>Loading…</p>
        ) : (
          <>
            <div style={{ marginTop: 26 }}>
              <Divider label="WHERE WE STAND" />
              <div
                className="ss-pm"
                ref={pmRef}
                onScroll={(e) => setPmIdx(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
              >
                {PM_CARDS.map((c) => (
                  <PMCard key={c.key} value={profile[c.key]} lines={c.lines} onSet={(m) => setMarket(c.key, m)} />
                ))}
              </div>
              <div className="ss-pm-dots">
                {PM_CARDS.map((c, i) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-label={`Card ${i + 1}`}
                    onClick={() => pmRef.current?.scrollTo({ left: i * pmRef.current.clientWidth, behavior: "smooth" })}
                    style={{ width: 9, height: 9, borderRadius: 9, padding: 0, cursor: "pointer",
                      border: "none", background: i === pmIdx ? INK : MUTEDB }}
                  />
                ))}
              </div>
            </div>

            <div style={{ marginTop: 34 }}>
              <Divider label="WHERE WE'RE HEADED" />
              <div className="ss-wm-d">
                {WM_CARDS.map((c) => (
                  <WMCard key={c.key} card={c} on={wants.includes(c.key)} onSet={(v) => { if (v !== wants.includes(c.key)) toggleWant(c.key); }} />
                ))}
              </div>
              <div className="ss-wm-m">
                <WMMobileCard wants={wants} onToggle={toggleWant} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}