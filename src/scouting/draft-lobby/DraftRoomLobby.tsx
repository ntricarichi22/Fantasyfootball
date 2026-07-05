"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";

type Phase = "pre-day-one" | "between" | "complete";
type Calendar = {
  phase: Phase;
  dayOneComplete: boolean;
  dayTwoComplete: boolean;
  season: number;
  teamCount: number;
  upcomingDraftAt: string | null;
};

// Page shell.
const CANVAS = "#F5F0E6";
// Vintage draft-wing tokens — same vocabulary as the Mock Draft scoreboard.
const FRAME = "#E6D9BD", BINK = "#161310", GREEN = "#235440", HGREEN = "#1d4536";
const PLACARD = "#EDE3CD", SCREAM = "#F3ECD9", GOLD = "#E9C46A", ARED = "#C9442E", META = "#6f6450", GSUB = "#3a6b56";
const RECESS2 = "#1e1a15", FADE = "#b9ab8d";
const ANTON = "'Anton', sans-serif", OSWALD = "'Oswald', sans-serif";

// Per-phase credential content. "Mock" is the only live destination for now;
// View Day One / Review and the live War Room are flagged coming-soon.
function heroFor(cal: Calendar): { eyebrow: string; title: string; sub: string; mockLabel: string | null; secondLabel: string | null; secondDesc: string } {
  if (cal.phase === "pre-day-one") {
    return { eyebrow: "Up next", title: "Day One", sub: "Round 1", mockLabel: "Mock Day One", secondLabel: null, secondDesc: "" };
  }
  if (cal.phase === "between") {
    return { eyebrow: "Up next", title: "Day Two", sub: "Rounds 2 & 3", mockLabel: "Mock Day Two", secondLabel: "View Day One", secondDesc: "Round 1 results from this year" };
  }
  return { eyebrow: `${cal.season} season`, title: "Draft Complete", sub: "Day One + Day Two", mockLabel: null, secondLabel: "Review Results", secondDesc: "Full league board, Day One + Day Two" };
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
  // The war room goes hot once the scheduled start has passed (and the draft isn't over).
  const draftLive = !!cal?.upcomingDraftAt && new Date(cal.upcomingDraftAt).getTime() <= Date.now() && cal.phase !== "complete";

  // The bill headline stacks one word per line; size to the longest word.
  const words = (hero?.title ?? "").toUpperCase().split(" ");
  const maxLen = Math.max(...words.map((w) => w.length), 1);
  const billSize = maxLen <= 4 ? 88 : maxLen <= 6 ? 60 : 42;

  // Poster-justify a row: characters spread edge to edge across the bill.
  const spread = (text: string, style: CSSProperties) => (
    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", ...style }}>
      {text.split("").map((c, i) => <span key={i}>{c === " " ? " " : c}</span>)}
    </div>
  );

  // One tin plate on the felt. Modes: live (cream, red ENTER), hot (the war
  // room gone live — red + flashing), locked (dimmed, gold status tag),
  // teaser (dimmed, SOON rivet).
  function plate(p: { num: string; title: string; desc: string; mode: "live" | "hot" | "locked" | "teaser"; href?: string; tag?: string; cta?: string }) {
    const dim = p.mode === "locked" || p.mode === "teaser";
    const inner = (
      <div style={{
        height: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 15, minHeight: 66, overflow: "hidden",
        background: p.mode === "hot" ? ARED : dim ? "#d8cdb1" : PLACARD,
        border: `2px solid ${dim ? "#57503f" : BINK}`, borderRadius: 3,
        boxShadow: dim ? "0 1px 3px rgba(0,0,0,0.35)" : "0 2px 4px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.7)",
        padding: "12px 16px 12px 0", opacity: dim ? 0.82 : 1,
        animation: p.mode === "hot" ? "lobbyHot 1.1s ease-in-out infinite" : "none",
      }}>
        <div style={{ alignSelf: "stretch", flexShrink: 0, width: 58, display: "flex", alignItems: "center", justifyContent: "center", background: dim ? META : BINK, color: p.mode === "hot" ? SCREAM : dim ? PLACARD : GOLD, fontFamily: ANTON, fontSize: 19 }}>{p.num}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: ANTON, fontSize: 21, letterSpacing: 0.5, color: p.mode === "hot" ? SCREAM : dim ? META : GREEN, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title.toUpperCase()}</div>
          <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 12.5, letterSpacing: 0.4, color: p.mode === "hot" ? "#f4cfc5" : dim ? "#857a62" : GSUB, marginTop: 4 }}>{p.desc}</div>
        </div>
        {p.mode === "live" && <span style={{ flexShrink: 0, fontFamily: ANTON, fontSize: 12, letterSpacing: 1, color: SCREAM, background: ARED, border: `2px solid ${BINK}`, borderRadius: 2, padding: "8px 15px" }}>{p.cta ?? "ENTER ›"}</span>}
        {p.mode === "hot" && <span style={{ flexShrink: 0, fontFamily: ANTON, fontSize: 12, letterSpacing: 1, color: ARED, background: SCREAM, border: `2px solid ${BINK}`, borderRadius: 2, padding: "8px 15px", animation: "lobbyBlink 1s steps(2) infinite" }}>WE&rsquo;RE LIVE ›</span>}
        {p.mode === "locked" && <span style={{ flexShrink: 0, fontFamily: ANTON, fontSize: 10, letterSpacing: 1.5, color: GOLD, background: BINK, borderRadius: 2, padding: "5px 10px" }}>{p.tag ?? "LOCKED"}</span>}
        {p.mode === "teaser" && <span style={{ flexShrink: 0, fontFamily: ANTON, fontSize: 10, letterSpacing: 1.5, color: GOLD, background: BINK, borderRadius: 2, padding: "5px 10px" }}>SOON</span>}
      </div>
    );
    return p.href ? (
      <a key={p.num} href={p.href} style={{ textDecoration: "none", display: "block", flex: 1 }}>{inner}</a>
    ) : (
      <div key={p.num} style={{ flex: 1 }}>{inner}</div>
    );
  }

  const plates: ReactNode[] = [];
  if (hero && cal) {
    plates.push(plate(
      draftLive
        ? { num: "01", title: "Enter Live Draft", desc: "The war room is open — all 12 seats on the clock", mode: "hot", href: "/scouting/draft-room/live" }
        : { num: "01", title: "Enter Live Draft", desc: "The war room — all 12 seats, real picks", mode: "locked", tag: live ? `OPENS IN ${live}` : "OPENS DRAFT DAY" }
    ));
    if (hero.mockLabel) plates.push(plate({ num: "02", title: hero.mockLabel, desc: "Practice the run — the engine drives the other 11 seats", mode: "live", href: "/scouting/mock-draft" }));
    if (hero.secondLabel) {
      const num = hero.mockLabel ? "03" : "02";
      // Between days, Day One results are live on the war-room board. The
      // complete-phase "Review Results" waits on the review feature.
      plates.push(plate(
        cal.phase === "between"
          ? { num, title: hero.secondLabel, desc: hero.secondDesc, mode: "live", href: "/scouting/draft-room/live", cta: "VIEW ›" }
          : { num, title: hero.secondLabel, desc: hero.secondDesc, mode: "teaser" }
      ));
    }
    plates.push(plate({ num: String(plates.length + 1).padStart(2, "0"), title: "View Past Draft Results", desc: "The archive — every season, every round", mode: "teaser" }));
  }

  return (
    <div style={{ minHeight: "100vh", background: CANVAS, display: "flex", flexDirection: "column" }}>
      <UnifiedTopbar />
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&display=swap');@keyframes lobbyHot{0%,100%{box-shadow:0 0 0 3px rgba(201,68,46,.55),0 2px 4px rgba(0,0,0,.45)}50%{box-shadow:0 0 0 1px rgba(201,68,46,.15),0 2px 4px rgba(0,0,0,.45)}}@keyframes lobbyBlink{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

      <div style={{ maxWidth: 1180, width: "100%", margin: "0 auto", padding: "14px 22px 20px", boxSizing: "border-box", flex: 1, display: "flex", flexDirection: "column" }}>

        {/* ── ONE CREAM PANEL — everything lives on the felt ── */}
        <div style={{ position: "relative", background: FRAME, border: `3px solid ${BINK}`, borderRadius: 5, boxShadow: `9px 9px 0 ${BINK}`, padding: 15, flex: 1, display: "flex", flexDirection: "column" }}>
          {([["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const).map(([v, h]) => (
            <div key={v + h} style={{ position: "absolute", [v]: 7, [h]: 7, width: 9, height: 9, borderRadius: "50%", background: BINK, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.25)", zIndex: 5 }} />
          ))}

          <div style={{ flex: 1, display: "flex", flexDirection: "column", border: `3px solid ${BINK}`, borderRadius: 3, overflow: "hidden", background: GREEN, backgroundImage: "repeating-linear-gradient(91deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 2px, transparent 2px, transparent 6px)", boxShadow: "inset 0 0 0 2px rgba(233,220,189,0.5), inset 0 0 60px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "8px 14px", background: HGREEN, borderBottom: `3px solid ${BINK}`, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/cfc-logo.png" alt="CFC" style={{ height: 38, width: "auto", flexShrink: 0, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }} />
                <span style={{ fontFamily: ANTON, fontSize: 22, letterSpacing: 3, color: SCREAM, whiteSpace: "nowrap" }}>DRAFT LOBBY</span>
              </div>
              <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 11, letterSpacing: 2.5, color: FADE, whiteSpace: "nowrap" }}>
                {cal ? `${cal.season} CFC DRAFT` : "…"} <span style={{ color: "#557d6b" }}>·</span> FRONT OFFICE
              </span>
            </div>

            {!hero || !cal ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 42, fontFamily: OSWALD, fontWeight: 600, fontSize: 13, letterSpacing: 2, color: SCREAM }}>READING THE DRAFT CALENDAR…</div>
            ) : (
              <div style={{ flex: 1, display: "flex", gap: 20, flexWrap: "wrap", padding: 20 }}>

                  {/* The bill — draft-week poster, full height of the plate stack:
                      eyebrow pinned top, headline centered, round chip pinned bottom. */}
                  <div style={{ flexShrink: 0, width: 272, display: "flex", flexDirection: "column" }}>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "space-between", background: RECESS2, backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 2px, transparent 2px, transparent 5px)", border: `3px solid ${BINK}`, borderRadius: 3, boxShadow: "0 3px 6px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(233,196,106,0.35)", padding: "22px 16px", textAlign: "center" }}>
                      {spread(hero.eyebrow.toUpperCase(), { fontFamily: ANTON, fontSize: 24, color: GOLD, borderBottom: "2.5px solid rgba(233,196,106,0.45)", paddingBottom: 12 })}
                      <div style={{ padding: "18px 0" }}>
                        {words.map((w) => (
                          <div key={w} style={{ fontFamily: ANTON, fontSize: billSize, lineHeight: 0.96, color: SCREAM, textShadow: "3px 3px 0 rgba(0,0,0,0.55)", textAlign: "center" }}>{w}</div>
                        ))}
                      </div>
                      <div>
                        <div style={{ boxSizing: "border-box", width: "100%", textAlign: "center", fontFamily: ANTON, fontSize: 15, letterSpacing: 2, color: BINK, background: GOLD, border: `2px solid ${BINK}`, padding: "6px 0" }}>{hero.sub.toUpperCase()}</div>
                        {live && (
                          <div style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 2, color: GOLD, marginTop: 9 }}>LIVE IN {live}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Every door on one stack of tin plates */}
                  <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 10 }}>
                    {plates}
                  </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
