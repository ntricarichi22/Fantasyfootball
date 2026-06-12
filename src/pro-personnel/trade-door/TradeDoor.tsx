"use client";

// The "Build a Trade" DOOR (director_office.md): clicking Build a Trade lands
// in the Personnel Director's chat, not a landing page. He frames the team's
// storyline(s) — one clear path, or a genuine fork ("your plan" vs "what the
// roster is telling me") — and presents each storyline's GOALS as tappable
// CTAs. Tapping a goal opens the offer drawer (right half on desktop, bottom
// sheet on mobile) with the vetted deals behind that goal.
//
// Latency choreography: the room opens on the fast storylines endpoint while
// the offer slate generates in the background — CTAs read "working the
// phones…" until it lands, then show live counts. A goal only stays on the
// board if real offers survive behind it. PASS is on the deal, not the
// framing: a passed offer disappears from every goal. The escape hatch to the
// manual builder is always one tap away.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import OfferDrawer, { type DoorOffer, type AdvisorState, type AdvisorRosterPayload } from "./OfferDrawer";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

const AVATAR = "/avatars/pro-personnel.png";

// ─── Types ──────────────────────────────────────────────────────────────

type StoryGoal = { id: string; kind: string; bucket: string | null; label: string; teaser: string };
type StoryThesis = {
  id: string; source: "intent" | "engine"; timeline: string;
  headline: string; pitch: string; goals: StoryGoal[];
};
type Storylines = {
  teamName: string;
  identity: string;
  theses: StoryThesis[];
  director: { opening: string; args: Record<string, string> };
};

type RawClientAsset = {
  key: string; name: string; meta?: string; rosterMeta?: string;
  position?: string; posGroup?: string; tier?: string; value?: number;
  type?: "player" | "pick"; isStud?: boolean; isYouth?: boolean;
};

type SlateResponse = {
  theses?: Array<{ id: string; offers: DoorOffer[] }>;
  reason: "ok" | "no_strategy" | "no_clean_offers";
};

// ─── Small chat pieces ──────────────────────────────────────────────────

function DirectorMsg({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
      <img src={AVATAR} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, letterSpacing: "0.16em", color: "#8C7E6A", textTransform: "uppercase", marginBottom: 5 }}>
          Personnel director
        </div>
        <div style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", padding: "14px 16px", fontSize: 13, lineHeight: 1.55, fontFamily: F, color: "#1A1A1A" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────

