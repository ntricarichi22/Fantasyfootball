"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useDraftStatusContext } from "./DraftStatusProvider";
import { useDraftClockContext } from "../lib/hooks/useDraftClockContext";
import { computeSecondsUntilAnnouncement } from "../lib/draftState";

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";
const DRAFT_ROUTE = "/draft";
const TRADE_ROUTE = "/trades";

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

export default function ClockBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { isActive, secondsRemaining, state } = useDraftStatusContext();
  const isDraftRoute = pathname?.startsWith(DRAFT_ROUTE) ?? false;
  // Poll clock context whenever the bar is rendered (active draft anywhere,
  // or any visit to /draft so round/pick/team can populate as soon as the
  // commissioner kicks the draft off).
  const context = useDraftClockContext({ disabled: !isActive && !isDraftRoute });

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

  if (!isActive && !isDraftRoute) return null;

  const isPending = !isActive;
  const isYourPick =
    !isPending &&
    !isPickIn &&
    !!selection.rosterId &&
    !!context?.onClockRosterId &&
    selection.rosterId === context.onClockRosterId;

  type BarState =
    | "your-pick"
    | "on-clock-draft"
    | "on-clock-other"
    | "pick-in-draft"
    | "pick-in-other"
    | "pending";

  const onClockState: BarState = isPending
    ? "pending"
    : isPickIn
      ? isDraftRoute
        ? "pick-in-draft"
        : "pick-in-other"
      : isYourPick && isDraftRoute
        ? "your-pick"
        : isDraftRoute
          ? "on-clock-draft"
          : "on-clock-other";

  const isRed = onClockState === "your-pick";
  const isPickInState = onClockState === "pick-in-draft" || onClockState === "pick-in-other";
  const background = isRed ? "#E8503A" : "#1A1A1A";
  const dividerColor = isRed ? "rgba(255,255,255,0.2)" : "#333";
  const timerColor = isRed ? "#FFFFFF" : isPickInState ? "#FFFFFF" : "#F5C230";
  const labelColor = isRed ? "rgba(255,255,255,0.7)" : "#999";
  const valueColor = isRed ? "#FFFFFF" : "#F5C230";
  const franchiseTextColor = "#FFFFFF";

  const chipText = isPending
    ? state?.status === "paused"
      ? "Draft paused"
      : "Draft not started"
    : isPickInState
      ? "The pick is in"
      : isRed
        ? "Your pick"
        : "On the clock";
  // Chip border: green for "pick is in", white on red, yellow on dark.
  const chipBorder = isPickInState
    ? "1.5px solid #4CAF50"
    : isRed
      ? "1.5px solid #FFFFFF"
      : "1.5px solid #F5C230";
  const chipColor = isPickInState ? "#FFFFFF" : isRed ? "#FFFFFF" : "#F5C230";

  const actionLabel =
    onClockState === "your-pick"
      ? "Shop this pick"
      : onClockState === "on-clock-draft" || onClockState === "pick-in-draft"
        ? "Trade up"
        : onClockState === "on-clock-other" || onClockState === "pick-in-other"
          ? "Back to draft"
          : null;

  const handleAction = () => {
    if (onClockState === "pending") return;
    if (onClockState === "on-clock-other" || onClockState === "pick-in-other") {
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
  const timerLabel = isPending
    ? "--:--"
    : isPickInState
      ? formatTimer(announceSeconds)
      : formatTimer(tickedSeconds);

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
        borderTop: "2.5px solid #1A1A1A",
        borderBottom: "2.5px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
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

        {/* Action button — yellow segment, no border-right. Hidden in pending state. */}
        {actionLabel ? (
          <button
            type="button"
            onClick={handleAction}
            style={{
              background: "#F5C230",
              color: "#1A1A1A",
              fontFamily: "var(--font-headline)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: 10,
              padding: "0 28px",
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
