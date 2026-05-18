"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDraftStatusContext } from "./DraftStatusProvider";
import { useDraftClockContext } from "@/scouting/draft-room/hooks/useDraftClockContext";
import { computeSecondsUntilAnnouncement } from "@/scouting/draft-room/draftState";
import { getSupabaseClient } from "@/infrastructure/supabase/client";
import { normalizeName } from "@/infrastructure/strings/normalize";
import { playChime, toggleChimeMuted, useChimeMuted } from "@/scouting/draft-room/chime";
import { readStoredTeam, type StoredTeam } from "@/infrastructure/identity/storedTeam";

const DRAFT_ROUTE = "/draft";
const TRADE_ROUTE = "/trades";

// Color palette — Item 1 / spec.
const BAR_BLUE = "#3366CC";
const BAR_RED = "#E8503A";
const INK = "#1A1A1A";
const PAPER = "#FEFCF9";
const YELLOW = "#F5C230";
const DIVIDER_ON_BAR = "rgba(255,255,255,0.2)";
const LABEL_ON_BAR = "rgba(255,255,255,0.5)";
// Translucent INK (#1A1A1A → 26,26,26) used for labels/colons inside the
// yellow accent block of the pre-draft countdown.
const INK_LABEL = "rgba(26,26,26,0.5)";
const INK_COLON = "rgba(26,26,26,0.35)";

type StoredSelection = StoredTeam;

