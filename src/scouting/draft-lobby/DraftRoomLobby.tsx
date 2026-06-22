"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { Icon } from "@/shared/ui/Icon";

type Phase = "pre-day-one" | "between" | "complete";
type Calendar = {
  phase: Phase;
  dayOneComplete: boolean;
  dayTwoComplete: boolean;
  season: number;
  teamCount: number;
  upcomingDraftAt: string | null;
};

const INK = "#1A1A1A";
const CANVAS = "#F5F0E6";
const CARD = "#FEFCF9";
const MUTED = "#8C7E6A";
const RED = "#E8503A";
const YELLOW = "#F5C230";
const BLUE = "#3366CC";

const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "var(--font-body, 'DM Sans', sans-serif)";

// Per-phase credential content. "Mock" is the only live destination for now;
// View Day One / Review and the live War Room are flagged coming-soon.
function heroFor(cal: Calendar): { eyebrow: string; title: string; sub: string; mockLabel: string | null; secondLabel: string | null } {
  if (cal.phase === "pre-day-one") {
    return { eyebrow: "Up next", title: "Day One", sub: "Round 1", mockLabel: "Mock Day One", secondLabel: null };
  }
  if (cal.phase === "between") {
    return { eyebrow: "Up next", title: "Day Two", sub: "Rounds 2 & 3", mockLabel: "Mock Day Two", secondLabel: "View Day One" };
  }
  return { eyebrow: `${cal.season} season`, title: "Draft Complete", sub: "Day One + Day Two", mockLabel: null, secondLabel: "Review Results" };
}

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(target) || target <= now) return null;
  const mins = Math.floor((target - now) / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return `${d}d ${String(h).padStart(2, "0")}h`;
}

