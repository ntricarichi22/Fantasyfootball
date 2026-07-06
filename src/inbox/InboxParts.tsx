"use client";

import { useRef, useState } from "react";
import { Icon } from "@/shared/ui/Icon";

const FH = "Syne, sans-serif";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "var(--font-body, 'DM Sans', sans-serif)";

// The front-office page has two independent sections: staff mail (true
// email — read-only dispatches from the directors) and the negotiation board
// (one tile per trade thread, state on its sleeve). No shared sidebar.

export type MailTab = "inbox" | "archive" | "trash";

export type BoardFilter = "all" | "active" | "closed";

// A staff-mail row (director memos only — trades live on the board).
export type InboxItem = {
  id: string;
  sender: string;
  subject: string;
  preview: string;
  unread: boolean;
  timestamp: string;
  href: string;
};

export type TileStatus = "our_court" | "on_them" | "accepted" | "declined" | "withdrawn";

// One revision of the deal — every offer in the thread is a version the card
// can flip to. Last entry is the paper currently (or finally) on the table.
export type TileVersion = {
  label: string;   // "V1.0"
  caption: string; // "THEIR OPENING" / "YOUR COUNTER"
  youGet: string;
  youGive: string;
};

export type NegotiationTileData = {
  threadId: string;
  counterpart: string;
  logoUrl: string | null;
  versions: TileVersion[];
  status: TileStatus;
  // Pulses the status dot until the thread is opened: an unread inbound
  // offer, or a verdict/withdrawal you haven't acknowledged.
  unseen: boolean;
  timestamp: string;
};

/* ------------------------------------------------------------------ */
/*  Sender avatars & trade status chips                                 */
/* ------------------------------------------------------------------ */

