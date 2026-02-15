"use client";

import { useEffect, useState } from "react";

const TOTAL_SECONDS = 5 * 60;

export default function DraftTimer() {
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setSecondsLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  const isCritical = secondsLeft > 0 && secondsLeft < 30;

  return (
    <div className="flex items-center justify-center p-6">
      <div
        className={`rounded-2xl bg-slate-900 px-8 py-6 text-center text-white shadow-xl transition-transform duration-300 ${
          isCritical ? "animate-pulse scale-110" : "scale-100"
        }`}
      >
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-slate-300">
          Draft Timer
        </p>
        <p className="font-mono text-5xl font-bold tabular-nums">
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </p>
      </div>
    </div>
  );
}
