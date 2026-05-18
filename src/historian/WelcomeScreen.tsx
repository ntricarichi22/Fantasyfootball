"use client";

import { ScrollText } from "lucide-react";

export const SUGGESTIONS = [
  "Who has won the most championships?",
  "Which player has scored the most total points?",
  "What was the biggest blowout in league history?",
];

type Props = {
  onPick: (q: string) => void;
  funFact: string | null;
  funFactLoading: boolean;
  funFactError: string | null;
};

export function WelcomeScreen({ onPick }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-8">
      <div className="cfc-ai-icon h-14 w-14">
        <ScrollText className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-3xl font-headline font-bold">CFC Historian</h1>
      <p className="mt-2 text-center text-sm" style={{ color: "var(--cfc-muted)" }}>
        Ask me anything about our league&apos;s history.
      </p>

      <div className="mt-8 w-full">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--cfc-muted)" }}>
          Try asking
        </p>
        <div className="grid grid-cols-3 gap-3">
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
