"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onComplete: () => void;
  teamName: string;
};

const ENV_W = 280;
const ENV_H = 176;

const TEAR_PATH = "M 0 88 L 12 85 L 24 90 L 36 83 L 50 88 L 62 84 L 76 91 L 88 85 L 102 89 L 114 84 L 128 90 L 140 83 L 154 88 L 168 84 L 180 90 L 192 85 L 206 89 L 218 83 L 232 91 L 244 84 L 258 90 L 270 85 L 280 88";

const TOP_CLIP = "M 0 0 L 280 0 L 280 88 L 270 85 L 258 90 L 244 84 L 232 91 L 218 83 L 206 89 L 192 85 L 180 90 L 168 84 L 154 88 L 140 83 L 128 90 L 114 84 L 102 89 L 88 85 L 76 91 L 62 84 L 50 88 L 36 83 L 24 90 L 12 85 L 0 88 Z";

const BOTTOM_CLIP = "M 0 176 L 280 176 L 280 88 L 270 85 L 258 90 L 244 84 L 232 91 L 218 83 L 206 89 L 192 85 L 180 90 L 168 84 L 154 88 L 140 83 L 128 90 L 114 84 L 102 89 L 88 85 L 76 91 L 62 84 L 50 88 L 36 83 L 24 90 L 12 85 L 0 88 Z";

const SPARKLE_COLORS = ["#F5C230", "#fff", "#E8503A", "#F5C230"];

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

