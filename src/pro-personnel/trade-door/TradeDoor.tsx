"use client";

// The "Build a Trade" DOOR (director_office.md): same room, same UI chassis as
// the Scouting Director's office (shared/director-chat) — the ONLY difference
// from walking in the office door is the opening message: here the director
// already knows what you came to do, so the chat preloads his storyline read
// and the goal plays behind it.
//
// Flow: opening presents the storyline(s) as numbered POVs (one clear path, or
// the genuine fork — "your plan" vs "what the roster is telling me"). Picking
// a direction gets his case + the goals as tappable actions. Tapping a goal
// opens the offer drawer — right half on desktop (the chat stays live), bottom
// sheet on mobile — with the vetted deals behind it. PASS is on the deal, not
// the framing. The manual-builder escape hatch is always on the table.
//
// Latency: the room opens on the fast storylines endpoint while the slate
// generates in the background; goal labels carry live counts when it lands.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import { InnerTopbar } from "@/shared/ui/InnerTopbar";
import {
  DirectorChat,
  type Message,
  type ActionItem,
  type POV,
} from "@/shared/director-chat";
import OfferDrawer, { type DoorOffer, type AdvisorState, type AdvisorRosterPayload } from "./OfferDrawer";

const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

const DIRECTOR_LABEL = "PERSONNEL DIRECTOR";
const BUILD_OWN_ANCHOR = "I'll build my own — open the phones.";

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

type Opening = Extract<Message, { kind: "director_opening" }>;
type Response = Extract<Message, { kind: "director_response" }>;

const headlineShort = (h: string) => h.replace(/\s+—.*$/, "");

