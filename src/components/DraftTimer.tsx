"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INITIAL_PICK_SECONDS, type DraftClockStatus } from "../lib/draftState";
const FALLBACK_TEAMS = [
  { name: "Team 1" },
  { name: "Team 2" },
  { name: "Team 3" },
  { name: "Team 4" },
];

type DraftTimerProps = {
  teams: { name: string }[];
  onPickMade?: (teamName: string, selection: string) => void | Promise<void>;
  onTeamChange?: (teamName: string) => void;
  externalPick?: { selection: string; alreadyRecorded?: boolean } | null;
  onExternalPickHandled?: () => void;
  registerStartHandler?: (handler: () => void) => void;
  onStart?: () => void;
  nextPickIndex?: number;
  currentTeamNameOverride?: string;
  currentPickLabelOverride?: string;
  clockStatus?: DraftClockStatus;
  clockSeconds?: number;
  onStartRequest?: () => Promise<boolean> | boolean;
};

export default function DraftTimer({
  teams,
  onPickMade,
  onTeamChange,
  externalPick,
  onExternalPickHandled,
  registerStartHandler,
  onStart,
  nextPickIndex,
  currentTeamNameOverride,
  currentPickLabelOverride,
  clockStatus,
  clockSeconds,
  onStartRequest,
}: DraftTimerProps) {
  const isExternalClock = clockStatus !== undefined && clockSeconds !== undefined;
  const [secondsLeft, setSecondsLeft] = useState(clockSeconds ?? INITIAL_PICK_SECONDS);
  const [isRunning, setIsRunning] = useState(clockStatus === "running");
  const [pickNumber, setPickNumber] = useState(1);
  const [currentTeamIndex, setCurrentTeamIndex] = useState(0);
  const hasStartedRef = useRef(false);
  const lastExternalPick = useRef<string | null>(null);

  const teamsForDraft = useMemo(
    () => (teams.length ? teams : FALLBACK_TEAMS),
    [teams]
  );

  useEffect(() => {
    if (isExternalClock) return;
    if (!isRunning) return;

    const intervalId = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isExternalClock, isRunning]);

  useEffect(() => {
    if (!isExternalClock) return;
    if ((clockStatus === "running" || clockStatus === "paused") && !hasStartedRef.current) {
      hasStartedRef.current = true;
      onStart?.();
    }
  }, [clockStatus, isExternalClock, onStart]);

  const effectiveSecondsLeft = isExternalClock
    ? Math.max(0, Math.round(clockSeconds ?? 0))
    : secondsLeft;
  const minutes = Math.floor(effectiveSecondsLeft / 60);
  const seconds = effectiveSecondsLeft % 60;
  const isCritical = effectiveSecondsLeft > 0 && effectiveSecondsLeft < 30;

  const hasExternalPickIndex =
    typeof nextPickIndex === "number" && nextPickIndex >= 0;
  const displayedPickNumber = hasExternalPickIndex
    ? nextPickIndex + 1
    : pickNumber;

  const pickLabel = useMemo(() => {
    if (currentPickLabelOverride) return currentPickLabelOverride;
    const teamCount = Math.max(teamsForDraft.length, 1);
    const round = Math.floor((displayedPickNumber - 1) / teamCount) + 1;
    const pickInRound = ((displayedPickNumber - 1) % teamCount) + 1;

    return `${round}.${String(pickInRound).padStart(2, "0")}`;
  }, [currentPickLabelOverride, displayedPickNumber, teamsForDraft.length]);

  const safeTeamIndex = teamsForDraft.length
    ? currentTeamIndex % teamsForDraft.length
    : 0;
  const derivedTeamIndex =
    hasExternalPickIndex && teamsForDraft.length
      ? nextPickIndex % teamsForDraft.length
      : safeTeamIndex;

  const currentTeamName =
    currentTeamNameOverride ||
    teamsForDraft[derivedTeamIndex]?.name ||
    "Team on the clock";

  const initializeDraft = useCallback(async () => {
    if (hasStartedRef.current) return;
    if (onStartRequest) {
      const allowed = await onStartRequest();
      if (!allowed) return;
    }
    hasStartedRef.current = true;
    onStart?.();
    setPickNumber(1);
    setCurrentTeamIndex(0);
    if (!isExternalClock) {
      setSecondsLeft(INITIAL_PICK_SECONDS);
      setIsRunning(true);
    }
    onTeamChange?.(teamsForDraft[0]?.name || "Team on the clock");
  }, [isExternalClock, onStart, onStartRequest, onTeamChange, teamsForDraft]);

  const completePick = useCallback(
    (selection: string, skipRecord?: boolean) => {
      const trimmed = selection.trim();
      if (!trimmed) return;

      if (!hasStartedRef.current) {
        initializeDraft();
      }

      if (!skipRecord) {
        onPickMade?.(currentTeamName, trimmed);
      }

      setPickNumber((prev) => prev + 1);
      setCurrentTeamIndex((prev) =>
        teamsForDraft.length ? (prev + 1) % teamsForDraft.length : 0
      );
      if (!isExternalClock) {
        setSecondsLeft(INITIAL_PICK_SECONDS);
        setIsRunning(true);
      }
    },
    [currentTeamName, initializeDraft, isExternalClock, onPickMade, teamsForDraft]
  );

  useEffect(() => {
    if (!teamsForDraft.length) return;
    // Inform parent whenever the team on the clock changes
    onTeamChange?.(currentTeamName);
  }, [currentTeamName, onTeamChange, teamsForDraft.length]);

  useEffect(() => {
    registerStartHandler?.(initializeDraft);
  }, [initializeDraft, registerStartHandler]);

  useEffect(() => {
    if (!externalPick) {
      lastExternalPick.current = null;
      return;
    }
    if (lastExternalPick.current === externalPick.selection) return;
    lastExternalPick.current = externalPick.selection;
    // Defer to next tick to avoid synchronous state updates inside effect
    const timeoutId = window.setTimeout(() => {
      completePick(externalPick.selection, externalPick.alreadyRecorded);
      onExternalPickHandled?.();
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [completePick, externalPick, onExternalPickHandled]);

  return (
    <div className="w-full">
      <div className="cfc-card-ink flex flex-wrap items-center gap-4 px-5 py-4">
        <span
          className="font-headline text-[11px] font-bold uppercase tracking-[0.2em]"
          style={{ color: "#999" }}
        >
          On the clock
        </span>
        <span className="font-headline text-2xl text-white truncate">
          {currentTeamName}
        </span>
        <span
          className="cfc-mono text-lg"
          style={{
            background: "var(--cfc-yellow)",
            color: "var(--cfc-ink)",
            padding: "4px 10px",
            border: "2px solid var(--cfc-ink)",
            borderRadius: "4px",
            fontWeight: 800,
          }}
        >
          {pickLabel}
        </span>
        <span
          className={`ml-auto cfc-mono text-4xl font-extrabold tabular ${
            isCritical ? "text-[var(--cfc-red)]" : "text-white"
          }`}
        >
          {String(minutes).padStart(2, "0")}:
          {String(seconds).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
