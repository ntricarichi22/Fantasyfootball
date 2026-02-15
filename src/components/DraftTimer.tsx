"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TOTAL_SECONDS = 5 * 60;
const FALLBACK_TEAMS = [
  { name: "Team 1" },
  { name: "Team 2" },
  { name: "Team 3" },
  { name: "Team 4" },
];

type DraftTimerProps = {
  teams: { name: string }[];
  onPickMade?: (teamName: string, selection: string) => void;
  onTeamChange?: (teamName: string) => void;
  externalPick?: { selection: string; alreadyRecorded?: boolean } | null;
  onExternalPickHandled?: () => void;
};

export default function DraftTimer({
  teams,
  onPickMade,
  onTeamChange,
  externalPick,
  onExternalPickHandled,
}: DraftTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [pickNumber, setPickNumber] = useState(1);
  const [currentTeamIndex, setCurrentTeamIndex] = useState(0);
  const [draftSelection, setDraftSelection] = useState("");
  const lastExternalPick = useRef<string | null>(null);

  const teamsForDraft = teams.length ? teams : FALLBACK_TEAMS;

  useEffect(() => {
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
  }, [isRunning]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const isCritical = secondsLeft > 0 && secondsLeft < 30;

  const pickLabel = useMemo(() => {
    const teamCount = Math.max(teamsForDraft.length, 1);
    const round = Math.floor((pickNumber - 1) / teamCount) + 1;
    const pickInRound = ((pickNumber - 1) % teamCount) + 1;

    return `${round}.${String(pickInRound).padStart(2, "0")}`;
  }, [pickNumber, teamsForDraft.length]);

  const safeTeamIndex = teamsForDraft.length
    ? currentTeamIndex % teamsForDraft.length
    : 0;

  const currentTeamName =
    teamsForDraft[safeTeamIndex]?.name || "Team on the clock";

  const completePick = useCallback(
    (selection: string, skipRecord?: boolean) => {
      const trimmed = selection.trim();
      if (!trimmed) return;

      if (!hasStarted) {
        setHasStarted(true);
        setPickNumber(1);
        setCurrentTeamIndex(0);
        setSecondsLeft(TOTAL_SECONDS);
        onTeamChange?.(teamsForDraft[0]?.name || "Team on the clock");
      }

      if (!skipRecord) {
        onPickMade?.(currentTeamName, trimmed);
      }

      setDraftSelection("");
      setPickNumber((prev) => prev + 1);
      setCurrentTeamIndex((prev) =>
        teamsForDraft.length ? (prev + 1) % teamsForDraft.length : 0
      );
      setSecondsLeft(TOTAL_SECONDS);
      setIsRunning(true);
    },
    [
      currentTeamName,
      hasStarted,
      onPickMade,
      onTeamChange,
      teamsForDraft,
    ]
  );

  useEffect(() => {
    if (!teamsForDraft.length) return;
    // Inform parent whenever the team on the clock changes
    onTeamChange?.(currentTeamName);
  }, [currentTeamName, onTeamChange, teamsForDraft.length]);

  const startDraft = () => {
    setHasStarted(true);
    setPickNumber(1);
    setCurrentTeamIndex(0);
    setSecondsLeft(TOTAL_SECONDS);
    setIsRunning(true);
    onTeamChange?.(teamsForDraft[0]?.name || "Team on the clock");
  };

  const makePick = () => {
    if (!hasStarted) return;

    const trimmed = draftSelection.trim();
    if (!trimmed) return;

    completePick(trimmed);
  };

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
    <div className="w-full max-w-4xl space-y-4">
      <div className="flex items-center justify-between rounded-xl bg-slate-900 px-6 py-4 shadow-lg">
        <div className="text-sm uppercase tracking-widest text-slate-400">
          On the Clock
        </div>
        <div className="flex items-center gap-4 text-lg font-semibold text-white">
          <span className="rounded-lg bg-slate-800 px-3 py-1 text-sm font-medium text-slate-200">
            Pick {pickLabel}
          </span>
          <span className="text-slate-200">{currentTeamName}</span>
          <span
            className={`font-mono text-3xl tabular-nums ${
              isCritical ? "text-red-300" : "text-white"
            }`}
          >
            {String(minutes).padStart(2, "0")}:
            {String(seconds).padStart(2, "0")}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-800"
          onClick={startDraft}
          disabled={isRunning && hasStarted}
        >
          Start Draft
        </button>
        <input
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none border border-slate-700 focus:border-blue-500"
          placeholder="Player drafted (name or ID)"
          value={draftSelection}
          onChange={(e) => setDraftSelection(e.target.value)}
        />
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900"
          onClick={makePick}
          disabled={!hasStarted}
        >
          Make Pick
        </button>
      </div>
    </div>
  );
}