// Vintage plate colors for team monograms — deterministic per team name.
const AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: "#3366CC", fg: "#FEFCF9" },
  { bg: "#E8503A", fg: "#FEFCF9" },
  { bg: "#019942", fg: "#FEFCF9" },
  { bg: "#F5C230", fg: "#5F4A00" },
  { bg: "#7B5EA7", fg: "#FEFCF9" },
  { bg: "#C2542B", fg: "#FEFCF9" },
];

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function avatarColors(name: string, kind: "trade" | "memo"): { bg: string; fg: string } {
  // Directors write on the house letterhead — always the black plate.
  if (kind === "memo") return { bg: "#1A1A1A", fg: "#F5C230" };
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function AvatarPlate({
  name,
  kind,
  size = 30,
}: {
  name: string;
  kind: "trade" | "memo";
  size?: number;
}) {
  const { bg, fg } = avatarColors(name, kind);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        background: bg,
        color: fg,
        border: "2px solid #1A1A1A",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FM,
        fontSize: size * 0.34,
        fontWeight: 700,
        letterSpacing: "0.04em",
      }}
    >
      {monogram(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  NegotiationTile — the locked card: logo hero, version chips, deal   */
/*  block with revision caption, status/action footer. Near-monochrome; */
/*  the status dot is the only standing color and pulses while unseen.  */
/* ------------------------------------------------------------------ */

// Footer rides an ink band (accent variant D): cream labels, gold action on
// states that want attention, dimmed cream on the passive ones.
const TILE_FOOTER: Record<
  TileStatus,
  { label: string; action: string; dot: string; dotBorder: string; muted: boolean }
> = {
  our_court: { label: "IN OUR COURT", action: "RESPOND", dot: "#F5C230", dotBorder: "#FEFCF9", muted: false },
  on_them: { label: "ON THEM", action: "FOLLOW UP", dot: "#FEFCF9", dotBorder: "rgba(254,252,249,0.6)", muted: true },
  accepted: { label: "ACCEPTED", action: "SEE THE DEAL", dot: "#019942", dotBorder: "#FEFCF9", muted: false },
  declined: { label: "DECLINED", action: "REVIEW", dot: "#E8503A", dotBorder: "#FEFCF9", muted: false },
  withdrawn: { label: "WITHDRAWN", action: "REVIEW", dot: "#C8C3B8", dotBorder: "#FEFCF9", muted: true },
};

export function NegotiationTile({
  tile,
  onOpen,
}: {
  tile: NegotiationTileData;
  onOpen: () => void;
}) {
  const currentIdx = tile.versions.length - 1;
  const [selectedIdx, setSelectedIdx] = useState(currentIdx);
  const [logoFailed, setLogoFailed] = useState(false);
  // Refetches can append a version — never leave the selection out of range,
  // and snap to the new current when one arrives.
  const idx = Math.min(selectedIdx, currentIdx);
  const version = tile.versions[idx];
  const viewingCurrent = idx === currentIdx;

  const footer = TILE_FOOTER[tile.status];
  const isOurCourt = tile.status === "our_court";
  const isClosed = tile.status !== "our_court" && tile.status !== "on_them";
  const ago = timeAgo(tile.timestamp);

  if (!version) return null;

  const ledgerLabel: React.CSSProperties = {
    width: 34,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: FM,
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: "0.08em",
    borderRight: "1.5px solid #1A1A1A",
    background: "#F5F0E6",
    color: "#1A1A1A",
  };
  const ledgerValue: React.CSSProperties = {
    padding: "7px 9px",
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.3,
    fontFamily: FB,
    color: viewingCurrent ? "#1A1A1A" : "#5F5A50",
    minWidth: 0,
  };

  return (
    <div
      onClick={onOpen}
      style={{
        background: "#FEFCF9",
        border: isOurCourt ? "3px solid #1A1A1A" : "2px solid #1A1A1A",
        borderRadius: 12,
        boxShadow: isOurCourt ? "4px 4px 0 #1A1A1A" : "none",
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @keyframes cfc-tile-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>

      <div style={{ opacity: isClosed ? 0.62 : 1, flex: 1 }}>
        {/* Hero row — logo and name on an ink band over the gold hairline,
            the site's topbar signature in miniature */}
        <div style={{ padding: "9px 9px 0" }}>
          <div style={{ border: "2px solid #1A1A1A", borderRadius: 8, overflow: "hidden" }}>
            <div
              style={{
                background: "#1A1A1A",
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: 9,
              }}
            >
              {tile.logoUrl && !logoFailed ? (
                <img
                  src={tile.logoUrl}
                  alt=""
                  onError={() => setLogoFailed(true)}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "2px solid #FEFCF9",
                    flexShrink: 0,
                    background: "#FEFCF9",
                  }}
                />
              ) : (
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    background: avatarColors(tile.counterpart, "trade").bg,
                    color: avatarColors(tile.counterpart, "trade").fg,
                    border: "2px solid #FEFCF9",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "Impact, system-ui, sans-serif",
                    fontSize: 15,
                    flexShrink: 0,
                  }}
                >
                  {monogram(tile.counterpart)}
                </span>
              )}
              <span
                style={{
                  fontFamily: "Impact, system-ui, sans-serif",
                  fontSize: 15,
                  lineHeight: 1.05,
                  letterSpacing: "0.01em",
                  color: "#FEFCF9",
                  minWidth: 0,
                }}
              >
                {tile.counterpart.toUpperCase()}
              </span>
            </div>
            <div style={{ height: 3, background: "#F5C230" }} />
          </div>
        </div>

        <div
          style={{
            padding: "8px 11px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>
            {tile.versions.map((v, i) => {
              const active = i === idx;
              return (
                <button
                  key={v.label}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedIdx(i);
                  }}
                  style={{
                    fontFamily: FM,
                    fontSize: 8,
                    fontWeight: 700,
                    background: active ? "#1A1A1A" : "transparent",
                    border: `1.5px solid ${active ? "#1A1A1A" : "#C8C3B8"}`,
                    color: active ? "#FEFCF9" : "#8C7E6A",
                    borderRadius: 5,
                    padding: "2px 5px",
                    cursor: "pointer",
                  }}
                >
                  {v.label}
                </button>
              );
            })}
          </span>
          <span style={{ fontFamily: FM, fontSize: 8, fontWeight: 700, color: "#8C7E6A", flexShrink: 0 }}>
            {ago.toUpperCase()}
          </span>
        </div>

        <div
          style={{
            padding: "5px 11px 2px",
            fontFamily: FM,
            fontSize: 6.5,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "#8C7E6A",
          }}
        >
          {version.label} · {version.caption} · {viewingCurrent ? "CURRENT" : "SUPERSEDED"}
        </div>

        {/* The ledger — the deal is the loudest thing on the card */}
        <div
          style={{
            margin: "3px 11px 10px",
            border: "1.5px solid #1A1A1A",
            borderRadius: 8,
            overflow: "hidden",
            background: viewingCurrent
              ? "transparent"
              : "repeating-linear-gradient(-45deg, transparent, transparent 7px, rgba(200,195,184,0.18) 7px, rgba(200,195,184,0.18) 8px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <span style={ledgerLabel}>GET</span>
            <span style={ledgerValue}>{version.youGet}</span>
          </div>
          <div style={{ display: "flex", alignItems: "stretch", borderTop: "1.5px solid #1A1A1A" }}>
            <span style={ledgerLabel}>GIVE</span>
            <span style={ledgerValue}>{version.youGive}</span>
          </div>
        </div>
      </div>

      <div
        style={{
          background: "#1A1A1A",
          borderTop: "2px solid #1A1A1A",
          padding: "8px 11px",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: FM,
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: "0.08em",
            color: footer.muted ? "rgba(254,252,249,0.55)" : "#FEFCF9",
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              background: footer.dot,
              border: `1.5px solid ${footer.dotBorder}`,
              borderRadius: "50%",
              flexShrink: 0,
              animation: tile.unseen ? "cfc-tile-pulse 1.6s ease-in-out infinite" : undefined,
            }}
          />
          {footer.label}
        </span>
        <span
          style={{
            fontFamily: FM,
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: footer.muted ? "rgba(254,252,249,0.55)" : "#F5C230",
            whiteSpace: "nowrap",
          }}
        >
          {footer.action} →
        </span>
      </div>
    </div>
  );
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/* ------------------------------------------------------------------ */
/*  Desktop ActionBar — floating paper bar with offset shadow            */
/* ------------------------------------------------------------------ */

export function ActionBar({
  count,
  onMarkRead,
  onArchive,
  onDelete,
  onClear,
}: {
  count: number;
  onMarkRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const btn = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: "transparent",
    border: "1.5px solid #1A1A1A",
    color: "#1A1A1A",
    padding: "5px 10px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: FB,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    ...(extra ?? {}),
  });
  return (
    <div
      style={{
        background: "#FEFCF9",
        border: "3px solid #1A1A1A",
        boxShadow: "4px 4px 0 #1A1A1A",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 14,
        flexWrap: "wrap",
      }}
    >
      <Icon name="square-minus" size={18} />
      <span
        style={{
          fontFamily: FM,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#1A1A1A",
        }}
      >
        {count} selected
      </span>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={onMarkRead} style={btn()}>
        <Icon name="mail-opened" size={12} /> Mark read
      </button>
      <button type="button" onClick={onArchive} style={btn()}>
        <Icon name="archive" size={12} /> Archive
      </button>
      <button
        type="button"
        onClick={onDelete}
        style={btn({ background: "#E8503A", color: "#FEFCF9", border: "1.5px solid #1A1A1A" })}
      >
        <Icon name="trash" size={12} /> Delete
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#1A1A1A",
          padding: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Icon name="x" size={17} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile ActionBar — bottom-fixed thumb-friendly bar                  */
/* ------------------------------------------------------------------ */

export function MobileActionBar({
  count,
  onMarkRead,
  onArchive,
  onDelete,
  onClear,
}: {
  count: number;
  onMarkRead: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const iconBtn = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: "none",
    border: "1.5px solid #1A1A1A",
    padding: 6,
    cursor: "pointer",
    display: "flex",
    color: "#1A1A1A",
    ...(extra ?? {}),
  });
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#FEFCF9",
        borderTop: "3px solid #1A1A1A",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        zIndex: 70,
      }}
    >
      <span
        style={{
          fontFamily: FM,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {count} selected
      </span>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={onMarkRead} aria-label="Mark read" style={iconBtn()}>
        <Icon name="mail-opened" size={14} />
      </button>
      <button type="button" onClick={onArchive} aria-label="Archive" style={iconBtn()}>
        <Icon name="archive" size={14} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete"
        style={iconBtn({ background: "#E8503A", color: "#FEFCF9" })}
      >
        <Icon name="trash" size={14} />
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear"
        style={{
          background: "none",
          border: "none",
          padding: 6,
          cursor: "pointer",
          display: "flex",
          color: "#1A1A1A",
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  InboxRow — desktop & mobile layouts                                 */
/* ------------------------------------------------------------------ */

function Checkbox({
  selected,
  unread,
  onToggle,
}: {
  selected: boolean;
  unread: boolean;
  onToggle: () => void;
}) {
  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };
  if (selected) {
    return (
      <span
        onClick={handle}
        style={{ color: "#3366CC", display: "flex", cursor: "pointer", flexShrink: 0 }}
      >
        <Icon name="square-check" size={16} ariaLabel="Selected" />
      </span>
    );
  }
  if (unread) {
    return (
      <span
        onClick={handle}
        aria-label="Unread"
        style={{
          width: 14,
          height: 14,
          background: "#3366CC",
          flexShrink: 0,
          cursor: "pointer",
          display: "inline-block",
        }}
      />
    );
  }
  return (
    <span
      onClick={handle}
      aria-label="Select"
      style={{
        width: 14,
        height: 14,
        border: "1.5px solid #C8C3B8",
        flexShrink: 0,
        cursor: "pointer",
        display: "inline-block",
        boxSizing: "border-box",
      }}
    />
  );
}

export function InboxRow({
  item,
  selected,
  onToggle,
  onOpen,
  isMobile,
}: {
  item: InboxItem;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  isMobile: boolean;
}) {
  const isUnread = item.unread;
  const opacity = isUnread ? 1 : 0.6;

  if (isMobile) {
    return (
      <div
        onClick={onOpen}
        style={{
          background: "#FEFCF9",
          padding: "11px 12px",
          display: "flex",
          gap: 10,
          borderBottom: "1px solid #C8C3B8",
          opacity,
          cursor: "pointer",
        }}
      >
        <div style={{ marginTop: 4 }}>
          <Checkbox selected={selected} unread={isUnread} onToggle={onToggle} />
        </div>
        <div style={{ marginTop: 1 }}>
          <AvatarPlate name={item.sender} kind="memo" size={28} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 3,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: isUnread ? 700 : 500,
                color: isUnread ? "#1A1A1A" : "#8C7E6A",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontFamily: FB,
              }}
            >
              {item.sender}
            </span>
            <span
              style={{
                fontFamily: FM,
                fontSize: 9,
                fontWeight: isUnread ? 700 : 500,
                color: isUnread ? "#1A1A1A" : "#8C7E6A",
                flexShrink: 0,
              }}
            >
              {timeAgo(item.timestamp)}
            </span>
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: isUnread ? 800 : 700,
              color: "#1A1A1A",
              lineHeight: 1.2,
              marginBottom: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: FB,
            }}
          >
            {item.subject}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#8C7E6A",
              lineHeight: 1.35,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: FB,
            }}
          >
            {item.preview}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onOpen}
      style={{
        background: "#FEFCF9",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid #C8C3B8",
        opacity,
        cursor: "pointer",
      }}
    >
      <Checkbox selected={selected} unread={isUnread} onToggle={onToggle} />
      <AvatarPlate name={item.sender} kind="memo" />
      <div
        style={{
          fontSize: 11,
          fontWeight: isUnread ? 700 : 500,
          color: isUnread ? "#1A1A1A" : "#8C7E6A",
          width: 140,
          flexShrink: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFamily: FB,
        }}
      >
        {item.sender}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: isUnread ? 800 : 700,
            color: "#1A1A1A",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: FB,
            lineHeight: 1.2,
          }}
        >
          {item.subject}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#8C7E6A",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: FB,
            lineHeight: 1.35,
          }}
        >
          {item.preview}
        </div>
      </div>
      <div
        style={{
          fontFamily: FM,
          fontSize: 10,
          fontWeight: isUnread ? 700 : 500,
          color: isUnread ? "#1A1A1A" : "#8C7E6A",
          flexShrink: 0,
          width: 34,
          textAlign: "right",
        }}
      >
        {timeAgo(item.timestamp)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EmptyState                                                          */
/* ------------------------------------------------------------------ */

export type EmptyStateKind = MailTab | BoardFilter;

export function EmptyState({ kind, compact }: { kind: EmptyStateKind; compact?: boolean }) {
  const COPY: Record<EmptyStateKind, { head: string; sub: string }> = {
    inbox: { head: "No dispatches.", sub: "Nothing from your directors yet." },
    archive: { head: "Archive is empty.", sub: "Filed dispatches land here." },
    trash: { head: "Trash is empty.", sub: "Nothing to clean up." },
    all: { head: "No negotiations yet.", sub: "Make the first move — send an offer." },
    active: { head: "Nothing in motion.", sub: "No live negotiations right now." },
    closed: { head: "No closed deals yet.", sub: "Verdicts land here once they're in." },
  };
  const c = COPY[kind];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: compact ? "26px 20px" : "48px 24px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: FH,
            fontWeight: 800,
            fontSize: compact ? 17 : 22,
            letterSpacing: "-0.01em",
            color: "#1A1A1A",
            lineHeight: 1.15,
            marginBottom: 6,
          }}
        >
          {c.head}
        </div>
        <div style={{ fontSize: 12.5, color: "#8C7E6A", lineHeight: 1.5, fontFamily: FB }}>
          {c.sub}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  InsiderPanel — desktop-only persistent feed                          */