export default function TradeDoor() {
  const { rosterId = "", teamName = "" } = readStoredTeam();
  const isMobile = useIsMobile();

  const [story, setStory] = useState<Storylines | null>(null);
  const [storyError, setStoryError] = useState(false);
  const [slateReason, setSlateReason] = useState<"loading" | "ok" | "no_strategy" | "no_clean_offers" | "error">("loading");
  const [offersByGoal, setOffersByGoal] = useState<Map<string, DoorOffer[]>>(new Map());
  const [allRosters, setAllRosters] = useState<Record<string, RawClientAsset[]>>({});
  const [passedIds, setPassedIds] = useState<Set<string>>(new Set());
  const [drawerGoal, setDrawerGoal] = useState<StoryGoal | null>(null);
  const [advisorByOffer, setAdvisorByOffer] = useState<AdvisorState>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // The chat reads live slate state through refs (the thread's callbacks are
  // long-lived; state snapshots inside them would go stale).
  const slateRef = useRef<{ reason: string; byGoal: Map<string, DoorOffer[]> }>({ reason: "loading", byGoal: new Map() });
  const passedRef = useRef(passedIds);
  useEffect(() => { passedRef.current = passedIds; }, [passedIds]);
  useEffect(() => { slateRef.current = { reason: slateReason, byGoal: offersByGoal }; }, [slateReason, offersByGoal]);

  // Fast half: the room opens on the narrative bundle.
  useEffect(() => {
    if (!rosterId) return;
    let cancelled = false;
    fetch(`/api/pro-personnel/storylines?team_id=${encodeURIComponent(rosterId)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (j?.theses) setStory(j);
        else setStoryError(true);
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
        for (const th of slate.theses ?? []) {
          for (const o of th.offers ?? []) {
            const gid = o.goalId ?? `${th.id}:${o.narrative ?? "misc"}`;
            const arr = byGoal.get(gid) ?? [];
            if (!arr.some(x => x.id === o.id)) arr.push(o);
            byGoal.set(gid, arr);
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

  const liveOffersFor = useCallback((goalId: string) => {
    return (slateRef.current.byGoal.get(goalId) ?? []).filter(o => !passedRef.current.has(o.id));
  }, []);

  const handlePassOffer = useCallback((offerId: string) => {
    setPassedIds(prev => new Set(prev).add(offerId));
  }, []);

  // Drawer offers recompute from state (not refs) so a PASS re-renders.
  const drawerOffers = drawerGoal
    ? (offersByGoal.get(drawerGoal.id) ?? []).filter(o => !passedIds.has(o.id))
    : [];

  // ── Opening message (the chat preloads what YOU came to do) ─────────────

  const goalAnchor = (g: StoryGoal) => `Show me: ${g.label}.`;
  const thesisAnchor = (t: StoryThesis) => `Let's ${headlineShort(t.headline).toLowerCase()}.`;

  const opening = useMemo<Opening | null>(() => {
    if (!story) return null;
    const multi = story.theses.length > 1;

    if (!multi) {
      const t = story.theses[0];
      const povs: POV[] = (t?.goals ?? []).map((g, i) => ({
        id: g.id,
        number: i + 1,
        text: `${g.label} — ${g.teaser}`,
        anchor: goalAnchor(g),
      }));
      povs.push({
        id: "__build_own__",
        number: povs.length + 1,
        text: "Build my own trade — get me on the phones and I'll work it with you live.",
        anchor: BUILD_OWN_ANCHOR,
      });
      return {
        kind: "director_opening",
        directorRole: "personnel",
        directorLabel: DIRECTOR_LABEL,
        welcome: story.director.opening,
        transition: t ? "Here's how I'd attack it:" : undefined,
        povs,
        closing: "Tap one, or tell me what's on your mind.",
      };
    }

    const povs: POV[] = story.theses.map((t, i) => ({
      id: t.id,
      number: i + 1,
      text: story.director.args[t.id] ?? t.pitch,
      anchor: thesisAnchor(t),
    }));
    povs.push({
      id: "__build_own__",
      number: povs.length + 1,
      text: "Or skip the storylines — build my own trade and I'll work it with you live.",
      anchor: BUILD_OWN_ANCHOR,
    });
    return {
      kind: "director_opening",
      directorRole: "personnel",
      directorLabel: DIRECTOR_LABEL,
      welcome: story.director.opening,
      povs,
      closing: "Pick a direction, or tell me what's on your mind.",
    };
  }, [story]);

  // ── Chat brain: anchors → responses; goal taps → the drawer ─────────────

  const respond = useCallback((prose: string[], items?: ActionItem[]): Response => ({
    kind: "director_response",
    directorRole: "personnel",
    directorLabel: DIRECTOR_LABEL,
    prose,
    ...(items && items.length > 0 ? { action: { type: "multi_option" as const, items } } : {}),
  }), []);

  const goalItems = useCallback((t: StoryThesis): ActionItem[] => {
    const ready = slateRef.current.reason !== "loading";
    const items: ActionItem[] = [];
    for (const g of t.goals) {
      const n = liveOffersFor(g.id).length;
      if (ready && n === 0) continue; // never advertise an empty door
      items.push({
        id: g.id,
        label: ready ? `${g.label} — ${n} ${n === 1 ? "deal" : "deals"} on the board` : `${g.label} — working the phones…`,
        kind: "respond",
        respondAs: goalAnchor(g),
      });
    }
    items.push({ id: "__build_own__", label: "Build my own trade", kind: "navigate", href: "/pro-personnel/trade-builder?seed=fresh" });
    return items;
  }, [liveOffersFor]);

  const handleUserMessage = useCallback(async (text: string): Promise<Response | null> => {
    if (!story) return null;

    // Escape hatch
    if (text === BUILD_OWN_ANCHOR) {
      window.location.href = "/pro-personnel/trade-builder?seed=fresh";
      return null;
    }

    // Storyline pick (fork)
    const thesis = story.theses.find(t => thesisAnchor(t) === text);
    if (thesis) {
      if (slateRef.current.reason === "no_strategy") {
        return respond(
          ["Before I get on the phones for real, set our direction in the Owner's Box — who's untouchable, who's listening, what we're buying and selling. Then I can line these up properly."],
          [{ id: "__owners_box__", label: "Open the Owner's Box", kind: "navigate", href: "/owners-box" }],
        );
      }
      const arg = story.director.args[thesis.id] ?? thesis.pitch;
      const items = goalItems(thesis);
      if (slateRef.current.reason !== "loading" && items.length <= 1) {
        return respond([
          `${arg}`,
          "Straight with you though — nothing clean came back behind it today. Look at the other direction, or get me on the phones and we'll build something ourselves.",
        ], items);
      }
      return respond([arg, "Here's how I'd attack it:"], items);
    }

    // Goal pick → open the drawer
    const allGoals = story.theses.flatMap(t => t.goals);
    const goal = allGoals.find(g => goalAnchor(g) === text);
    if (goal) {
      if (slateRef.current.reason === "loading") {
        return respond(["Still making the calls on that one — give me a few seconds and ask again."]);
      }
      const n = liveOffersFor(goal.id).length;
      if (n === 0) {
        return respond(["Nothing clean left behind that one today. Pick another angle, or get me on the phones and we'll build something ourselves."]);
      }
      setDrawerGoal(goal);
      return respond([
        isMobile
          ? `Pulling them up now — ${n === 1 ? "one deal" : `${n} deals`} I'd actually send. Work through them and tell me where you land.`
          : `On the board to your right — ${n === 1 ? "one deal" : `${n} deals`} I'd actually send. Work through them and tell me where you land.`,
      ]);
    }

    // Free text → office respond endpoint (stubbed until the intel backend ships)
    try {
      const r = await fetch("/api/pro-personnel/office/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, message: text }),
      });
      if (r.ok) {
        const j = await r.json();
        return respond(j.prose ?? [], j.action?.items);
      }
    } catch {}
    return respond([
      "I hear you. Full conversations come online soon — for now, tap one of the plays above and I'll walk you through the deals behind it.",
    ]);
  }, [story, respond, goalItems, liveOffersFor, isMobile, rosterId]);

  const handleCommit = useCallback(async (item: ActionItem): Promise<boolean> => {
    if (!item.commit) return false;
    try {
      const r = await fetch(item.commit.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.commit.body ?? {}),
      });
      return r.ok;
    } catch {
      return false;
    }
  }, []);

  // ── Gates ───────────────────────────────────────────────────────────────

  if (!rosterId) {
    return (
      <div style={{ height: "100vh", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ border: "2.5px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#FEFCF9", padding: "32px 40px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-headline, 'Syne', sans-serif)", fontWeight: 800, fontSize: 20 }}>Sign in to build trades</div>
        </div>
      </div>
    );
  }

  const splitOpen = !!drawerGoal && !isMobile;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#F5F0E6" }}>
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: 24, transform: "translateX(-50%)", zIndex: 120, background: "#3366CC", color: "#fff", padding: "8px 20px", fontFamily: FM, fontSize: 12, fontWeight: 700, border: "2px solid #1A1A1A", boxShadow: "3px 3px 0 #1A1A1A" }}>
          {toast}
        </div>
      )}

      <InnerTopbar breadcrumb="PRO PERSONNEL" />

      <div style={{ padding: "28px 26px 14px 26px", flexShrink: 0 }}>
        <div style={{
          fontFamily: "var(--font-headline, 'Syne', sans-serif)",
          fontWeight: 900,
          fontSize: 36,
          color: "#1A1A1A",
          letterSpacing: "-0.015em",
          lineHeight: 1.04,
        }}>
          Personnel Director
        </div>
      </div>

      <div style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: splitOpen ? "1fr 1fr" : "1fr",
        overflow: "hidden",
      }}>
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {opening ? (
            <DirectorChat
              opening={opening}
              directorLabel={DIRECTOR_LABEL}
              directorRole="personnel"
              userAvatarInitials="NT"
              onUserMessage={handleUserMessage}
              onCommit={handleCommit}
              placeholder="Ask the Personnel Director…"
            />
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FM, fontSize: 11, letterSpacing: "0.18em", color: "#8C7E6A", fontWeight: 700, textTransform: "uppercase" }}>
              {storyError ? "Phones are down — refresh the room" : "Walking in…"}
            </div>
          )}
        </div>

        {drawerGoal && !isMobile && (
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
        )}
      </div>

      {drawerGoal && isMobile && (
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
    </div>
  );
}
