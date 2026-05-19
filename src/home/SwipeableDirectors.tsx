"use client";

import { useState, useRef, TouchEvent } from "react";
import { DirectorBox } from "@/home/DirectorBox";
import { DIRECTORS, type DirectorConfig } from "@/home/directors";

type Props = {
  onOfficeClick?: (director: DirectorConfig) => void;
  onWorkroomClick?: (href: string) => void;
};

const SWIPE_THRESHOLD = 50;

export default function SwipeableDirectors({
  onOfficeClick,
  onWorkroomClick,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx < 0 && activeIdx < DIRECTORS.length - 1) {
        setActiveIdx((i) => i + 1);
      } else if (dx > 0 && activeIdx > 0) {
        setActiveIdx((i) => i - 1);
      }
    }
    touchStartX.current = null;
  };

  const active = DIRECTORS[activeIdx];

  return (
    <div>
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: "pan-y" }}
      >
        <DirectorBox
          director={active}
          onOfficeClick={() => onOfficeClick?.(active)}
          onWorkroomClick={onWorkroomClick}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 8,
          marginTop: 14,
        }}
      >
        {DIRECTORS.map((d, i) => (
          <div
            key={d.key}
            onClick={() => setActiveIdx(i)}
            role="button"
            aria-label={`Show ${d.title}`}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: i === activeIdx ? "#1A1A1A" : "#C8C3B8",
              cursor: "pointer",
              transition: "background 0.2s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}