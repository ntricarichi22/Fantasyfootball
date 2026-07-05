"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { teamNickname } from "@/shared/league-data/nicknames";

type Phase = "pre-day-one" | "between" | "complete";
type Calendar = {
  phase: Phase;
  dayOneComplete: boolean;
  dayTwoComplete: boolean;
  season: number;
  teamCount: number;
  upcomingDraftAt: string | null;
  teams?: { rosterId: string; name: string }[];
};

// Mock-setup choices, passed to /scouting/mock-draft as query params. Display
// names are the lobby's; the engine keys underneath are unchanged.
type Scenario = "standard" | "qb-run" | "rb-run" | "wr-run" | "chalk";
const SCENARIOS: { key: Scenario; label: string; desc: string }[] = [
  { key: "standard", label: "How I See It", desc: "How I actually expect the league to draft — needs, fits, and tendencies all baked in." },
  { key: "qb-run", label: "QB Heavy", desc: "See what an early run on quarterbacks looks like and who would fall to us." },
  { key: "rb-run", label: "RB Heavy", desc: "See what an early run on running backs looks like and who would fall to us." },
  { key: "wr-run", label: "WR Heavy", desc: "See what an early run on receivers looks like and who would fall to us." },
  { key: "chalk", label: "Chalk", desc: "Every seat takes the best player left. No needs, no reaches — the purest value board there is." },
];
const SPEEDS: { label: string; seconds: number }[] = [
  { label: "Relaxed", seconds: 20 },
  { label: "Steady", seconds: 10 },
  { label: "Quick", seconds: 5 },
];