export default function TradeDoor() {
  const { rosterId = "", teamName = "" } = readStoredTeam();
  const isMobile = useIsMobile();

  const [story, setStory] = useState<Storylines | null>(null);
  const [storyError, setStoryError] = useState(false);
  const [slateReason, setSlateReason] = useState<"loading" | "ok" | "no_strategy" | "no_clean_offers" | "error">("loading");
  const [offersByGoal, setOffersByGoal] = useState<Map<string, DoorOffer[]>>(new Map());
  const [allRosters, setAllRosters] = useState<Record<string, RawClientAsset[]>>({});
  const [passedIds, setPassedIds] = useState<Set<string>>(new Set());
  const [chosenThesis, setChosenThesis] = useState<string | null>(null);
  const [drawerGoal, setDrawerGoal] = useState<StoryGoal | null>(null);
  const [advisorByOffer, setAdvisorByOffer] = useState<AdvisorState>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // Fast half: the room opens on the narrative bundle.
  useEffect(() => {
    if (!rosterId) return;
    let cancelled = false;
    fetch(`/api/pro-personnel/storylines?team_id=${encodeURIComponent(rosterId)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j?.theses) {
          setStory(j);
          if (j.theses.length === 1) setChosenThesis(j.theses[0].id);
        } else setStoryError(true);
      })
      .catch(() => { if (!cancelled) setStoryError(true); });
    return () => { cancelled = true; };
  }, [rosterId]);

  // Slow half: the slate generates while he talks.
  useEffect(() => {
    if (!rosterId) return;
    let cancelled = false;
    (async () => {
      try {
        const targetsJson = await (await fetch(`/api/pro-personnel/targets?teamId=${encodeURIComponent(rosterId)}`)).json();
        if (cancelled) return;
        const rosters: Record<string, RawClientAsset[]> = targetsJson.rosters ?? {};
        setAllRosters(rosters);
        const names: Record<string, string> = {};
        for (const [tid, assets] of Object.entries(rosters)) {
          names[tid] = (assets as { teamName?: string }[])[0]?.teamName ?? `Team ${tid}`;
        }
        if (teamName) names[rosterId] = teamName;

        const slate = await (await fetch("/api/pro-personnel/trade-builder/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_id: rosterId, rosters, team_names: names }),
        })).json() as SlateResponse;
        if (cancelled) return;

        const byGoal = new Map<string, DoorOffer[]>();
        const seen = new Set<string>();
        for (const th of slate.theses ?? []) {
          for (const o of th.offers ?? []) {
            const gid = o.goalId ?? `${th.id}:${o.narrative ?? "misc"}`;
            const arr = byGoal.get(gid) ?? [];
            // The same deal can serve two goals — show it under both, but a
            // PASS later removes it everywhere (handled at render).
            if (!arr.some(x => x.id === o.id)) arr.push(o);
            byGoal.set(gid, arr);
            seen.add(o.id);
          }
        }
        setOffersByGoal(byGoal);
        setSlateReason(slate.reason ?? "no_clean_offers");
      } catch {
        if (!cancelled) setSlateReason("error");
      }
    })();
    return () => { cancelled = true; };
  }, [rosterId, teamName]);

  // Advisor payload (same shape the editor/cycler used).
  const rosterPayload = useMemo<AdvisorRosterPayload>(() => {
    const payload: AdvisorRosterPayload = {};
    for (const [tid, assets] of Object.entries(allRosters)) {
      payload[tid] = assets.map(a => ({
        key: a.key, name: a.name,
        position: a.position ?? "", posGroup: a.posGroup ?? "OTHER",
        value: a.value ?? 0,
        tier: a.tier === "core_piece" ? "core" : (a.tier || "core"),
        type: a.type ?? "player",
        isStud: a.isStud, isYouth: a.isYouth,
        meta: a.meta ?? "", rosterMeta: a.rosterMeta ?? a.meta ?? "",
      }));
    }
    return payload;
  }, [allRosters]);

  const slateReady = slateReason !== "loading";
  const liveOffersFor = useCallback((goalId: string) => {
    return (offersByGoal.get(goalId) ?? []).filter(o => !passedIds.has(o.id));
  }, [offersByGoal, passedIds]);

  const handlePassOffer = useCallback((offerId: string) => {
    setPassedIds(prev => new Set(prev).add(offerId));
  }, []);

  const goalCount = useCallback((g: StoryGoal) => liveOffersFor(g.id).length, [liveOffersFor]);

  const chosen = story?.theses.find(t => t.id === chosenThesis) ?? null;
  const multiThesis = (story?.theses.length ?? 0) > 1;

  // Drawer offers (live) — recomputed so a PASS updates the carousel in place.
  const drawerOffers = drawerGoal ? liveOffersFor(drawerGoal.id) : [];

  // ── Render pieces ──────────────────────────────────────────────────────

  const goalCta = (g: StoryGoal) => {
    const n = goalCount(g);
    if (slateReady && n === 0) return null; // never advertise an empty door
    const ready = slateReady && n > 0;
    return (
      <div
        key={g.id}
        onClick={ready ? () => setDrawerGoal(g) : undefined}
        style={{
          background: "#FEFCF9",
          border: "2.5px solid #1A1A1A",
          boxShadow: drawerGoal?.id === g.id ? "2px 2px 0 #1A1A1A" : "4px 4px 0 #1A1A1A",
          transform: drawerGoal?.id === g.id ? "translate(2px, 2px)" : "none",
          padding: "12px 14px",
          cursor: ready ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          gap: 12,
          opacity: ready ? 1 : 0.75,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 14, textTransform: "uppercase", lineHeight: 1.15 }}>{g.label}</div>
          <div style={{ fontSize: 11, color: "#5C5C58", marginTop: 3, fontFamily: F, lineHeight: 1.4 }}>{g.teaser}</div>
        </div>
        {ready ? (
          <div style={{ flexShrink: 0, fontFamily: FM, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", background: "#185FA5", color: "#FEFCF9", border: "1.5px solid #1A1A1A", padding: "4px 8px", whiteSpace: "nowrap" }}>
            {n} {n === 1 ? "DEAL" : "DEALS"} →
          </div>
        ) : (
          <div style={{ flexShrink: 0, fontFamily: FM, fontSize: 8, fontWeight: 700, letterSpacing: "0.08em", color: "#8C7E6A", whiteSpace: "nowrap" }}>
            WORKING THE PHONES…
          </div>
        )}
      </div>
    );
  };

  const escapeHatch = (
    <div
      onClick={() => { window.location.href = "/pro-personnel/trade-builder?seed=fresh"; }}
      style={{ background: "#185FA5", color: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", padding: "12px", textAlign: "center", fontFamily: FM, fontSize: 11, letterSpacing: "0.1em", fontWeight: 700, cursor: "pointer", textTransform: "uppercase" }}
    >
      Or build your own — phones are open
    </div>
  );

  // ── Gates ──────────────────────────────────────────────────────────────

  if (!rosterId) {
    return (
      <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F }}>
        <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "32px 40px", textAlign: "center" }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 20 }}>Sign in to build trades</div>
        </div>
      </div>
    );
  }

  const chatColumn = (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px", minHeight: 0 }}>
      <div style={{ width: drawerGoal && !isMobile ? "100%" : "min(680px, 94vw)", maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Opening */}
        {!story && !storyError && (
          <DirectorMsg>
            <span style={{ fontFamily: FM, fontSize: 11, color: "#8C7E6A", letterSpacing: "0.06em" }}>Walking in… give me one second, boss.</span>
          </DirectorMsg>
        )}
        {storyError && (
          <DirectorMsg>Phones are down on my end — refresh the room and I'll pick it back up.</DirectorMsg>
        )}
        {story && <DirectorMsg>{story.director.opening}</DirectorMsg>}

        {/* No strategy on file — block and route, same rule as before */}
        {slateReason === "no_strategy" && (
          <DirectorMsg>
            <div style={{ marginBottom: 12 }}>
              Before I get on the phones for real, set our direction in the Owner's Box — who's untouchable, who's listening, what we're buying and selling.
            </div>
            <button
              onClick={() => { window.location.href = "/owners-box"; }}
              style={{ background: "#185FA5", color: "#FEFCF9", border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A", padding: "9px 16px", fontFamily: FM, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", cursor: "pointer", textTransform: "uppercase" }}
            >
              Open Owner's Box
            </button>
          </DirectorMsg>
        )}

        {/* Fork: two storylines, none chosen yet */}
        {story && multiThesis && !chosen && slateReason !== "no_strategy" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 48 }}>
            {story.theses.map(t => (
              <div
                key={t.id}
                onClick={() => setChosenThesis(t.id)}
                style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", padding: "13px 15px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: FH, fontWeight: 800, fontSize: 15, textTransform: "uppercase" }}>
                      {t.headline.replace(/\s+—.*$/, "")}
                    </span>
                    <span style={{ fontFamily: FM, fontSize: 7, fontWeight: 700, letterSpacing: "0.1em", color: t.source === "intent" ? "#FEFCF9" : "#1A1A1A", background: t.source === "intent" ? "#185FA5" : "#F5C230", border: "1.5px solid #1A1A1A", padding: "2px 6px", textTransform: "uppercase" }}>
                      {t.source === "intent" ? "Your plan" : "The roster's case"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#5C5C58", fontFamily: F, lineHeight: 1.45 }}>
                    {story.director.args[t.id] ?? t.pitch}
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            ))}
          </div>
        )}

        {/* Chosen storyline → his case + the goals */}
        {story && chosen && slateReason !== "no_strategy" && (
          <>
            {multiThesis && (
              <DirectorMsg>
                {story.director.args[chosen.id] ?? chosen.pitch}{" "}
                Here's how I'd attack it — pick an angle and I'll walk you through the deals.
              </DirectorMsg>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 48 }}>
              {slateReady && chosen.goals.every(g => goalCount(g) === 0) ? (
                <div style={{ background: "#FEFCF9", border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", padding: "14px 16px", fontSize: 13, fontFamily: F, lineHeight: 1.5 }}>
                  Nothing clean came back behind this one today. {multiThesis ? "Look at the other direction, or get on the phones yourself." : "Adjust the strategy or get on the phones yourself."}
                </div>
              ) : (
                chosen.goals.map(goalCta)
              )}
              {multiThesis && (
                <div
                  onClick={() => { setChosenThesis(null); setDrawerGoal(null); }}
                  style={{ fontFamily: FM, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#8C7E6A", cursor: "pointer", textTransform: "uppercase", padding: "2px 0" }}
                >
                  ← Look at the other direction
                </div>
              )}
            </div>
          </>
        )}

        {slateReason === "error" && (
          <DirectorMsg>The phones went down mid-call — refresh the room or try again in a minute.</DirectorMsg>
        )}

        {/* Escape hatch — always on the table */}
        {story && slateReason !== "no_strategy" && <div style={{ paddingLeft: 48 }}>{escapeHatch}</div>}
      </div>
    </div>
  );

  return (
    <div style={{ height: isMobile ? "calc(100dvh - 44px)" : "calc(100vh - 44px)", background: "#F5F0E6", fontFamily: F, color: "#1A1A1A", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 120, background: "#185FA5", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>
          {toast}
        </div>
      )}

      {/* Topbar */}
      <div style={{ background: "#F5F0E6", padding: "8px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #C8C3B8", flexShrink: 0 }}>
        <div onClick={() => { window.location.href = "/"; }} style={{ fontSize: 11, color: "#8C7E6A", cursor: "pointer", fontFamily: FM, letterSpacing: "0.04em" }}>← BACK</div>
        <div style={{ width: 1, height: 14, background: "#C8C3B8" }} />
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15 }}>Build a Trade</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: FM, fontSize: 10, color: "#8C7E6A", letterSpacing: "0.04em", textTransform: "uppercase" }}>{teamName}</div>
      </div>

      {/* Desktop: split when the drawer is open. Mobile: chat + sheet. */}
      {!isMobile && drawerGoal ? (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 0, overflow: "hidden" }}>
          {chatColumn}
          <OfferDrawer
            goalLabel={drawerGoal.label}
            offers={drawerOffers}
            myTeamId={rosterId}
            rosterPayload={rosterPayload}
            advisorByOffer={advisorByOffer}
            setAdvisorByOffer={setAdvisorByOffer}
            inFlightRef={inFlightRef}
            onPass={handlePassOffer}
            onClose={() => setDrawerGoal(null)}
            flash={flash}
            isMobile={false}
          />
        </div>
      ) : (
        <>
          {chatColumn}
          {isMobile && drawerGoal && (
            <OfferDrawer
              goalLabel={drawerGoal.label}
              offers={drawerOffers}
              myTeamId={rosterId}
              rosterPayload={rosterPayload}
              advisorByOffer={advisorByOffer}
              setAdvisorByOffer={setAdvisorByOffer}
              inFlightRef={inFlightRef}
              onPass={handlePassOffer}
              onClose={() => setDrawerGoal(null)}
              flash={flash}
              isMobile={true}
            />
          )}
        </>
      )}
    </div>
  );
}
