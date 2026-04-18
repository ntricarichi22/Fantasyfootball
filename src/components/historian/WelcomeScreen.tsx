"use client";

import { ScrollText, Sparkles } from "lucide-react";

import { Markdown } from "./markdown";

export const SUGGESTIONS = [
  "Who has won the most championships?",
  "What's the all-time record between Virginia Founders and Fairmount Freaks?",
  "Who was the best rookie draft pick ever?",
  "What was the worst benching decision in league history?",
  "Which team leaves the most points on the bench?",
  "Show me the biggest blowout in league history",
  "Which player has scored the most total points?",
  "Has any team ever gone undefeated in the regular season?",
];

type Props = {
  onPick: (q: string) => void;
  funFact: string | null;
  funFactLoading: boolean;
  funFactError: string | null;
};

export function WelcomeScreen({ onPick, funFact, funFactLoading, funFactError }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-10">
      <div className="cfc-ai-icon h-14 w-14">
        <ScrollText className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-3xl font-headline font-bold">CFC Historian</h1>
      <p className="mt-2 text-center text-sm" style={{ color: "var(--cfc-muted)" }}>
        Ask me anything about our league&apos;s history.
      </p>

      {/* Fun fact card */}
      <div className="mt-8 w-full cfc-copilot p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" style={{ color: "var(--cfc-red)" }} />
          <p className="text-xs font-semibold uppercase tracking-[0.18em]">
            📜 This Week in CFC History
          </p>
        </div>
        <div className="mt-3 min-h-[3.5rem]">
          {funFactLoading && !funFact ? (
            <div className="flex items-center gap-1.5" aria-label="Loading fun fact">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--cfc-red)] [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--cfc-red)] [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--cfc-red)]" />
            </div>
          ) : funFactError ? (
            <p className="text-sm" style={{ color: "var(--cfc-yellow)" }}>{funFactError}</p>
          ) : funFact ? (
            <Markdown text={funFact} />
          ) : (
            <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>No fact available right now.</p>
          )}
        </div>
      </div>

      {/* Suggestion chips */}
      <div className="mt-8 w-full">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--cfc-muted)" }}>
          Try asking
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="cfc-card cfc-chip-interactive px-4 py-3 text-left text-sm"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
