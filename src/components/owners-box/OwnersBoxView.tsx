"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import StrategyTab from "./StrategyTab";
import DepthChartTab from "./DepthChartTab";
import TradeChartTab from "./TradeChartTab";

const TABS = [
  { key: "strategy", label: "Strategy" },
  { key: "depth-chart", label: "Depth Chart" },
  { key: "trade-chart", label: "Trade Chart" },
] as const;

function OwnersBoxViewInner() {
  const { teamName = "", rosterId = "" } = readStoredTeam();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "strategy";

  const displayName = teamName || `Team ${rosterId}`;

  return (
    <main
      style={{
        height: "calc(100vh - 44px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--cfc-canvas)",
        color: "var(--cfc-ink)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          width: "100%",
          margin: "0 auto",
          padding: "0 40px",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: "20px 0 14px",
            flexShrink: 0,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                color: "#8C7E6A",
                textTransform: "uppercase",
                letterSpacing: 3,
                marginBottom: 6,
              }}
            >
              Owner&apos;s Box · {displayName}
            </div>
            <div
              style={{
                fontFamily: "'Syne', sans-serif",
                fontWeight: 900,
                fontSize: 32,
                color: "#1A1A1A",
                lineHeight: 1,
                letterSpacing: -1,
                textTransform: "uppercase",
              }}
            >
              Front Office Profile
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            borderBottom: "2.5px solid #1A1A1A",
            marginBottom: 14,
            flexShrink: 0,
          }}
        >
          {TABS.map((t) => {
            const isActive = tab === t.key;
            return (
              <a
                key={t.key}
                href={`?tab=${t.key}`}
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontWeight: 700,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  padding: "10px 20px",
                  borderBottom: isActive ? "3px solid #1A1A1A" : "3px solid transparent",
                  marginBottom: -2.5,
                  color: isActive ? "#1A1A1A" : "#8C7E6A",
                  textDecoration: "none",
                }}
              >
                {t.label}
              </a>
            );
          })}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", paddingBottom: 24 }}>
          {tab === "depth-chart" ? (
            <DepthChartTab />
          ) : tab === "trade-chart" ? (
            <TradeChartTab />
          ) : (
            <StrategyTab />
          )}
        </div>
      </div>
    </main>
  );
}

export default function OwnersBoxView() {
  return (
    <Suspense>
      <OwnersBoxViewInner />
    </Suspense>
  );
}
