"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { useDraftStatusContext } from "@/scouting/draft-room/chrome/DraftStatusProvider";
import { useDraftClockContext } from "@/scouting/draft-room/hooks/useDraftClockContext";
import { computeSecondsUntilAnnouncement } from "@/scouting/draft-room/draftState";
import { getSupabaseClient } from "@/infrastructure/supabase/client";
import { normalizeName } from "@/infrastructure/strings/normalize";
import { playChime } from "@/scouting/draft-room/chime";

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";

const BAR_BLUE = "#3366CC";
const BAR_YELLOW = "#F5C230";
const INK = "#1A1A1A";
const PAPER = "#FEFCF9";
const DIVIDER_ON_BLUE = "rgba(255,255,255,0.15)";
const LABEL_ON_BLUE_SMALL = "rgba(255,255,255,0.5)";
const PICK_CTX_ON_BLUE = "rgba(255,255,255,0.6)";
const DIVIDER_ON_YELLOW = "rgba(26,26,26,0.2)";
const LABEL_ON_YELLOW = "rgba(26,26,26,0.55)";
const PICK_CTX_ON_YELLOW = "rgba(26,26,26,0.65)";

type StoredSelection = {
  rosterId?: string;
  teamName?: string;
};

const readStoredSelection = (): StoredSelection => {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      rosterId: typeof parsed?.rosterId === "string" ? parsed.rosterId : undefined,
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : undefined,
    };
  } catch {
    return {};
  }
};

const formatTimer = (totalSeconds: number) => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

// Reveal-line is name-only on mobile (no position / school / dots) — see
// MobileClockBar reveal branch. Scale font size with name length so the
// full name always fits without truncation. Bounded 10px..15px.
const revealNameFontSize = (name: string): number => {
  const len = (name ?? "").length;
  if (len <= 12) return 15;
  if (len <= 16) return 13;
  if (len <= 20) return 11;
  return 10;
};