const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, "-");
const logoFor = (teamName: string) => `/teams/${slugify(teamNickname(teamName))}.png`;

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

  // Mock-setup modal: scenario, clock speed, and which seats you drive.
  const [setupOpen, setSetupOpen] = useState(false);
  const [scn, setScn] = useState<Scenario>("standard");
  const [speed, setSpeed] = useState(10);
  const [seats, setSeats] = useState<Set<string>>(() => {
    const id = readStoredTeam().rosterId;
    return new Set(id ? [id] : []);
  });

  useEffect(() => {
    fetch("/api/scouting/draft-calendar")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("calendar"))))
      .then((j: Calendar) => setCal(j))
      .catch(() =>
        setCal({ phase: "between", dayOneComplete: true, dayTwoComplete: false, season: new Date().getFullYear(), teamCount: 12, upcomingDraftAt: null, teams: [] })
      );
  }, []);

  // The identity cookie is client-only — re-read after mount so your own seat
  // starts selected even when the first render ran before hydration.
  useEffect(() => {
    const id = readStoredTeam().rosterId;
    if (id) setSeats((prev) => (prev.size === 0 ? new Set([id]) : prev));
  }, []);

  function toggleSeat(id: string) {
    setSeats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startMock() {
    const qp = new URLSearchParams({ scenario: scn, speed: String(speed), control: [...seats].join(",") });
    window.location.href = `/scouting/mock-draft?${qp.toString()}`;
  }

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
  function plate(p: { num: string; title: string; desc: string; mode: "live" | "hot" | "locked" | "teaser"; href?: string; onClick?: () => void; tag?: string; cta?: string }) {
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
    if (p.href) {
      return <a key={p.num} href={p.href} style={{ textDecoration: "none", display: "block", flex: 1 }}>{inner}</a>;
    }
    if (p.onClick) {
      return (
        <div
          key={p.num}
          role="button"
          tabIndex={0}
          onClick={p.onClick}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") p.onClick?.(); }}
          style={{ flex: 1, cursor: "pointer" }}
        >
          {inner}
        </div>
      );
    }
    return <div key={p.num} style={{ flex: 1 }}>{inner}</div>;
  }

  const plates: ReactNode[] = [];
  if (hero && cal) {
    plates.push(plate(
      draftLive
        ? { num: "01", title: "Enter Live Draft", desc: "The war room is open — all 12 seats on the clock", mode: "hot", href: "/scouting/draft-room/live" }
        : { num: "01", title: "Enter Live Draft", desc: "The war room — all 12 seats, real picks", mode: "locked", tag: live ? `OPENS IN ${live}` : "OPENS DRAFT DAY" }
    ));
    if (hero.mockLabel) plates.push(plate({ num: "02", title: hero.mockLabel, desc: "Practice the run — pick your seats, speed, and scenario", mode: "live", onClick: () => setSetupOpen(true) }));
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

      {/* ── Mock setup — scenario, clock speed, and the seats you drive ── */}
      {setupOpen && hero?.mockLabel && cal && (
        <div
          onClick={() => setSetupOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(22,19,16,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "relative", width: 660, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box", background: FRAME, border: `3px solid ${BINK}`, borderRadius: 5, boxShadow: `9px 9px 0 ${BINK}`, padding: 13 }}
          >
            {([["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const).map(([v, h]) => (
              <div key={v + h} style={{ position: "absolute", [v]: 7, [h]: 7, width: 9, height: 9, borderRadius: "50%", background: BINK, boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.25)" }} />
            ))}

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: RECESS2, border: `2.5px solid ${BINK}`, borderRadius: 3, padding: "10px 14px" }}>
              <div>
                <div style={{ fontFamily: ANTON, fontSize: 19, letterSpacing: 1.5, color: SCREAM }}>{hero.mockLabel.toUpperCase()}</div>
                <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 10.5, letterSpacing: 2, color: FADE, marginTop: 3 }}>SET THE TABLE, THEN WE&rsquo;RE ON THE CLOCK</div>
              </div>
              <button
                onClick={() => setSetupOpen(false)}
                aria-label="Close"
                style={{ fontFamily: ANTON, fontSize: 14, color: FADE, background: "transparent", border: `2px solid #4a4135`, borderRadius: 2, padding: "4px 9px", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            {/* Scenario — full-width band, then description tiles */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: GREEN, border: `2px solid ${BINK}`, borderRadius: 2, padding: "6px 12px", marginTop: 13 }}>
              <span style={{ fontFamily: ANTON, fontSize: 12, letterSpacing: 2, color: SCREAM }}>SCENARIO</span>
              <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 1.5, color: GOLD, whiteSpace: "nowrap" }}>{SCENARIOS.find((s) => s.key === scn)?.label.toUpperCase()}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
              {SCENARIOS.map((s) => {
                const on = scn === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setScn(s.key)}
                    style={{ textAlign: "left", background: on ? BINK : PLACARD, border: `2px solid ${BINK}`, borderRadius: 3, boxShadow: on ? `2px 2px 0 rgba(22,19,16,0.4)` : "0 1px 2px rgba(0,0,0,0.25)", padding: "10px 11px", cursor: "pointer" }}
                  >
                    <div style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.5, color: on ? GOLD : GREEN }}>{s.label.toUpperCase()}</div>
                    <div style={{ fontFamily: OSWALD, fontWeight: 500, fontSize: 11.5, lineHeight: 1.35, color: on ? "#cfc4a8" : META, marginTop: 4 }}>{s.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Speed — full-width band, then three tiles */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: GREEN, border: `2px solid ${BINK}`, borderRadius: 2, padding: "6px 12px", marginTop: 13 }}>
              <span style={{ fontFamily: ANTON, fontSize: 12, letterSpacing: 2, color: SCREAM }}>CLOCK SPEED</span>
              <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 11, letterSpacing: 1.5, color: GOLD, whiteSpace: "nowrap" }}>{SPEEDS.find((s) => s.seconds === speed)?.label.toUpperCase()} · {speed}S</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
              {SPEEDS.map((s) => {
                const on = speed === s.seconds;
                return (
                  <button
                    key={s.seconds}
                    onClick={() => setSpeed(s.seconds)}
                    style={{ textAlign: "center", background: on ? BINK : PLACARD, border: `2px solid ${BINK}`, borderRadius: 3, boxShadow: on ? `2px 2px 0 rgba(22,19,16,0.4)` : "0 1px 2px rgba(0,0,0,0.25)", padding: "9px 10px", cursor: "pointer" }}
                  >
                    <div style={{ fontFamily: ANTON, fontSize: 15, letterSpacing: 0.5, color: on ? GOLD : GREEN }}>{s.label.toUpperCase()}</div>
                    <div style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 11, color: on ? "#cfc4a8" : META, marginTop: 2 }}>{s.seconds}s per pick</div>
                  </button>
                );
              })}
            </div>

            {/* Seats — full-width band, then the 12-team grid */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: GREEN, border: `2px solid ${BINK}`, borderRadius: 2, padding: "6px 12px", marginTop: 13 }}>
              <span style={{ fontFamily: ANTON, fontSize: 12, letterSpacing: 2, color: SCREAM }}>YOU CONTROL</span>
              <span style={{ fontFamily: OSWALD, fontWeight: 600, fontSize: 11, color: "#9fc4ae", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>the engine drafts every seat you leave off — flag none to just watch</span>
            </div>
            {(cal.teams ?? []).length === 0 ? (
              <div style={{ marginTop: 8, fontFamily: OSWALD, fontWeight: 600, fontSize: 12, color: META, background: PLACARD, border: `2px solid ${BINK}`, borderRadius: 3, padding: "10px 12px" }}>
                Seat list unavailable — you&rsquo;ll drive your own team.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 7, marginTop: 8 }}>
                {(cal.teams ?? []).map((t) => {
                  const on = seats.has(t.rosterId);
                  return (
                    <button
                      key={t.rosterId}
                      onClick={() => toggleSeat(t.rosterId)}
                      style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", background: on ? BINK : PLACARD, border: `2px solid ${BINK}`, borderRadius: 3, boxShadow: on ? `2px 2px 0 rgba(22,19,16,0.4)` : "0 1px 2px rgba(0,0,0,0.25)", cursor: "pointer", textAlign: "left", minWidth: 0 }}
                    >
                      <div style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${on ? GOLD : BINK}`, background: `#fff url('${logoFor(t.name)}') center / cover`, flexShrink: 0 }} />
                      <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 12, color: on ? SCREAM : GREEN, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{teamNickname(t.name)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 15 }}>
              <span style={{ fontFamily: OSWALD, fontWeight: 700, fontSize: 12, letterSpacing: 0.5, color: META }}>
                {seats.size === 0 ? "SPECTATING — THE ENGINE RUNS ALL 12" : `${seats.size} SEAT${seats.size === 1 ? "" : "S"} YOURS`}
              </span>
              <button
                onClick={startMock}
                style={{ fontFamily: ANTON, fontSize: 14, letterSpacing: 1.5, color: BINK, background: GOLD, border: `2px solid ${BINK}`, borderRadius: 3, boxShadow: `3px 3px 0 ${BINK}`, padding: "10px 24px", cursor: "pointer" }}
              >
                START THE MOCK ›
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
