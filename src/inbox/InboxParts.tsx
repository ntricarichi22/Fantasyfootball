"use client";

import { Icon } from "@/shared/ui/Icon";

const FH = "Syne, sans-serif";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FB = "var(--font-body, 'DM Sans', sans-serif)";

export type Filter = "inbox" | "sent" | "trash" | "archive";

export const FILTER_LABELS: { value: Filter; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "sent", label: "Sent" },
  { value: "trash", label: "Trash" },
  { value: "archive", label: "Archive" },
];

export type InboxItem = {
  kind: "trade" | "memo";
  id: string;
  sender: string;
  subject: string;
  preview: string;
  unread: boolean;
  timestamp: string;
  href: string;
  tradeFromUser?: boolean;
  tradeStatus?: string;
};

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
/*  Sidebar — Compose + filter chips. Used on desktop AND in mobile    */
/*  drawer.                                                              */
/* ------------------------------------------------------------------ */

export function Sidebar({
  active,
  onChange,
  isMobile,
  onClose,
  unreadCount,
}: {
  active: Filter;
  onChange: (f: Filter) => void;
  isMobile: boolean;
  onClose?: () => void;
  unreadCount?: number;
}) {
  return (
    <div
      style={{
        width: isMobile ? "78%" : 168,
        flexShrink: 0,
        padding: 14,
        borderRight: isMobile ? "none" : "3px solid #1A1A1A",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "#F5F0E6",
        height: isMobile ? "100%" : "auto",
      }}
    >
      {isMobile && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontFamily: FM,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.18em",
              color: "#8C7E6A",
              textTransform: "uppercase",
            }}
          >
            Inbox
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#1A1A1A",
              padding: 0,
              display: "flex",
            }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          window.location.href = "/pro-personnel/trade-builder";
        }}
        style={{
          background: "#3366CC",
          color: "#FEFCF9",
          border: "3px solid #1A1A1A",
          boxShadow: "3px 3px 0 #1A1A1A",
          padding: "10px 12px",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
          fontFamily: FB,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="plus" size={14} />
        New offer
      </button>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        {FILTER_LABELS.map((f) => {
          const isActive = active === f.value;
          const showUnreadDot = f.value === "inbox" && (unreadCount ?? 0) > 0;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                onChange(f.value);
                if (isMobile && onClose) onClose();
              }}
              style={{
                background: isActive ? "#1A1A1A" : "#FEFCF9",
                color: isActive ? "#FEFCF9" : "#1A1A1A",
                border: "2px solid #1A1A1A",
                padding: isMobile ? "10px 14px" : "8px 12px",
                fontSize: isMobile ? 11 : 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: FB,
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{f.label}</span>
              {showUnreadDot && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    background: "#E8503A",
                    borderRadius: "50%",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                  aria-label={`${unreadCount} unread`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
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
        padding: "11px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderBottom: "1px solid #C8C3B8",
        opacity,
        cursor: "pointer",
      }}
    >
      <Checkbox selected={selected} unread={isUnread} onToggle={onToggle} />
      <div
        style={{
          fontSize: 11,
          fontWeight: isUnread ? 700 : 500,
          color: isUnread ? "#1A1A1A" : "#8C7E6A",
          width: 150,
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

export function EmptyState({ filter }: { filter: Filter }) {
  const COPY: Record<Filter, { eyebrow: string; head: string; sub: string }> = {
    inbox: { eyebrow: "Inbox · 0 messages", head: "Your inbox is empty.", sub: "Nothing to see here yet." },
    sent: {
      eyebrow: "Sent · 0 offers",
      head: "You haven't sent any offers yet.",
      sub: "Make the first move.",
    },
    trash: { eyebrow: "Trash · 0 items", head: "Trash is empty.", sub: "Nothing to clean up." },
    archive: {
      eyebrow: "Archive · 0 closed",
      head: "No closed deals yet.",
      sub: "Anything you wrap up will land here.",
    },
  };
  const c = COPY[filter];
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "64px 24px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: FM,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.22em",
            color: "#8C7E6A",
            textTransform: "uppercase",
            marginBottom: 14,
          }}
        >
          {c.eyebrow}
        </div>
        <div
          style={{
            fontFamily: FH,
            fontWeight: 800,
            fontSize: 26,
            letterSpacing: "-0.01em",
            color: "#1A1A1A",
            lineHeight: 1.15,
            marginBottom: 8,
          }}
        >
          {c.head}
        </div>
        <div style={{ fontSize: 13, color: "#8C7E6A", lineHeight: 1.5, fontFamily: FB }}>
          {c.sub}
        </div>
      </div>
    </div>
  );
}