const computeCountdownParts = (startsAtMs: number, nowMs: number) => {
  const total = Math.max(0, Math.floor((startsAtMs - nowMs) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { total, days, hours, minutes, seconds };
};

/**
 * Mobile clock bar — 50px tall, fixed in the vertical stack just below the
 * 40px top bar. Mirrors the state machine of the desktop ClockBar
 * (default, your-pick yellow, "pick is in", pre-draft countdown, reveal
 * animation) but laid out for a narrow viewport with smaller type.
 */
export function MobileClockBar() {
  const { isActive, secondsRemaining, state } = useDraftStatusContext();

  const startsAtMs =
    state?.starts_at && typeof state.starts_at === "string"
      ? new Date(state.starts_at).getTime()
      : NaN;

  // Hydration-safe `Date.now()` — start at 0 server-side, set on mount.
  const [countdownNow, setCountdownNow] = useState(0);
  useEffect(() => {
    setCountdownNow(Date.now());
  }, []);

  const hasFutureStart =
    Number.isFinite(startsAtMs) &&
    state?.status === "not_started" &&
    countdownNow > 0 &&
    startsAtMs > countdownNow;

  const context = useDraftClockContext({
    disabled: !isActive && !hasFutureStart,
  });

  const [selection, setSelection] = useState<StoredSelection>({});
  useEffect(() => {
    setSelection(readStoredSelection());
    const handle = () => setSelection(readStoredSelection());
    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, []);

  // Local 1s tick.
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

  // Pick-is-in countdown.
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

  // Pre-draft countdown re-tick.
  useEffect(() => {
    if (!hasFutureStart) return;
    const id = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasFutureStart]);

  // ----- Reveal animation subscription -----------------------------------
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

  const lastRevealedIndexRef = useRef<number | null>(null);
  const collegeMapRef = useRef<Record<string, string> | null>(null);
  const revealTimeoutsRef = useRef<number[]>([]);

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
      if (lastRevealedIndexRef.current === pickIndex) return;

      const playerName = typeof row.player_name === "string" ? row.player_name : "";
      if (!playerName) return;

      lastRevealedIndexRef.current = pickIndex;

      // Mirror desktop ClockBar: dispatch the board-refresh signal at the
      // exact moment the reveal begins so useDraftRoomLog re-pulls
      // /api/scouting/draft/log immediately. The drafted player leaves the board
      // simultaneously with the reveal animation instead of waiting up to
      // 3s for DraftStatusProvider's next tick poll.
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

      revealTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      revealTimeoutsRef.current = [];

      setRevealedPick({ pickIndex, teamName, playerName, position, school });
      setRevealPhase("slide-out");

      const t1 = window.setTimeout(() => {
        setRevealPhase("fly-in");
        playChime();
      }, 850);

      const t2 = window.setTimeout(() => {
        setRevealedPick(null);
        setRevealPhase("slide-out");
      }, 9750);

      revealTimeoutsRef.current = [t1, t2];
    },
    [loadCollegeMap]
  );

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const channel = supabase.channel("mobile-clock-bar-reveal").on(
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
      console.warn("Unable to subscribe to mobile draft_log reveal updates", error);
    }
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore teardown errors
      }
    };
  }, [triggerReveal]);

  // Auto-tick on zero (same logic as desktop).
  const timeLeft = isPickIn ? announceSeconds : tickedSeconds;
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
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("draft-log-refetch-requested"));
        }
      })
      .catch(() => {
        tickFiredRef.current = false;
      });
  }, [timeLeft, state?.status]);

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

  // ---------------- Render ----------------
  // Reveal animation takes over the whole bar for ~9.75s.
  if (revealedPick) {
    const isFlyIn = revealPhase === "fly-in";
    return (
      <div className="cfc-mobile-clockbar" data-state="reveal" role="status" aria-live="polite">
        <div className="cfc-mobile-clockbar-reveal">
          {!isFlyIn ? (
            <span
              className="cfc-mobile-clockbar-reveal-label"
              ref={(el) => {
                if (!el) return;
                el.style.transform = "translateY(0)";
                requestAnimationFrame(() => {
                  el.style.transform = "translateY(60px)";
                });
              }}
            >
              The Pick Is In
            </span>
          ) : (
            <span
              className="cfc-mobile-clockbar-reveal-line"
              style={{ fontSize: revealNameFontSize(revealedPick.playerName) }}
              ref={(el) => {
                if (!el) return;
                el.style.transform = "translateY(-60px)";
                requestAnimationFrame(() => {
                  el.style.transform = "translateY(0)";
                });
              }}
            >
              <span className="cfc-mobile-clockbar-reveal-name">
                {revealedPick.playerName}
              </span>
            </span>
          )}
        </div>
      </div>
    );
  }

  // Pre-draft countdown.
  if (hasFutureStart) {
    const parts = computeCountdownParts(startsAtMs, countdownNow);
    const firstPickTeamName = context?.onClockTeamName || "";
    const teamLine = firstPickTeamName
      ? `${firstPickTeamName.toUpperCase()} UP FIRST`
      : "DRAFT BEGINS IN";
    const countdownText = `${String(parts.days).padStart(2, "0")}d ${String(parts.hours).padStart(2, "0")}h ${String(parts.minutes).padStart(2, "0")}m`;
    return (
      <div className="cfc-mobile-clockbar" data-state="countdown" role="status" aria-live="polite">
        <div className="cfc-mobile-clockbar-left">
          <span className="cfc-mobile-clockbar-team" title={teamLine}>
            {teamLine}
          </span>
          <span
            className="cfc-mobile-clockbar-context"
            style={{ color: PICK_CTX_ON_BLUE }}
          >
            CFC Draft Begins
          </span>
        </div>
        <div className="cfc-mobile-clockbar-right" style={{ borderLeftColor: DIVIDER_ON_BLUE }}>
          <span className="cfc-mobile-clockbar-time-label" style={{ color: LABEL_ON_BLUE_SMALL }}>
            Starts In
          </span>
          <span className="cfc-mobile-clockbar-time" style={{ color: PAPER }}>
            {countdownText}
          </span>
        </div>
      </div>
    );
  }

  // Pick is in.
  // Match the desktop ClockBar treatment: full blue bar, big yellow
  // "THE PICK IS IN" filling the center, "ANNOUNCING" countdown on the
  // right. The team name is intentionally omitted on mobile so the
  // emphasis text gets the full width minus the countdown column and
  // never truncates.
  if (isPickIn) {
    return (
      <div
        className="cfc-mobile-clockbar"
        data-state="pick-in"
        role="status"
        aria-live="polite"
      >
        {/* CENTER — "THE PICK IS IN" — prominent, yellow, fills space. */}
        <div className="cfc-mobile-clockbar-pickin">
          <span className="cfc-mobile-clockbar-pickin-label">The Pick Is In</span>
        </div>

        {/* RIGHT — announcing-in countdown. */}
        <div
          className="cfc-mobile-clockbar-right"
          style={{ borderLeftColor: DIVIDER_ON_BLUE }}
        >
          <span
            className="cfc-mobile-clockbar-time-label"
            style={{ color: LABEL_ON_BLUE_SMALL }}
          >
            Announcing
          </span>
          <span className="cfc-mobile-clockbar-time" style={{ color: PAPER }}>
            {formatTimer(announceSeconds)}
          </span>
        </div>
      </div>
    );
  }

  // Default + your-pick (active or pending).
  const isPending = !isActive;
  const isYourPick =
    !isPending &&
    !!selection.rosterId &&
    !!context?.onClockRosterId &&
    selection.rosterId === context.onClockRosterId;

  const teamName = isPending
    ? "Draft Room"
    : isYourPick
      ? "You're on the clock"
      : (context?.onClockTeamName ||
        (selection.rosterId ? `Roster ${selection.rosterId}` : "Loading…"));

  const round = context?.round ?? 0;
  const pick = context?.pick ?? 0;
  const pickContext = isPending
    ? state?.status === "paused"
      ? "Draft paused"
      : "Draft not started"
    : `Round ${round || "—"} · Pick ${pick || "—"}`;

  const timerLabel = isPending ? "--:--" : formatTimer(tickedSeconds);
  const timeLabel = isYourPick ? "Remaining" : "On the clock";

  const containerStyle: CSSProperties = isYourPick
    ? { background: BAR_YELLOW, color: INK }
    : { background: BAR_BLUE, color: PAPER };

  return (
    <div
      className="cfc-mobile-clockbar"
      data-state={isYourPick ? "your-pick" : "default"}
      role="status"
      aria-live="polite"
      style={containerStyle}
    >
      <div className="cfc-mobile-clockbar-left">
        <span
          className="cfc-mobile-clockbar-team"
          title={teamName}
          style={{ color: isYourPick ? INK : PAPER }}
        >
          {teamName}
        </span>
        <span
          className="cfc-mobile-clockbar-context"
          style={{ color: isYourPick ? PICK_CTX_ON_YELLOW : PICK_CTX_ON_BLUE }}
        >
          {pickContext}
        </span>
      </div>
      <div
        className="cfc-mobile-clockbar-right"
        style={{ borderLeftColor: isYourPick ? DIVIDER_ON_YELLOW : DIVIDER_ON_BLUE }}
      >
        <span
          className="cfc-mobile-clockbar-time-label"
          style={{ color: isYourPick ? LABEL_ON_YELLOW : LABEL_ON_BLUE_SMALL }}
        >
          {timeLabel}
        </span>
        <span
          className="cfc-mobile-clockbar-time"
          style={{ color: isYourPick ? INK : PAPER }}
        >
          {timerLabel}
        </span>
      </div>
    </div>
  );
}