export function DraftRoomLobby() {
  const [cal, setCal] = useState<Calendar | null>(null);

  useEffect(() => {
    fetch("/api/scouting/draft-calendar")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("calendar"))))
      .then((j: Calendar) => setCal(j))
      .catch(() =>
        setCal({ phase: "between", dayOneComplete: true, dayTwoComplete: false, season: new Date().getFullYear(), teamCount: 12, upcomingDraftAt: null })
      );
  }, []);

  const hero = cal ? heroFor(cal) : null;
  const live = countdown(cal?.upcomingDraftAt ?? null);

  const credential: CSSProperties = { background: CARD, border: `3px solid ${INK}`, boxShadow: `6px 6px 0 ${INK}`, overflow: "hidden" };
  const comingTag = (
    <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 9, letterSpacing: "0.1em", color: MUTED, background: "#EDE5D4", border: `1.5px solid ${MUTED}`, padding: "2px 6px" }}>SOON</span>
  );

  function row(num: string, numBg: string, numFg: string, title: string, desc: string, href: string | null) {
    const active = !!href;
    const inner = (
      <div style={{ display: "flex", alignItems: "center", gap: 11, background: active ? "#FBF7EC" : "#F3EEE2", border: `2.5px solid ${active ? INK : "#C8C3B8"}`, padding: "10px 12px", opacity: active ? 1 : 0.85 }}>
        <span style={{ flexShrink: 0, width: 32, height: 32, background: active ? numBg : "#C8C3B8", border: `1.5px solid ${INK}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FH, fontWeight: 800, fontSize: 15, color: active ? numFg : "#fff" }}>{num}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 17, letterSpacing: "0.01em", color: INK, lineHeight: 1 }}>{title}</div>
          <div style={{ fontFamily: FB, fontSize: 12, color: MUTED, marginTop: 3 }}>{desc}</div>
        </div>
        {active ? <Icon name="chevron-right" size={18} /> : comingTag}
      </div>
    );
    return active ? (
      <a href={href!} style={{ textDecoration: "none", display: "block" }}>{inner}</a>
    ) : (
      <div>{inner}</div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: CANVAS, display: "flex", flexDirection: "column" }}>
      <UnifiedTopbar />

      <div style={{ maxWidth: 720, width: "100%", margin: "0 auto", padding: "20px 16px 36px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13, padding: "0 2px" }}>
          <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 15, letterSpacing: "0.04em", color: INK }}>SCOUTING <span style={{ color: MUTED }}>· DRAFT ROOM</span></span>
          <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 12, letterSpacing: "0.08em", color: RED }}>{cal ? `${cal.season} SEASON` : "…"}</span>
        </div>

        {!hero || !cal ? (
          <div style={{ ...credential, padding: 40, textAlign: "center", fontFamily: FM, fontSize: 12, color: MUTED }}>Reading the draft calendar…</div>
        ) : (
          <div style={credential}>
            {/* Header bar */}
            <div style={{ background: INK, margin: 9, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 19, letterSpacing: "0.03em", color: YELLOW, lineHeight: 1 }}>{cal.season} CFC DRAFT</div>
                <div style={{ fontFamily: FM, fontWeight: 700, fontSize: 10, letterSpacing: "0.18em", color: "#9b9384", marginTop: 3 }}>FRONT OFFICE · WAR ROOM</div>
              </div>
              <div style={{ width: 34, height: 40, background: RED, border: `2px solid ${YELLOW}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FH, fontWeight: 800, fontSize: 12, color: "#fff" }}>CFC</div>
            </div>

            <div style={{ display: "flex", gap: 13, padding: "4px 13px 0" }}>
              {/* Emblem */}
              <div style={{ flexShrink: 0, width: 120 }}>
                <div style={{ background: RED, border: `3px solid ${INK}`, padding: "12px 8px", textAlign: "center" }}>
                  <div style={{ fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.14em", color: "#fff", opacity: 0.9 }}>{hero.eyebrow.toUpperCase()}</div>
                  <div style={{ fontFamily: FH, fontWeight: 800, fontSize: hero.title.length > 8 ? 22 : 34, lineHeight: 0.92, color: "#fff", margin: "4px 0", textTransform: "uppercase" }}>{hero.title}</div>
                  <div style={{ display: "inline-block", fontFamily: FH, fontWeight: 800, fontSize: 11, letterSpacing: "0.02em", color: INK, background: YELLOW, padding: "2px 7px", marginTop: 2 }}>{hero.sub.toUpperCase()}</div>
                </div>
                {live && <div style={{ textAlign: "center", fontFamily: FM, fontWeight: 700, fontSize: 10, color: MUTED, marginTop: 7 }}>LIVE IN {live}</div>}
              </div>

              {/* Actions */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ alignSelf: "flex-start", fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: "#fff", background: INK, padding: "3px 9px" }}>WHAT YOU CAN DO</span>
                {hero.mockLabel && row("01", RED, "#fff", hero.mockLabel, "Practice the run — AI fills the other 11 seats", "/scouting/mock-draft")}
                {hero.secondLabel && row("02", INK, YELLOW, hero.secondLabel, cal.phase === "complete" ? "Full league board, Day One + Day Two" : "Round 1 results from this year", null)}
              </div>
            </div>

            {/* Footer — live war room (deferred wiring) */}
            <div style={{ background: INK, margin: "11px 9px 9px", padding: "13px 15px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 18, letterSpacing: "0.04em", color: "#7c7568", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="square" size={15} /> ENTER THE WAR ROOM
              </span>
              <span style={{ fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", color: YELLOW, background: "rgba(245,194,48,0.14)", padding: "4px 9px" }}>
                {live ? `LOCKED · ${live}` : "OPENS DRAFT DAY"}
              </span>
            </div>
          </div>
        )}

        {/* Archive (deferred — Review feature) */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 2px 11px" }}>
          <span style={{ fontFamily: FH, fontWeight: 700, fontSize: 11, letterSpacing: "0.12em", color: "#fff", background: INK, padding: "4px 10px" }}>THE ARCHIVE</span>
          <span style={{ fontFamily: FB, fontSize: 11, color: MUTED }}>past seasons — full results, every round</span>
        </div>
        <div style={{ background: CARD, border: `2.5px solid #C8C3B8`, padding: "18px 16px", textAlign: "center", fontFamily: FM, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: MUTED }}>
          UNLOCKS WITH THE REVIEW FEATURE
        </div>

        <div style={{ marginTop: 14, textAlign: "center" }}>
          <span style={{ fontFamily: FB, fontSize: 11, color: MUTED }}>Looking for last year&rsquo;s war room? The live draft moved to </span>
          <a href="/scouting/draft-room/live" style={{ fontFamily: FB, fontWeight: 700, fontSize: 11, color: BLUE }}>the War Room ›</a>
        </div>
      </div>
    </div>
  );
}