const easeInOutQuad = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export default function OnboardingWelcome({ onComplete, teamName }: Props) {
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [topY, setTopY] = useState(0);
  const [bottomY, setBottomY] = useState(0);
  const [topOpacity, setTopOpacity] = useState(1);
  const [bottomOpacity, setBottomOpacity] = useState(1);
  const [tearStroke, setTearStroke] = useState("rgba(255,255,255,0.08)");
  const [tearDash, setTearDash] = useState("4 4");
  const [tearOffset, setTearOffset] = useState("0");
  const [tearOpacity, setTearOpacity] = useState(1);
  const [headlineFaded, setHeadlineFaded] = useState(false);
  const [cardRevealed, setCardRevealed] = useState(false);
  const [accessShown, setAccessShown] = useState(false);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const sparklesRef = useRef<Sparkle[]>([]);
  const rafRef = useRef<number | null>(null);
  const startedRef = useRef(false);

  const spawnBurst = (count: number) => {
    const burst: Sparkle[] = [];
    for (let i = 0; i < count; i++) {
      const x = Math.random() * ENV_W;
      const y = 80 + (Math.random() - 0.5) * 20;
      burst.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5 - 2,
        life: 1,
        decay: 0.02 + Math.random() * 0.03,
        color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
        size: 2 + Math.random() * 4,
      });
    }
    sparklesRef.current = sparklesRef.current.concat(burst);
  };

  const startTear = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("running");

    const t0 = performance.now();
    let burst1 = false;
    let burst2 = false;

    const tick = (now: number) => {
      const elapsed = now - t0;

      if (elapsed < 150) {
        const p = elapsed / 150;
        setTopY(-4 * p);
        setBottomY(4 * p);
      } else if (elapsed < 500) {
        setTopY(-4);
        setBottomY(4);
        const p = (elapsed - 150) / 350;
        setTearStroke(`rgba(245,194,48,${0.4 * (1 - p)})`);
        setTearDash("600");
        setTearOffset(`${(1 - p) * 600}`);
        if (!burst1) {
          burst1 = true;
          spawnBurst(14);
        }
      } else if (elapsed < 1100) {
        const p = easeInOutQuad((elapsed - 500) / 600);
        setTopY(-4 + (-220 + 4) * p);
        setBottomY(4 + (220 - 4) * p);
        setTopOpacity(1 - p * 0.6);
        setBottomOpacity(1 - p * 0.6);
        setTearOpacity(1 - p);
        setHeadlineFaded(true);
        setCardRevealed(true);
        if (!burst2 && elapsed > 650) {
          burst2 = true;
          spawnBurst(10);
        }
      } else {
        setTopY(-220);
        setBottomY(220);
        setTopOpacity(0);
        setBottomOpacity(0);
        setTearOpacity(0);
        setPhase("done");
        setAccessShown(true);
      }

      const next: Sparkle[] = [];
      for (const s of sparklesRef.current) {
        const ns: Sparkle = {
          ...s,
          x: s.x + s.vx,
          y: s.y + s.vy,
          vy: s.vy + 0.15,
          life: s.life - s.decay,
        };
        if (ns.life > 0) next.push(ns);
      }
      sparklesRef.current = next;
      setSparkles(next);

      if (elapsed < 1100 || sparklesRef.current.length > 0) {
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

  const nameParts = teamName.split(" ");
  const line1 = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : teamName;
  const line2 = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

  return (
    <div
      style={{
        height: "100vh",
        background: "#1A1A1A",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: "#1A1A1A",
          borderBottom: "2.5px solid #2a2a2a",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cfc-logo.png"
          alt=""
          style={{ height: 28, filter: "brightness(0) invert(1)" }}
        />
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

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 24px 60px",
          position: "relative",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-headline, 'Syne', sans-serif)",
            fontWeight: 900,
            fontSize: 38,
            color: "#FFFFFF",
            textAlign: "center",
            lineHeight: 1.0,
            letterSpacing: -1.5,
            textTransform: "uppercase",
            margin: "0 0 10px",
            opacity: headlineFaded ? 0 : 1,
            transform: headlineFaded ? "translateY(-20px)" : "none",
            transition: "opacity 400ms, transform 400ms",
          }}
        >
          You&apos;re
          <br />
          Approved.
        </h1>

        <div
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 11,
            color: "#555",
            textTransform: "uppercase",
            letterSpacing: 2,
            marginBottom: 48,
            opacity: headlineFaded ? 0 : 1,
            transform: headlineFaded ? "translateY(-20px)" : "none",
            transition: "opacity 400ms, transform 400ms",
          }}
        >
          Tear to activate
        </div>

        <div style={{ position: "relative", width: ENV_W, height: ENV_H }}>
          <div
            style={{
              position: "absolute",
              top: -36,
              left: "50%",
              transform: "translateX(-50%)",
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 10,
              color: "#F5C230",
              textTransform: "uppercase",
              letterSpacing: 3,
              whiteSpace: "nowrap",
              opacity: accessShown ? 1 : 0,
              transition: "opacity 500ms ease 300ms",
            }}
          >
            Access Granted
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              width: ENV_W,
              height: ENV_H,
              background: "#111",
              border: "1.5px solid #333",
              overflow: "hidden",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              opacity: cardRevealed ? 1 : 0,
              transform: cardRevealed ? "scale(1)" : "scale(0.92)",
              transition: "opacity 500ms ease, transform 500ms ease",
              zIndex: 1,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 40%, transparent 60%, rgba(255,255,255,0.02) 100%)",
                pointerEvents: "none",
              }}
            />

            <div
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                fontWeight: 900,
                fontSize: 80,
                color: "rgba(255,255,255,0.03)",
                lineHeight: 1,
                pointerEvents: "none",
              }}
            >
              CFC
            </div>

            <div
              style={{
                padding: "18px 20px 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                position: "relative",
                zIndex: 1,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/cfc-logo.png"
                alt=""
                style={{
                  height: 20,
                  filter: "brightness(0) invert(1)",
                  opacity: 0.2,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 8,
                  color: "rgba(245,194,48,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: 2,
                }}
              >
                Front Office
              </span>
            </div>

            <div style={{ padding: "20px 20px 0", position: "relative", zIndex: 1 }}>
              <div
                style={{
                  fontFamily: "var(--font-headline, 'Syne', sans-serif)",
                  fontWeight: 900,
                  fontSize: 18,
                  color: "rgba(255,255,255,0.85)",
                  textTransform: "uppercase",
                  lineHeight: 1.1,
                  letterSpacing: 0.5,
                }}
              >
                {line1}
                {line2 && (
                  <>
                    <br />
                    {line2}
                  </>
                )}
              </div>
              <div
                style={{
                  width: "100%",
                  height: 2,
                  background: "#E8503A",
                  marginTop: 10,
                }}
              />
              <div
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 9,
                  color: "rgba(245,194,48,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  marginTop: 8,
                }}
              >
                Member since 2019
              </div>
            </div>

            {phase === "done" && (
              <button
                type="button"
                onClick={onComplete}
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: "0 20px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 1,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                    fontSize: 11,
                    color: "#F5C230",
                    textTransform: "uppercase",
                    letterSpacing: 2,
                    animation: "activate-pulse 2s ease-in-out infinite",
                  }}
                >
                  Tap to activate →
                </span>
              </button>
            )}

            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: 2,
                background:
                  "linear-gradient(90deg, transparent 0%, #F5C230 30%, #F5C230 70%, transparent 100%)",
                opacity: 0.4,
              }}
            />
          </div>

          <button
            type="button"
            onClick={startTear}
            disabled={phase !== "idle"}
            aria-label="Open envelope"
            style={{
              position: "absolute",
              inset: 0,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: phase === "idle" ? "pointer" : "default",
              zIndex: 2,
              pointerEvents: phase === "done" ? "none" : "auto",
            }}
          >
            <svg
              width={ENV_W}
              height={ENV_H}
              viewBox={`0 0 ${ENV_W} ${ENV_H}`}
              style={{ overflow: "visible", display: "block" }}
            >
              <defs>
                <clipPath id="env-top-clip">
                  <path d={TOP_CLIP} />
                </clipPath>
                <clipPath id="env-bottom-clip">
                  <path d={BOTTOM_CLIP} />
                </clipPath>
                <linearGradient id="env-sheen" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
                  <stop offset="50%" stopColor="rgba(255,255,255,0)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
                </linearGradient>
              </defs>

              <g
                clipPath="url(#env-top-clip)"
                transform={`translate(0, ${topY})`}
                opacity={topOpacity}
              >
                <rect width={ENV_W} height={ENV_H} fill="#111" />
                {[0, 40, 80, 120].map((x) => (
                  <line
                    key={x}
                    x1={x}
                    y1={0}
                    x2={x + ENV_W}
                    y2={ENV_W}
                    stroke="rgba(255,255,255,0.015)"
                    strokeWidth={1}
                  />
                ))}
                <rect width={ENV_W} height={ENV_H} fill="url(#env-sheen)" />
                <rect
                  x={122}
                  y={26}
                  width={36}
                  height={36}
                  fill="none"
                  stroke="#F5C230"
                  strokeWidth={1.5}
                />
                <text
                  x={140}
                  y={50}
                  fontFamily="Syne, sans-serif"
                  fontWeight={900}
                  fontSize={11}
                  fill="#F5C230"
                  textAnchor="middle"
                >
                  CFC
                </text>
                <text
                  x={140}
                  y={82}
                  fontFamily="Syne, sans-serif"
                  fontWeight={900}
                  fontSize={11}
                  fill="rgba(255,255,255,0.3)"
                  textAnchor="middle"
                  letterSpacing={2}
                >
                  CLEVELAND
                </text>
                <rect
                  width={ENV_W}
                  height={ENV_H}
                  fill="none"
                  stroke="#333"
                  strokeWidth={1.5}
                />
                <rect
                  x={60}
                  y={ENV_H - 2}
                  width={160}
                  height={2}
                  fill="#F5C230"
                  opacity={0.3}
                />
              </g>

              <g
                clipPath="url(#env-bottom-clip)"
                transform={`translate(0, ${bottomY})`}
                opacity={bottomOpacity}
              >
                <rect width={ENV_W} height={ENV_H} fill="#111" />
                {[0, 40, 80, 120].map((x) => (
                  <line
                    key={x}
                    x1={x}
                    y1={0}
                    x2={x + ENV_W}
                    y2={ENV_W}
                    stroke="rgba(255,255,255,0.015)"
                    strokeWidth={1}
                  />
                ))}
                <rect width={ENV_W} height={ENV_H} fill="url(#env-sheen)" />
                <text
                  x={140}
                  y={102}
                  fontFamily="Syne, sans-serif"
                  fontWeight={900}
                  fontSize={11}
                  fill="rgba(255,255,255,0.3)"
                  textAnchor="middle"
                  letterSpacing={2}
                >
                  FOOTBALL CLUB
                </text>
                <rect
                  width={ENV_W}
                  height={ENV_H}
                  fill="none"
                  stroke="#333"
                  strokeWidth={1.5}
                />
                <rect
                  x={60}
                  y={ENV_H - 2}
                  width={160}
                  height={2}
                  fill="#F5C230"
                  opacity={0.3}
                />
              </g>

              <path
                d={TEAR_PATH}
                fill="none"
                stroke={tearStroke}
                strokeWidth={1}
                strokeDasharray={tearDash}
                strokeDashoffset={tearOffset}
                opacity={tearOpacity}
              />

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

          {phase === "idle" && (
            <div
              style={{
                position: "absolute",
                bottom: -32,
                left: "50%",
                transform: "translateX(-50%)",
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: 10,
                color: "#555",
                textTransform: "uppercase",
                letterSpacing: 2,
                whiteSpace: "nowrap",
                animation: "activate-pulse 2s ease-in-out infinite",
              }}
            >
              Tap to open
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes activate-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