/* ------------------------------------------------------------------ */

export type InsiderItem = {
  type?: string;
  headline: string;
  timestamp: string;
};

export function InsiderPanel({ items }: { items: InsiderItem[] }) {
  return (
    <div
      style={{
        flex: "0 0 18%",
        background: "#1A1A1A",
        color: "#FEFCF9",
        display: "flex",
        flexDirection: "column",
        alignSelf: "stretch",
      }}
    >
      <style>{`
        @keyframes cfc-insider-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>

      <div
        style={{
          padding: "11px 12px",
          borderBottom: "1.5px solid rgba(254,252,249,0.12)",
          display: "flex",
          alignItems: "center",
          gap: 7,
          position: "sticky",
          top: 0,
          background: "#1A1A1A",
          zIndex: 1,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            background: "#F5C230",
            borderRadius: "50%",
            display: "inline-block",
            animation: "cfc-insider-pulse 1.6s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "Syne, sans-serif",
            fontWeight: 800,
            letterSpacing: "0.04em",
            color: "#F5C230",
            fontSize: 10,
            textTransform: "uppercase",
          }}
        >
          Around the league
        </span>
      </div>

      <div style={{ flex: 1, padding: "2px 12px", overflowY: "auto" }}>
        {items.length === 0 ? (
          <div
            style={{
              padding: "24px 0",
              fontSize: 11,
              color: "#8C7E6A",
              textAlign: "center",
              fontFamily: FB,
              fontStyle: "italic",
            }}
          >
            The league is quiet.
          </div>
        ) : (
          items.map((item, i) => (
            <div
              key={`${item.timestamp}-${i}`}
              style={{
                padding: "9px 0",
                borderBottom:
                  i < items.length - 1 ? "1px solid rgba(254,252,249,0.10)" : "none",
              }}
            >
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  color: "#8C7E6A",
                  textTransform: "uppercase",
                  marginBottom: 3,
                }}
              >
                {timeAgo(item.timestamp).toUpperCase()} AGO
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  lineHeight: 1.4,
                  color: "#FEFCF9",
                  fontFamily: FB,
                }}
              >
                {item.headline.replace(/\*\*/g, "")}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MobileInsiderBar — bottom-anchored bar that expands into a drawer   */
/* ------------------------------------------------------------------ */

export function MobileInsiderBar({ items }: { items: InsiderItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 60) {
      setExpanded(false);
      touchStartY.current = null;
    }
  };
  const handleTouchEnd = () => {
    touchStartY.current = null;
  };

  const teaser =
    items.length > 0
      ? items[0].headline.replace(/\*\*/g, "")
      : "The league is quiet.";

  return (
    <>
      <style>{`
        @keyframes cfc-mob-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>

      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Open league activity"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#1A1A1A",
            color: "#FEFCF9",
            border: "none",
            borderTop: "3px solid #1A1A1A",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            zIndex: 60,
            cursor: "pointer",
            textAlign: "left",
            fontFamily: FB,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              background: "#F5C230",
              borderRadius: "50%",
              flexShrink: 0,
              animation: "cfc-mob-pulse 1.6s ease-in-out infinite",
              display: "inline-block",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "Syne, sans-serif",
                fontWeight: 800,
                fontSize: 9,
                letterSpacing: "0.06em",
                color: "#F5C230",
                textTransform: "uppercase",
                marginBottom: 1,
              }}
            >
              Around the league
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#FEFCF9",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {teaser}
            </div>
          </div>
          <span style={{ color: "#FEFCF9", flexShrink: 0, fontSize: 14, lineHeight: 1 }}>↑</span>
        </button>
      )}

      {expanded && (
        <>
          <div
            onClick={() => setExpanded(false)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(26,26,26,0.55)",
              zIndex: 70,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: 110,
              left: 0,
              right: 0,
              bottom: 0,
              background: "#1A1A1A",
              color: "#FEFCF9",
              borderTop: "3px solid #1A1A1A",
              display: "flex",
              flexDirection: "column",
              zIndex: 80,
              fontFamily: FB,
            }}
          >
            <div
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                padding: "12px 14px 13px",
                borderBottom: "1.5px solid rgba(254,252,249,0.12)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
                cursor: "grab",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  background: "#F5C230",
                  borderRadius: "50%",
                  animation: "cfc-mob-pulse 1.6s ease-in-out infinite",
                  display: "inline-block",
                }}
              />
              <span
                style={{
                  fontFamily: "Syne, sans-serif",
                  fontWeight: 800,
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  color: "#F5C230",
                  textTransform: "uppercase",
                  flex: 1,
                }}
              >
                Around the league
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Close"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#FEFCF9",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <div style={{ flex: 1, padding: "4px 14px", overflowY: "auto" }}>
              {items.length === 0 ? (
                <div
                  style={{
                    padding: "32px 0",
                    fontSize: 12,
                    color: "#8C7E6A",
                    textAlign: "center",
                    fontStyle: "italic",
                  }}
                >
                  The league is quiet.
                </div>
              ) : (
                items.map((item, i) => (
                  <div
                    key={`${item.timestamp}-${i}`}
                    style={{
                      padding: "10px 0",
                      borderBottom:
                        i < items.length - 1
                          ? "1px solid rgba(254,252,249,0.10)"
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: FM,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        color: "#8C7E6A",
                        textTransform: "uppercase",
                        marginBottom: 3,
                      }}
                    >
                      {timeAgo(item.timestamp).toUpperCase()} AGO
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        lineHeight: 1.4,
                        color: "#FEFCF9",
                      }}
                    >
                      {item.headline.replace(/\*\*/g, "")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}