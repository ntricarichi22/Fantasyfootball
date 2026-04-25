"use client";

import type { CSSProperties } from "react";
import type { DraftPick } from "../../lib/picks";

export type DrawerPlayer = {
  id: string;
  name: string;
  position: string;
  team: string;
  ageLabel: string;
  value: number;
};

type Props = {
  isOpen: boolean;
  variant: "light" | "dark";
  headerTitle: string;
  starters: DrawerPlayer[];
  bench: DrawerPlayer[];
  picks: DraftPick[];
  selectedKeys: Set<string>;
  onToggleAsset: (name: string, value: number, key: string) => void;
  draftPickText: (pick: DraftPick) => string;
  computePickValue: (pick: DraftPick) => number;
  pickKey: (pick: DraftPick) => string;
  disabledPickKeys?: Set<string>;
};

const DRAWER_WIDTH = 260;

export { DRAWER_WIDTH };

export default function TradeDrawerPanel({
  isOpen,
  variant,
  headerTitle,
  starters,
  bench,
  picks,
  selectedKeys,
  onToggleAsset,
  draftPickText,
  computePickValue,
  pickKey,
  disabledPickKeys,
}: Props) {
  const isLight = variant === "light";

  const wrapperStyle: CSSProperties = {
    overflow: "hidden",
    transition: "width 200ms ease",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    width: isOpen ? DRAWER_WIDTH : 0,
    background: isLight ? "#FEFCF9" : "#1A1A1A",
    ...(isLight
      ? { borderRight: isOpen ? "1.5px solid #C8C3B8" : "none" }
      : { borderLeft: isOpen ? "1.5px solid #333" : "none" }),
  };

  const headerStyle: CSSProperties = {
    padding: "8px 12px",
    borderBottom: isLight ? "1.5px solid #C8C3B8" : "1.5px solid #333",
    flexShrink: 0,
    background: isLight ? "#F5F0E6" : "#111",
  };

  const headerTitleStyle: CSSProperties = {
    fontFamily: "var(--font-headline, 'Syne', sans-serif)",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: isLight ? "#1A1A1A" : "rgba(255,255,255,0.5)",
  };

  const sectionLabelStyle: CSSProperties = {
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    fontSize: 8,
    fontWeight: 700,
    color: isLight ? "#C8C3B8" : "rgba(255,255,255,0.15)",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    padding: "6px 4px 3px",
  };

  const renderPlayerRow = (player: DrawerPlayer) => {
    const key = `player:${player.id}`;
    const isSelected = selectedKeys.has(key);

    const rowStyle: CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 6px",
      borderBottom: isLight ? "1px solid rgba(200,195,184,0.25)" : "1px solid rgba(255,255,255,0.05)",
      cursor: "pointer",
    };

    return (
      <div
        key={player.id}
        style={rowStyle}
        onClick={() => onToggleAsset(player.name, player.value, key)}
      >
        <span
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontWeight: 700,
            fontSize: 12,
            color: isLight ? "#1A1A1A" : "#fff",
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {player.name}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 9,
            color: isLight ? "#8C7E6A" : "rgba(255,255,255,0.25)",
            whiteSpace: "nowrap",
          }}
        >
          {player.position} · {player.team}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            fontWeight: 700,
            color: isLight ? "#1A1A1A" : "rgba(255,255,255,0.4)",
            whiteSpace: "nowrap",
          }}
        >
          {player.value.toLocaleString()}
        </span>
        <span
          style={{
            width: 20,
            height: 20,
            border: isLight
              ? `2px solid ${isSelected ? "#E8503A" : "#1A1A1A"}`
              : `2px solid ${isSelected ? "#E8503A" : "#444"}`,
            background: isSelected ? "#E8503A" : isLight ? "#FEFCF9" : "#222",
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 11,
            fontWeight: 800,
            color: isSelected ? "#fff" : isLight ? "#1A1A1A" : "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {isSelected ? "✓" : "+"}
        </span>
      </div>
    );
  };

  const renderPickRow = (pick: DraftPick) => {
    const key = pickKey(pick);
    const isSelected = selectedKeys.has(key);
    const isDisabled = disabledPickKeys?.has(key);
    const label = draftPickText(pick);
    const value = computePickValue(pick);

    if (isDisabled) {
      return (
        <div
          key={key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 6px",
            borderBottom: isLight ? "1px solid rgba(200,195,184,0.25)" : "1px solid rgba(255,255,255,0.05)",
            opacity: 0.3,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              fontWeight: 700,
              fontSize: 12,
              color: "#E8503A",
              flex: 1,
            }}
          >
            {label} ← In trade
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 10,
              fontWeight: 700,
              color: isLight ? "#8C7E6A" : "rgba(255,255,255,0.4)",
            }}
          >
            {value.toLocaleString()}
          </span>
          <span
            style={{
              width: 20,
              height: 20,
              border: "2px solid #E8503A",
              background: "#E8503A",
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 11,
              fontWeight: 800,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            ✓
          </span>
        </div>
      );
    }

    return (
      <div
        key={key}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 6px",
          borderBottom: isLight ? "1px solid rgba(200,195,184,0.25)" : "1px solid rgba(255,255,255,0.05)",
          cursor: "pointer",
        }}
        onClick={() => onToggleAsset(label, value, key)}
      >
        <span
          style={{
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
            fontWeight: 700,
            fontSize: 12,
            color: isLight ? "#1A1A1A" : "#fff",
            flex: 1,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 9,
            color: isLight ? "#8C7E6A" : "rgba(255,255,255,0.25)",
          }}
        >
          Pick
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            fontWeight: 700,
            color: isLight ? "#1A1A1A" : "rgba(255,255,255,0.4)",
          }}
        >
          {value.toLocaleString()}
        </span>
        <span
          style={{
            width: 20,
            height: 20,
            border: isLight
              ? `2px solid ${isSelected ? "#E8503A" : "#1A1A1A"}`
              : `2px solid ${isSelected ? "#E8503A" : "#444"}`,
            background: isSelected ? "#E8503A" : isLight ? "#FEFCF9" : "#222",
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 11,
            fontWeight: 800,
            color: isSelected ? "#fff" : isLight ? "#1A1A1A" : "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {isSelected ? "✓" : "+"}
        </span>
      </div>
    );
  };

  return (
    <div style={wrapperStyle} aria-hidden={!isOpen}>
      <div style={headerStyle}>
        <span style={headerTitleStyle}>{headerTitle}</span>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 8px",
          minHeight: 0,
        }}
      >
        {starters.length > 0 && (
          <>
            <div style={sectionLabelStyle}>Starters</div>
            {starters.map(renderPlayerRow)}
          </>
        )}
        {bench.length > 0 && (
          <>
            <div style={sectionLabelStyle}>Bench</div>
            {bench.map(renderPlayerRow)}
          </>
        )}
        {picks.length > 0 && (
          <>
            <div style={sectionLabelStyle}>Draft Picks</div>
            {picks.map(renderPickRow)}
          </>
        )}
        {!starters.length && !bench.length && !picks.length && (
          <div
            style={{
              fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
              fontSize: 12,
              color: isLight ? "#C8C3B8" : "#444",
              textAlign: "center",
              padding: "24px 8px",
            }}
          >
            No players loaded.
          </div>
        )}
      </div>
    </div>
  );
}