const formatTimer = (totalSeconds: number) => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const computeCountdownParts = (startsAtMs: number, nowMs: number) => {
  const total = Math.max(0, Math.floor((startsAtMs - nowMs) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { total, days, hours, minutes, seconds };
};

export default function ClockBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { isActive, secondsRemaining, state } = useDraftStatusContext();
  const isDraftRoute = pathname?.startsWith(DRAFT_ROUTE) ?? false;

  // Determine pre-draft countdown vs active states. Date.now() is used via
  // a state-backed `countdownNow` so render stays pure (per react-hooks/purity).
  const startsAtMs =
    state?.starts_at && typeof state.starts_at === "string"
      ? new Date(state.starts_at).getTime()
      : NaN;

  // Pre-draft countdown ticking (per-second local). MUST be initialized to a
  // stable value on first render so the SSR snapshot and the client hydration
  // pass produce identical HTML — `useState(() => Date.now())` was causing
  // React error #418 (hydration mismatch) because the server captured one
  // wall-clock and the client captured another. The mismatch was throwing
  // before useEffects had a chance to register, which silently disabled the
  // /api/scouting/draft/tick auto-fire effects below. Initialize to 0 (which makes
  // `hasFutureStart` false during SSR) and set the real `Date.now()` in the
  // mount effect, then keep ticking it every second while a future start is
  // scheduled (handled by the existing effect further down).
  const [countdownNow, setCountdownNow] = useState(0);
  useEffect(() => {
    setCountdownNow(Date.now());
  }, []);

  const hasFutureStart =
    Number.isFinite(startsAtMs) &&
    state?.status === "not_started" &&
    countdownNow > 0 &&
    startsAtMs > countdownNow;

  // Poll clock context whenever the bar is rendered (active draft anywhere,
  // any visit to /draft, or a scheduled pre-draft countdown so we can show
  // "{TEAM} ARE UP FIRST").
  const context = useDraftClockContext({
    disabled: !isActive && !isDraftRoute && !hasFutureStart,
  });

  // Re-read selection on mount + when storage changes so the bar knows which
  // roster the user is currently piloting.
  const [selection, setSelection] = useState<StoredSelection>({});
  useEffect(() => {
    setSelection(readStoredTeam());
    const handle = () => setSelection(readStoredTeam());
    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, []);

  // Local 1s tick so the displayed timer counts down between polls.
  const [tickedSeconds, setTickedSeconds] = useState(secondsRemaining);
  useEffect(() => {
    setTickedSeconds(secondsRemaining);
  }, [secondsRemaining]);
  useEffect(() => {
    if (!isActive || state?.status !== "running") return;
    const id = window.setInterval(() => {
      setTickedSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isActive, state?.status]);

  // "Pick is in" countdown — seconds until the submitted pick is announced.
  const [announceSeconds, setAnnounceSeconds] = useState(() =>
    computeSecondsUntilAnnouncement(state)
  );
  useEffect(() => {
    setAnnounceSeconds(computeSecondsUntilAnnouncement(state));
  }, [state?.pick_submitted, state?.pick_announced_at, state]);
  const isPickIn = !!state?.pick_submitted && !!state?.pick_announced_at;
  useEffect(() => {
    if (!isPickIn) return;
    const id = window.setInterval(() => {
      setAnnounceSeconds(computeSecondsUntilAnnouncement(state));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isPickIn, state]);

  // The countdown value currently displayed on screen: when a pick is "in"
  // (submitted, awaiting announcement) we show the announcement countdown;
  // otherwise we show the on-the-clock countdown. This is the single value
  // the auto-tick effect watches.
  const timeLeft = isPickIn ? announceSeconds : tickedSeconds;

  // When the displayed countdown hits 0 while the draft is running, POST to
  // /api/scouting/draft/tick. The server handles everything — announcing the pick,
  // auto-skipping, advancing current_pick_index. The endpoint is idempotent
  // so multiple clients calling it concurrently is safe. A ref-based 2s
  // debounce guards against firing more than once per zero-crossing.
  const tickFiredRef = useRef(false);
  useEffect(() => {
    if (timeLeft > 0) {
      tickFiredRef.current = false;
      return;
    }
    if (state?.status !== "running") return;
    if (tickFiredRef.current) return;
    tickFiredRef.current = true;
    fetch("/api/scouting/draft/tick", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.status !== "advanced") {
          tickFiredRef.current = false;
          return;
        }
        // Tick advanced state server-side (announce / auto-skip just fired).
        // Fan out the same refetch signal DraftStatusProvider's 3s poll
        // uses so the board removes the drafted player at the exact moment
        // the reveal animation starts on this client, instead of waiting up
        // to 3s for the next poll.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("draft-log-refetch-requested"));
        }
      })
      .catch(() => {
        tickFiredRef.current = false;
      });
  }, [timeLeft, state?.status]);

  // ----- Reveal animation + chime + mute ----------------------------------
  // When the server flips a draft_log row from is_announced=false → true
  // (the "auto-announce" moment), drive a 3-phase animation on every
  // connected client:
  //   Phase 1 (0 → 0.85s)  "THE PICK IS IN" slides straight down + countdown fades
  //   Phase 2 (at 0.85s)   chime plays (gated by mute)
  //   Phase 3 (0.85 → 1.75) reveal line flies in from above with bounce-settle
  //   Hold (1.75 → 9.75s)  reveal line stays on screen
  //   After 9.75s          fall back to whatever the draft state now requires
  type RevealedPick = {
    pickIndex: number;
    teamName: string;
    playerName: string;
    position: string;
    school: string;
  };
  type RevealPhase = "slide-out" | "fly-in";

  const [revealedPick, setRevealedPick] = useState<RevealedPick | null>(null);
  const [revealPhase, setRevealPhase] = useState<RevealPhase>("slide-out");
  // Mute state lives in the shared `chime` module so the submit-pick
  // handler in app/page.tsx and any other caller see the same flag.
  const muted = useChimeMuted();

  // Refs: dedupe reveals by pick index so re-deliveries / strict-mode
  // double-runs don't double-trigger.
  const lastRevealedIndexRef = useRef<number | null>(null);
  const collegeMapRef = useRef<Record<string, string> | null>(null);
  const revealTimeoutsRef = useRef<number[]>([]);

  // Lazy-load the rookie-prospect college map exactly once. Used as the
  // fallback school source when the announced row doesn't already carry one.
  const loadCollegeMap = useCallback(async (): Promise<Record<string, string>> => {
    if (collegeMapRef.current) return collegeMapRef.current;
    try {
      const res = await fetch("/api/scouting/draft/rookie-prospects", { cache: "force-cache" });
      if (!res.ok) {
        collegeMapRef.current = {};
        return collegeMapRef.current;
      }
      const json = (await res.json()) as { data?: Record<string, unknown> };
      const map: Record<string, string> = {};
      Object.entries(json?.data ?? {}).forEach(([key, val]) => {
        const college = (val as { college?: string | null } | null)?.college;
        if (typeof college === "string" && college) map[key] = college;
      });
      collegeMapRef.current = map;
      return map;
    } catch {
      collegeMapRef.current = {};
      return collegeMapRef.current;
    }
  }, []);

  // Cleanup any scheduled reveal timeouts on unmount so phase-advances don't
  // fire after the bar has been torn down.
  useEffect(() => {
    return () => {
      revealTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      revealTimeoutsRef.current = [];
    };
  }, []);

  const triggerReveal = useCallback(
    async (row: Record<string, unknown> | null | undefined) => {
      if (!row) return;
      const pickIndexRaw = row.pick_index;
      const pickIndex =
        typeof pickIndexRaw === "number"
          ? pickIndexRaw
          : typeof pickIndexRaw === "string"
            ? Number(pickIndexRaw)
            : NaN;
      if (!Number.isFinite(pickIndex)) return;
      // Dedupe: same pick can't reveal twice (covers React strict-mode and
      // duplicate realtime deliveries).
      if (lastRevealedIndexRef.current === pickIndex) return;

      const playerName = typeof row.player_name === "string" ? row.player_name : "";
      // Skip rows have no player; nothing to reveal.
      if (!playerName) return;

      lastRevealedIndexRef.current = pickIndex;

      // Fan out the board-refresh signal at the exact moment the reveal
      // begins. The Realtime UPDATE that triggered this reveal SHOULD also
      // wake useDraftRoomLog's draft_log subscription, but the two channels
      // are independent and either can drop silently. Dispatching here
      // guarantees the drafted player leaves the board and shows up in the
      // ticker simultaneously with the player name appearing in the clock
      // bar — never seconds later.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("draft-log-refetch-requested"));
      }

      const teamName = typeof row.team_name === "string" && row.team_name ? row.team_name : "—";
      const positionsRaw = Array.isArray(row.positions) ? row.positions : [];
      const position =
        (positionsRaw.find((v) => typeof v === "string") as string | undefined)?.toUpperCase() ||
        "—";

      const map = await loadCollegeMap();
      const school = map[normalizeName(playerName)] || "—";

      // Clear any pending phase timers from a prior reveal.
      revealTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      revealTimeoutsRef.current = [];

      setRevealedPick({ pickIndex, teamName, playerName, position, school });
      setRevealPhase("slide-out");

      // Phase 2 + 3 start after Phase 1 completes (0.85s).
      const t1 = window.setTimeout(() => {
        setRevealPhase("fly-in");
        // playChime() is a no-op when muted and silently swallows browser
        // autoplay-policy errors.
        playChime();
      }, 850);

      // Total reveal duration: ~1.75s animation + 8s hold = 9.75s.
      const t2 = window.setTimeout(() => {
        setRevealedPick(null);
        setRevealPhase("slide-out");
      }, 9750);

      revealTimeoutsRef.current = [t1, t2];
    },
    [loadCollegeMap]
  );

  // Subscribe to draft_log UPDATE events; trigger the reveal animation when
  // is_announced flips false → true (and the row is not a skip).
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const channel = supabase.channel("clock-bar-draft-log-reveal").on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "draft_log" },
      (payload) => {
        const newRow = (payload.new ?? null) as Record<string, unknown> | null;
        const oldRow = (payload.old ?? null) as Record<string, unknown> | null;
        if (!newRow) return;
        const wasAnnounced = oldRow?.is_announced === true;
        const isAnnouncedNow = newRow.is_announced === true;
        if (!isAnnouncedNow || wasAnnounced) return;
        if (newRow.is_skip === true) return;
        void triggerReveal(newRow);
      }
    );
    try {
      channel.subscribe();
    } catch (error) {
      console.warn("Unable to subscribe to draft_log reveal updates", error);
    }
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore teardown errors
      }
    };
  }, [triggerReveal]);

  // Pre-draft countdown re-tick: when there is a future start, advance
  // `countdownNow` every second so the displayed values update.
  useEffect(() => {
    if (!hasFutureStart) return;
    const id = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasFutureStart]);

  // When the pre-draft countdown reaches 0, fire `action: "start"` exactly
  // once. Server-side guard returns `already_started` if another client beat
  // us to it, so concurrent clients are safe.
  const startFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasFutureStart) {
      startFiredRef.current = null;
      return;
    }
    if (startsAtMs > countdownNow) return;
    const key = state?.starts_at ?? "";
    if (startFiredRef.current === key) return;
    startFiredRef.current = key;
    fetch("/api/scouting/draft/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).catch(() => {
      startFiredRef.current = null;
    });
  }, [hasFutureStart, startsAtMs, countdownNow, state?.starts_at]);

  // Visibility: render the bar when the draft is active OR we're on the draft
  // route OR a pre-draft countdown is scheduled (so the countdown shows
  // globally on every page, per spec). Also keep the bar mounted while a
  // reveal animation is in flight so all clients see the dramatic moment
  // regardless of the page they're on.
  if (!isActive && !isDraftRoute && !hasFutureStart && !revealedPick) return null;

  // ----- Pick reveal animation --------------------------------------------
  // Replaces every other layout for ~9.75s. Phase 1 slides the old "THE PICK
  // IS IN" text down (transform translateY 0→100px, cubic-bezier(0.5,0,0.75,0.1))
  // while the right-side countdown fades; Phase 3 flies the player line in
  // from above (translateY -100px → 0, cubic-bezier(0.2,1.05,0.35,1)).
  if (revealedPick) {
    const isFlyIn = revealPhase === "fly-in";
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "relative",
          background: BAR_BLUE,
          borderTop: `2.5px solid ${INK}`,
          borderBottom: `2.5px solid ${INK}`,
          boxShadow: `4px 4px 0 ${INK}`,
          overflow: "hidden",
        }}
      >
        <div
          className="flex w-full"
          style={{
            height: 64,
            alignItems: "stretch",
            color: PAPER,
          }}
        >
          {/* LEFT — Franchise that just made the pick */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 20px",
              borderRight: `2px solid ${DIVIDER_ON_BAR}`,
              flex: "0 0 auto",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-headline)",
                fontWeight: 800,
                fontSize: 14,
                color: PAPER,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.1,
                minWidth: 0,
              }}
              title={revealedPick.teamName}
            >
              {revealedPick.teamName}
            </span>
          </div>

          {/* CENTER — animated reveal area */}
          <div
            style={{
              flex: "1 1 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              padding: "0 20px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Phase 1: outgoing "THE PICK IS IN" — only rendered until phase flips */}
            {!isFlyIn ? (
              <span
                style={{
                  position: "absolute",
                  fontFamily: "var(--font-headline)",
                  fontWeight: 800,
                  fontSize: 26,
                  color: YELLOW,
                  textTransform: "uppercase",
                  letterSpacing: "4px",
                  whiteSpace: "nowrap",
                  lineHeight: 1,
                  transform: "translateY(100px)",
                  transition: "transform 0.85s cubic-bezier(0.5, 0, 0.75, 0.1)",
                  // Initial frame: above 0 → animate to 100px on mount.
                  // Achieved by mounting at 0 then immediately transitioning.
                  willChange: "transform",
                }}
                ref={(el) => {
                  if (!el) return;
                  // Set the start frame, then on next paint set the end frame so
                  // the transition runs.
                  el.style.transform = "translateY(0)";
                  requestAnimationFrame(() => {
                    el.style.transform = "translateY(100px)";
                  });
                }}
              >
                The Pick Is In
              </span>
            ) : null}

            {/* Phase 3: incoming reveal line, flies down from above */}
            {isFlyIn ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  whiteSpace: "nowrap",
                  transform: "translateY(0)",
                  transition: "transform 0.9s cubic-bezier(0.2, 1.05, 0.35, 1)",
                  willChange: "transform",
                  fontFamily: "var(--font-headline)",
                  fontWeight: 800,
                  fontSize: 26,
                  textTransform: "uppercase",
                  letterSpacing: "4px",
                  lineHeight: 1,
                }}
                ref={(el) => {
                  if (!el) return;
                  el.style.transform = "translateY(-100px)";
                  requestAnimationFrame(() => {
                    el.style.transform = "translateY(0)";
                  });
                }}
              >
                <span style={{ color: YELLOW }}>{revealedPick.playerName}</span>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>·</span>
                <span style={{ color: "rgba(255,255,255,0.75)" }}>{revealedPick.position}</span>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>·</span>
                <span style={{ color: "rgba(255,255,255,0.75)" }}>{revealedPick.school}</span>
              </div>
            ) : null}
          </div>

          {/* RIGHT — fading-out "ANNOUNCING IN" placeholder during Phase 1 only */}
          {!isFlyIn ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 20px",
                minWidth: 130,
                background: BAR_BLUE,
                borderLeft: `2px solid ${DIVIDER_ON_BAR}`,
                flex: "0 0 auto",
                opacity: 0,
                transition: "opacity 0.5s ease-out",
              }}
              ref={(el) => {
                if (!el) return;
                el.style.opacity = "1";
                requestAnimationFrame(() => {
                  el.style.opacity = "0";
                });
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  fontSize: 8,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: LABEL_ON_BAR,
                  lineHeight: 1,
                  marginBottom: 4,
                }}
              >
                Announcing In
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 20,
                  color: PAPER,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                00:00
              </span>
            </div>
          ) : null}
        </div>
        <MuteToggle muted={muted} onToggle={toggleChimeMuted} />
      </div>
    );
  }

  // ----- Pre-draft countdown bar -------------------------------------------
  if (hasFutureStart) {
    const parts = computeCountdownParts(startsAtMs, countdownNow);
    const firstPickTeamName = context?.onClockTeamName || "";

    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          background: BAR_BLUE,
          borderTop: `2.5px solid ${INK}`,
          borderBottom: `2.5px solid ${INK}`,
          boxShadow: `4px 4px 0 ${INK}`,
        }}
      >
        <div
          className="flex w-full"
          style={{
            height: 64,
            alignItems: "stretch",
            color: PAPER,
          }}
        >
          {/* LEFT — "CFC DRAFT BEGINS IN" */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 20px",
              borderRight: `2px solid ${DIVIDER_ON_BAR}`,
              flex: "0 0 auto",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-headline)",
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                color: YELLOW,
                whiteSpace: "nowrap",
                lineHeight: 1,
              }}
            >
              CFC Draft Begins In
            </span>
          </div>

          {/* CENTER — yellow accent block with DD/HH/MM/SS */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "0 24px",
              background: YELLOW,
              borderLeft: `2px solid ${INK}`,
              borderRight: `2px solid ${INK}`,
              flex: "0 0 auto",
            }}
          >
            <CountdownBlock value={parts.days} label="Days" />
            <CountdownColon />
            <CountdownBlock value={parts.hours} label="Hrs" />
            <CountdownColon />
            <CountdownBlock value={parts.minutes} label="Min" />
            <CountdownColon />
            <CountdownBlock value={parts.seconds} label="Sec" />
          </div>

          {/* RIGHT — "{TEAM} ARE UP FIRST" */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "0 20px",
              flex: "1 1 auto",
              minWidth: 0,
              gap: 6,
            }}
          >
            {firstPickTeamName ? (
              <>
                <span
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: YELLOW,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                    lineHeight: 1,
                  }}
                  title={firstPickTeamName}
                >
                  {firstPickTeamName}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontWeight: 700,
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: PAPER,
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                  }}
                >
                  Are Up First
                </span>
              </>
            ) : (
              <span
                style={{
                  fontFamily: "var(--font-headline)",
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: PAPER,
                  whiteSpace: "nowrap",
                  lineHeight: 1,
                }}
              >
                First pick loading…
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ----- "THE PICK IS IN" bar ----------------------------------------------
  // When a pick has been submitted but not yet announced, the clock bar
  // becomes a dedicated dramatic layout: franchise name | big yellow
  // "THE PICK IS IN" | announcing-in countdown. Same on every page — there's
  // nothing to act on, the pick is locked in.
  if (isPickIn) {
    const submittedTeamName =
      context?.onClockTeamName ||
      (context?.onClockRosterId ? `Roster ${context.onClockRosterId}` : "Loading…");

    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "relative",
          background: BAR_BLUE,
          borderTop: `2.5px solid ${INK}`,
          borderBottom: `2.5px solid ${INK}`,
          boxShadow: `4px 4px 0 ${INK}`,
        }}
      >
        <div
          className="flex w-full"
          style={{
            height: 64,
            alignItems: "stretch",
            color: PAPER,
          }}
        >
          {/* LEFT — Franchise that just made the pick */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 20px",
              borderRight: `2px solid ${DIVIDER_ON_BAR}`,
              flex: "0 0 auto",
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-headline)",
                fontWeight: 800,
                fontSize: 15,
                color: PAPER,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.1,
                minWidth: 0,
              }}
              title={submittedTeamName}
            >
              {submittedTeamName}
            </span>
          </div>

          {/* CENTER — "THE PICK IS IN" — the star of the show */}
          <div
            style={{
              flex: "1 1 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              padding: "0 20px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-headline)",
                fontWeight: 800,
                fontSize: 26,
                color: YELLOW,
                textTransform: "uppercase",
                letterSpacing: "4px",
                whiteSpace: "nowrap",
                lineHeight: 1,
              }}
            >
              The Pick Is In
            </span>
          </div>

          {/* RIGHT — "ANNOUNCING IN" countdown */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 20px",
              minWidth: 130,
              background: BAR_BLUE,
              borderLeft: `2px solid ${DIVIDER_ON_BAR}`,
              flex: "0 0 auto",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                fontSize: 8,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: LABEL_ON_BAR,
                lineHeight: 1,
                marginBottom: 4,
              }}
            >
              Announcing In
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 20,
                color: PAPER,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatTimer(announceSeconds)}
            </span>
          </div>
        </div>
        <MuteToggle muted={muted} onToggle={toggleChimeMuted} />
      </div>
    );
  }

  // ----- Active / pending clock bar ----------------------------------------
  const isPending = !isActive;
  const isYourPick =
    !isPending &&
    !!selection.rosterId &&
    !!context?.onClockRosterId &&
    selection.rosterId === context.onClockRosterId;

  type BarState =
    | "your-pick"
    | "on-clock-draft"
    | "on-clock-other"
    | "pending";

  const onClockState: BarState = isPending
    ? "pending"
    : isYourPick && isDraftRoute
      ? "your-pick"
      : isDraftRoute
        ? "on-clock-draft"
        : "on-clock-other";

  const isRed = onClockState === "your-pick";
  // Item 1: blue is the new default; red is reserved for "your pick".
  const background = isRed ? BAR_RED : BAR_BLUE;
  const dividerColor = DIVIDER_ON_BAR;
  // Timer color: white on blue (yellow doesn't read well on blue per spec); white on red.
  const timerColor = PAPER;
  const labelColor = LABEL_ON_BAR;
  // Rd/Pk values: white per spec.
  const valueColor = PAPER;
  const franchiseTextColor = PAPER;

  const chipText = isPending
    ? state?.status === "paused"
      ? "Draft paused"
      : "Draft not started"
    : isRed
      ? "Your pick"
      : "On the clock";
  // Chip border per spec:
  //   - "your pick"   → white (on red bar)
  //   - default blue  → translucent white (rgba(255,255,255,0.5))
  const chipBorder = isRed
    ? `1.5px solid ${PAPER}`
    : `1.5px solid ${LABEL_ON_BAR}`;
  // Chip text color: white in every state on the new blue bar.
  const chipColor = PAPER;

  const actionLabel =
    onClockState === "your-pick" && context?.onClockRosterId
      ? "Shop this pick"
      : onClockState === "on-clock-draft" && context?.onClockRosterId
        ? "Trade up"
        : onClockState === "on-clock-other"
          ? "Back to draft"
          : null;

  const handleAction = () => {
    if (onClockState === "pending") return;
    if (onClockState === "on-clock-other") {
      router.push(DRAFT_ROUTE);
      return;
    }
    const params = new URLSearchParams({
      mode: "draft",
      action: onClockState === "your-pick" ? "shop" : "tradeup",
      pickOwner: context?.onClockRosterId || "",
      pickRound: String(context?.round || 1),
      pickSlot: String(context?.pick || 1),
      pickSeason: context?.season || "",
      myTeam: selection.rosterId || "",
    });
    router.push(`/trade-builder?${params.toString()}`);
  };

  const franchiseName = isPending
    ? "Draft Room"
    : (isYourPick ? selection.teamName : context?.onClockTeamName) ||
      (selection.rosterId ? `Roster ${selection.rosterId}` : "Loading…");

  const round = context?.round ?? 0;
  const pick = context?.pick ?? 0;
  const timerLabel = isPending ? "--:--" : formatTimer(tickedSeconds);

  // Segment styling shared between cells. No rounded corners — segments are
  // separated by vertical dividers within a single bar.
  const segment: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: "100%",
    padding: "0 14px",
    borderRight: `2px solid ${dividerColor}`,
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: labelColor,
    lineHeight: 1,
    marginBottom: 4,
  };

  const valueStyle: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 20,
    fontWeight: 700,
    color: valueColor,
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "relative",
        background,
        borderTop: `2.5px solid ${INK}`,
        borderBottom: `2.5px solid ${INK}`,
        boxShadow: `4px 4px 0 ${INK}`,
      }}
    >
      <div
        className="flex w-full"
        style={{
          height: 64,
          alignItems: "stretch",
          color: franchiseTextColor,
        }}
      >
        {/* Franchise name + chip — flush left with comfortable padding. */}
        <div
          style={{
            ...segment,
            flex: "1 1 auto",
            gap: 12,
            minWidth: 0,
            paddingLeft: 20,
            paddingRight: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              fontSize: 18,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
            title={franchiseName}
          >
            {franchiseName}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: chipColor,
              border: chipBorder,
              borderRadius: 0,
              padding: "3px 7px",
              lineHeight: 1,
              background: "transparent",
            }}
          >
            {chipText}
          </span>
        </div>

        {/* Rd — pulled close to franchise name */}
        <div style={{ ...segment, flexDirection: "column", justifyContent: "center", padding: "0 12px" }}>
          <span style={labelStyle}>Rd</span>
          <span style={valueStyle}>{round || "—"}</span>
        </div>

        {/* Pk — also pulled close */}
        <div style={{ ...segment, flexDirection: "column", justifyContent: "center", padding: "0 12px" }}>
          <span style={labelStyle}>Pk</span>
          <span style={valueStyle}>{pick || "—"}</span>
        </div>

        {/* Timer — extra horizontal space */}
        <div
          style={{
            ...segment,
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 32px",
          }}
        >
          <span style={labelStyle}>Time</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 24,
              fontWeight: 700,
              color: timerColor,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.02em",
            }}
          >
            {timerLabel}
          </span>
        </div>

        {/* Action button — yellow, no border-right. Item 2: larger.
            Hidden in pending state. */}
        {actionLabel ? (
          <button
            type="button"
            onClick={handleAction}
            style={{
              background: YELLOW,
              color: INK,
              fontFamily: "var(--font-headline)",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontSize: 15,
              padding: "0 36px",
              border: "none",
              borderLeft: `2px solid ${dividerColor}`,
              borderRadius: 0,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
              height: "100%",
            }}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      <MuteToggle muted={muted} onToggle={toggleChimeMuted} />
    </div>
  );
}

