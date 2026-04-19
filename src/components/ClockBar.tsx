"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useDraftStatusContext } from "./DraftStatusProvider";
import { useDraftClockContext } from "../lib/hooks/useDraftClockContext";
import { computeSecondsUntilAnnouncement } from "../lib/draftState";

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";
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

  // Pre-draft countdown ticking (per-second local). Initialized lazily so
  // render is pure on the server snapshot.
  const [countdownNow, setCountdownNow] = useState(() => Date.now());

  const hasFutureStart =
    Number.isFinite(startsAtMs) && state?.status === "not_started" && startsAtMs > countdownNow;

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
    setSelection(readStoredSelection());
    const handle = () => setSelection(readStoredSelection());
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

  // When the announcement countdown hits 0, fire a single best-effort
  // "announce" call so whichever client is watching nudges the server to
  // reveal the pick and advance the clock. Multiple clients calling this is
  // safe because the API is idempotent (it no-ops once the pick is announced).
  const announceFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPickIn) {
      announceFiredRef.current = null;
      return;
    }
    if (announceSeconds > 0) return;
    const key = state?.pick_announced_at ?? "";
    if (announceFiredRef.current === key) return;
    announceFiredRef.current = key;
    fetch("/api/draft-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "announce" }),
    }).catch(() => {
      // Best-effort: another client (or the next poll) will retry.
      announceFiredRef.current = null;
    });
  }, [isPickIn, announceSeconds, state?.pick_announced_at]);

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
    fetch("/api/draft-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).catch(() => {
      startFiredRef.current = null;
    });
  }, [hasFutureStart, startsAtMs, countdownNow, state?.starts_at]);

  // Visibility: render the bar when the draft is active OR we're on the draft
  // route OR a pre-draft countdown is scheduled (so the countdown shows
  // globally on every page, per spec).
  if (!isActive && !isDraftRoute && !hasFutureStart) return null;

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
    onClockState === "your-pick"
      ? "Shop this pick"
      : onClockState === "on-clock-draft"
        ? "Trade up"
        : onClockState === "on-clock-other"
          ? "Back to draft"
          : null;

  const handleAction = () => {
    if (onClockState === "pending") return;
    if (onClockState === "on-clock-other") {
      router.push(DRAFT_ROUTE);
    } else {
      // "Shop this pick" and "Trade up" both go to the trade center.
      // Trade-context preloading lands in PR 7.
      router.push(TRADE_ROUTE);
    }
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
