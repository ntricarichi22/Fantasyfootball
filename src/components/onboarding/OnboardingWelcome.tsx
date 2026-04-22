"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onComplete: () => void;
  teamName: string;
};

const PACK_W = 220;
const PACK_H = 300;

const TEAR_POINTS_NORM: Array<[number, number]> = [
  [0, 0.5], [0.05, 0.47], [0.1, 0.52], [0.15, 0.45], [0.2, 0.51], [0.27, 0.44],
  [0.33, 0.53], [0.4, 0.46], [0.46, 0.5], [0.52, 0.43], [0.58, 0.52], [0.64, 0.47],
  [0.7, 0.54], [0.76, 0.45], [0.82, 0.5], [0.88, 0.46], [0.94, 0.52], [1, 0.49],
];

const TEAR_POINTS = TEAR_POINTS_NORM.map(([x, y]) => [x * PACK_W, y * PACK_H] as [number, number]);

const SPARKLE_COLORS = ["#F5C230", "#fff", "#E8503A", "#3366CC"];

type Sparkle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
  size: number;
};

const tearPathD = (() => {
  if (!TEAR_POINTS.length) return "";
  const [first, ...rest] = TEAR_POINTS;
  return `M ${first[0]} ${first[1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(" ");
})();

const tearTopHalfClipPath = (() => {
  let d = `M 0 0 L ${PACK_W} 0 L ${PACK_W} ${TEAR_POINTS[TEAR_POINTS.length - 1][1]} `;
  for (let i = TEAR_POINTS.length - 1; i >= 0; i--) {
    d += `L ${TEAR_POINTS[i][0]} ${TEAR_POINTS[i][1]} `;
  }
  d += "Z";
  return d;
})();

const tearBottomHalfClipPath = (() => {
  let d = `M 0 ${PACK_H} L ${PACK_W} ${PACK_H} L ${PACK_W} ${TEAR_POINTS[TEAR_POINTS.length - 1][1]} `;
  for (let i = TEAR_POINTS.length - 1; i >= 0; i--) {
    d += `L ${TEAR_POINTS[i][0]} ${TEAR_POINTS[i][1]} `;
  }
  d += "Z";
  return d;
})();

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const PackFace = ({ id }: { id: string }) => (
  <g>
    <defs>
      <linearGradient id={`${id}-base`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#E8503A" />
        <stop offset="55%" stopColor="#c73a28" />
        <stop offset="100%" stopColor="#3366CC" />
      </linearGradient>
      <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
        <stop offset="50%" stopColor="rgba(255,255,255,0)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.08)" />
      </linearGradient>
    </defs>
    <rect x={0} y={0} width={PACK_W} height={PACK_H} fill={`url(#${id}-base)`} />
    <g transform="skewX(-18)">
      {Array.from({ length: 9 }).map((_, i) => (
        <rect
          key={i}
          x={-40 + i * 32}
          y={-20}
          width={12}
          height={PACK_H + 80}
          fill="rgba(0,0,0,0.1)"
        />
      ))}
    </g>
    <rect x={0} y={0} width={PACK_W} height={PACK_H} fill={`url(#${id}-sheen)`} />
    <rect x={0} y={0} width={PACK_W} height={44} fill="#3366CC" />
    <rect x={0} y={41} width={PACK_W} height={3} fill="#1A1A1A" />
    <text x={10} y={28} fontFamily="JetBrains Mono, monospace" fontWeight={800} fontSize={11} fill="#F5C230">2026</text>
    <text x={PACK_W / 2} y={28} fontFamily="Syne, sans-serif" fontWeight={900} fontSize={11} fill="#fff" textAnchor="middle">CFC FRONT OFFICE</text>
    <text x={PACK_W - 10} y={28} fontFamily="JetBrains Mono, monospace" fontWeight={800} fontSize={11} fill="#F5C230" textAnchor="end">S.8</text>
    <image
      href="/cfc-logo.png"
      x={(PACK_W - 64) / 2}
      y={PACK_H / 2 - 40}
      width={64}
      height={64}
      style={{ filter: "brightness(0) invert(1)" }}
    />
    <text x={PACK_W / 2} y={PACK_H / 2 + 40} fontFamily="DM Sans, sans-serif" fontWeight={900} fontSize={10} fill="rgba(255,255,255,0.45)" textAnchor="middle" letterSpacing={4}>DYNASTY</text>
    <rect x={0} y={PACK_H - 44} width={PACK_W} height={44} fill="#F5C230" />
    <rect x={0} y={PACK_H - 44} width={PACK_W} height={3} fill="#1A1A1A" />
    <text x={10} y={PACK_H - 18} fontFamily="DM Sans, sans-serif" fontWeight={900} fontSize={9} fill="#1A1A1A">DYNASTY LEAGUE</text>
    <text x={PACK_W / 2} y={PACK_H - 18} fontFamily="DM Sans, sans-serif" fontWeight={900} fontSize={9} fill="#1A1A1A" textAnchor="middle">12 TEAMS</text>
    <text x={PACK_W - 10} y={PACK_H - 18} fontFamily="DM Sans, sans-serif" fontWeight={900} fontSize={10} fill="#1A1A1A" textAnchor="end">TEAR HERE →</text>
  </g>
);

export default function OnboardingWelcome({ onComplete, teamName }: Props) {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [statusText, setStatusText] = useState("Tap to open");

  const [topY, setTopY] = useState(0);
  const [bottomY, setBottomY] = useState(0);
  const [tearProgress, setTearProgress] = useState(0);
  const [cardOpacity, setCardOpacity] = useState(0);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const sparklesRef = useRef<Sparkle[]>([]);
  const rafRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  const spawnBurst = (count: number) => {
    const burst: Sparkle[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const idx = Math.min(TEAR_POINTS.length - 2, Math.floor(t * (TEAR_POINTS.length - 1)));
      const [x1, y1] = TEAR_POINTS[idx];
      const [x2, y2] = TEAR_POINTS[idx + 1];
      const f = t * (TEAR_POINTS.length - 1) - idx;
      const x = x1 + (x2 - x1) * f;
      const y = y1 + (y2 - y1) * f;
      burst.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4 - 1,
        life: 1,
        decay: 0.03 + Math.random() * 0.04,
        color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
        size: 2 + Math.random() * 3,
      });
    }
    sparklesRef.current = sparklesRef.current.concat(burst);
  };

  const startAnim = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("running");
    setStatusText("Opening your pack…");

    const t0 = performance.now();
    let secondBurstFired = false;
    let firstBurstFired = false;

    const tick = (now: number) => {
      const elapsed = now - t0;

      if (elapsed < 200) {
        const p = elapsed / 200;
        setTopY(-6 * p);
        setBottomY(6 * p);
      } else if (elapsed < 680) {
        setTopY(-6);
        setBottomY(6);
        const p = (elapsed - 200) / (680 - 200);
        setTearProgress(p);
        if (!firstBurstFired) {
          firstBurstFired = true;
          spawnBurst(18);
        }
      } else if (elapsed < 1230) {
        setTearProgress(1);
        const p = easeInOutQuad((elapsed - 680) / (1230 - 680));
        setTopY(-6 + (-260 - -6) * p);
        setBottomY(6 + (280 - 6) * p);
        setCardOpacity(p);
        if (!secondBurstFired) {
          secondBurstFired = true;
          spawnBurst(18);
        }
      } else {
        setTopY(-260);
        setBottomY(280);
        setCardOpacity(1);
        setTearProgress(1);
        if (!completedRef.current) {
          completedRef.current = true;
          setPhase("done");
          setStatusText("");
          window.setTimeout(() => onComplete(), 80);
        }
      }

      const next: Sparkle[] = [];
      for (const s of sparklesRef.current) {
        const nv: Sparkle = {
          ...s,
          x: s.x + s.vx,
          y: s.y + s.vy,
          vy: s.vy + 0.15,
          life: s.life - s.decay,
        };
        if (nv.life > 0) next.push(nv);
      }
      sparklesRef.current = next;
      setSparkles(next);

      if (elapsed < 1230 || sparklesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const tearStrokeStyle: React.CSSProperties = {
    strokeDasharray: 1000,
    strokeDashoffset: 1000 - tearProgress * 1000,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F5F0E6", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          background: "#1A1A1A",
          borderBottom: "2.5px solid #1A1A1A",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cfc-logo.png" alt="" style={{ height: 28 }} />
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 9,
            color: "#555",
            textTransform: "uppercase",
            letterSpacing: 2,
          }}
        >
          Front Office
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 24px" }}>
        <span className="cfc-section-tag" style={{ marginBottom: 14 }}>New Member</span>
        <h1
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: 34,
            color: "#1A1A1A",
            textAlign: "center",
            lineHeight: 1.05,
            margin: 0,
            marginBottom: 10,
          }}
        >
          Every GM gets a card. Time to pull yours.
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontSize: 13,
            color: "#8C7E6A",
            textAlign: "center",
            margin: 0,
            marginBottom: 36,
          }}
        >
          Tear open your pack to get started.
        </p>

        <div style={{ position: "relative", width: PACK_W, height: PACK_H }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#FEFCF9",
              border: "2.5px solid #1A1A1A",
              borderRadius: 10,
              boxShadow: "6px 6px 0 #1A1A1A",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              opacity: cardOpacity,
              zIndex: 1,
              textAlign: "center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cfc-logo.png" alt="" style={{ height: 56, marginBottom: 14 }} />
            <h2
              style={{
                fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                fontWeight: 900,
                fontSize: 20,
                color: "#1A1A1A",
                margin: 0,
                marginBottom: 10,
              }}
            >
              Let&apos;s build your profile.
            </h2>
            <div style={{ width: 36, height: 3, background: "#E8503A", marginBottom: 10 }} />
            <p
              style={{
                fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                fontSize: 11,
                color: "#8C7E6A",
                margin: 0,
              }}
            >
              {teamName}
            </p>
          </div>

          <button
            type="button"
            onClick={startAnim}
            disabled={phase !== "idle"}
            aria-label="Open pack"
            style={{
              position: "absolute",
              inset: 0,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: phase === "idle" ? "pointer" : "default",
              zIndex: 2,
            }}
          >
            <svg
              width={PACK_W}
              height={PACK_H}
              viewBox={`0 0 ${PACK_W} ${PACK_H}`}
              style={{ overflow: "visible", display: "block" }}
            >
              <defs>
                <clipPath id="cfc-pack-top-clip">
                  <path d={tearTopHalfClipPath} />
                </clipPath>
                <clipPath id="cfc-pack-bottom-clip">
                  <path d={tearBottomHalfClipPath} />
                </clipPath>
              </defs>

              <g
                clipPath="url(#cfc-pack-top-clip)"
                transform={`translate(0, ${topY})`}
                style={{ filter: "drop-shadow(4px 4px 0 #1A1A1A)" }}
              >
                <PackFace id="cfc-pack-top" />
                <rect x={0} y={0} width={PACK_W} height={PACK_H} fill="none" stroke="#1A1A1A" strokeWidth={2.5} />
              </g>
              <g
                clipPath="url(#cfc-pack-bottom-clip)"
                transform={`translate(0, ${bottomY})`}
                style={{ filter: "drop-shadow(4px 4px 0 #1A1A1A)" }}
              >
                <PackFace id="cfc-pack-bottom" />
                <rect x={0} y={0} width={PACK_W} height={PACK_H} fill="none" stroke="#1A1A1A" strokeWidth={2.5} />
              </g>

              {phase !== "idle" && (
                <path
                  d={tearPathD}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  style={tearStrokeStyle}
                  transform={`translate(0, ${(topY + bottomY) / 2})`}
                />
              )}

              {sparkles.map((s, i) => (
                <rect
                  key={i}
                  x={s.x - s.size / 2}
                  y={s.y - s.size / 2}
                  width={s.size}
                  height={s.size}
                  fill={s.color}
                  opacity={Math.max(0, s.life)}
                />
              ))}
            </svg>
          </button>
        </div>

        <div
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            color: "#8C7E6A",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginTop: 20,
            minHeight: 14,
          }}
        >
          {statusText}
        </div>
      </div>
    </div>
  );
}