function CountdownBlock({ value, label }: { value: number; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 26,
          color: INK,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {String(value).padStart(2, "0")}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          fontSize: 7,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: INK_LABEL,
          marginTop: 4,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function CountdownColon() {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        fontSize: 22,
        color: INK_COLON,
        lineHeight: 1,
        // Pull the colon up slightly so it sits on the digits row, not the labels.
        marginBottom: 11,
      }}
    >
      :
    </span>
  );
}

/**
 * Small mute / unmute toggle anchored to the top-right corner of the clock
 * bar. Controls whether the draft chime plays when a pick auto-announces.
 * State is held by the parent so it persists across renders within the
 * session (no localStorage per spec).
 */
function MuteToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={muted ? "Unmute draft chime" : "Mute draft chime"}
      title={muted ? "Unmute draft chime" : "Mute draft chime"}
      style={{
        position: "absolute",
        top: 4,
        right: 6,
        width: 22,
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: "rgba(255,255,255,0.6)",
        opacity: 0.85,
      }}
    >
      <SpeakerIcon muted={muted} />
    </button>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  // Simple inline SVG. Speaker body is shared; muted variant adds a strike;
  // unmuted variant adds two arc waves.
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6 H5 L9 3 V13 L5 10 H3 Z" fill="currentColor" />
      {muted ? (
        <>
          <line x1={11} y1={6} x2={14} y2={10} />
          <line x1={14} y1={6} x2={11} y2={10} />
        </>
      ) : (
        <>
          <path d="M11.5 6 Q12.5 8 11.5 10" />
          <path d="M13 4.5 Q15 8 13 11.5" />
        </>
      )}
    </svg>
  );
}
