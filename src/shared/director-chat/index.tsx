"use client";

import { useState, useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

const F  = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

const COLORS = {
  ink: "#1A1A1A",
  paper: "#FEFCF9",
  cream: "#F5F0E6",
  muted: "#8C7E6A",
  mutedDark: "#5C5C58",
  blue: "#3366CC",
  red: "#E8503A",
  yellow: "#F5C230",
  green: "#019942",
};

export type DirectorRole = "scouting" | "personnel" | "strategy";

export type POV = {
  id: string;
  number: number;
  text: string;
  anchor?: string;
};

export type InlineActionType =
  | "multi_option"
  | "deep_link"
  | "commit"
  | "proposed_trade";

export type ActionItem = {
  id: string;
  label: string;
  kind: "navigate" | "commit" | "respond" | "noop";
  href?: string;
  commit?: {
    endpoint: string;
    body?: Record<string, unknown>;
    successText: string;
  };
  respondAs?: string;
  // ── Play-sheet rendering (optional) ──────────────────────────────────
  // number + sublabel turn the row into a numbered play: blue number block,
  // headline at prose weight, the "why" underneath, and a board count on the
  // right (a number, or "pending" while the slate is still generating).
  number?: number;
  sublabel?: string;
  board?: number | "pending";
  // divider renders the item as the GM's OWN move: an "OR" rule, then a
  // centered reply button (with an optional Tabler icon) — visually distinct
  // from the director's recommendations above it.
  divider?: boolean;
  icon?: string;
};

export type Message =
  | {
      kind: "director_opening";
      directorRole: DirectorRole;
      directorLabel: string;
      welcome: string;
      pitch?: string;
      transition?: string;
      povs: POV[];
      closing: string;
      // Optional GM's-own-move row (OR divider + centered reply button),
      // rendered after the closing line.
      reply?: ActionItem;
    }
  | {
      kind: "director_response";
      directorRole: DirectorRole;
      directorLabel: string;
      prose: string[];
      action?: {
        type: InlineActionType;
        items: ActionItem[];
        label?: string; // eyebrow above the group; defaults to "Your call:"
      };
      committedActionIds?: string[];
    }
  | {
      kind: "user";
      text: string;
      avatarInitials: string;
    };

export function DirectorBubble({
  directorLabel,
  children,
}: {
  directorLabel: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        fontFamily: FM,
        fontSize: 11,
        letterSpacing: "0.2em",
        color: COLORS.mutedDark,
        fontWeight: 700,
        marginBottom: 8,
        textTransform: "uppercase",
      }}>
        {directorLabel}
      </div>
      <div style={{
        background: COLORS.paper,
        border: `3px solid ${COLORS.ink}`,
        boxShadow: `4px 4px 0 ${COLORS.ink}`,
        padding: "18px 20px",
      }}>
        {children}
      </div>
    </div>
  );
}

export function UserBubble({
  text,
  avatarInitials,
}: {
  text: string;
  avatarInitials: string;
}) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 22,
      marginTop: 4,
    }}>
      <div style={{
        background: COLORS.ink,
        color: COLORS.paper,
        border: `3px solid ${COLORS.ink}`,
        padding: "11px 16px",
        fontFamily: F,
        fontSize: 14.5,
        lineHeight: 1.5,
        fontWeight: 500,
        maxWidth: "70%",
      }}>
        {text}
      </div>
      <div style={{
        background: COLORS.ink,
        color: COLORS.paper,
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FM,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        flexShrink: 0,
      }}>
        {avatarInitials}
      </div>
    </div>
  );
}

export function POVBox({
  pov,
  onClick,
}: {
  pov: POV;
  onClick: (pov: POV) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(pov)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(pov);
        }
      }}
      style={{
        border: `3px solid ${COLORS.ink}`,
        background: COLORS.cream,
        padding: "11px 14px",
        marginBottom: 10,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        cursor: "pointer",
      }}
    >
      <div style={{
        fontFamily: FH,
        fontWeight: 900,
        fontSize: 18,
        color: COLORS.ink,
        lineHeight: 1,
        minWidth: 14,
      }}>
        {pov.number}
      </div>
      <div style={{
        fontFamily: F,
        fontSize: 13.5,
        lineHeight: 1.5,
        color: COLORS.ink,
      }}>
        {pov.text}
      </div>
    </div>
  );
}

export function CommitConfirmation({ successText }: { successText: string }) {
  return (
    <div style={{
      border: `3px solid ${COLORS.ink}`,
      background: COLORS.paper,
      padding: "12px 14px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      fontFamily: F,
      fontSize: 14,
      lineHeight: 1.5,
      color: COLORS.ink,
      cursor: "default",
    }}>
      <span style={{
        width: 22,
        height: 22,
        background: COLORS.green,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={COLORS.paper} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span style={{ flex: 1 }}>{successText}</span>
      <span style={{
        fontFamily: FM,
        fontSize: 10,
        letterSpacing: "0.18em",
        fontWeight: 700,
        color: COLORS.green,
      }}>
        DONE
      </span>
    </div>
  );
}

// A numbered play on the director's board: blue number block, headline at
// conversation weight, the reasoning underneath, board count on the right
// (verdict-underline treatment; "ON THE PHONES…" while the slate generates).
export function PlayRow({
  item,
  onTap,
}: {
  item: ActionItem;
  onTap: (item: ActionItem) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onTap(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap(item);
        }
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "translate(-2px, -2px)";
        el.style.boxShadow = `5px 5px 0 ${COLORS.ink}`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "none";
        el.style.boxShadow = `3px 3px 0 ${COLORS.ink}`;
      }}
      style={{
        border: `3px solid ${COLORS.ink}`,
        background: COLORS.paper,
        boxShadow: `3px 3px 0 ${COLORS.ink}`,
        display: "flex",
        alignItems: "stretch",
        cursor: "pointer",
        transition: "transform .12s, box-shadow .12s",
      }}
    >
      <div style={{
        flexShrink: 0,
        width: 46,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#185FA5",
        color: COLORS.paper,
        fontFamily: FH,
        fontWeight: 900,
        fontSize: 19,
      }}>
        {item.number}
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: "11px 14px" }}>
        <div style={{ fontFamily: F, fontWeight: 700, fontSize: 14, color: COLORS.ink }}>{item.label}</div>
        {item.sublabel && (
          <div style={{ fontFamily: F, fontSize: 13, color: COLORS.mutedDark, marginTop: 2, lineHeight: 1.5 }}>
            {item.sublabel}
          </div>
        )}
      </div>
      {item.board !== undefined && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", padding: "0 16px" }}>
          {item.board === "pending" ? (
            <span style={{ fontFamily: FM, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: COLORS.muted }}>
              ON THE PHONES…
            </span>
          ) : (
            <span style={{
              fontFamily: FM,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: COLORS.ink,
              textDecoration: "underline",
              textDecorationColor: "#185FA5",
              textDecorationThickness: 4,
              textUnderlineOffset: 5,
              whiteSpace: "nowrap",
            }}>
              {item.board} ON THE BOARD
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// The GM's OWN move — an "OR" rule, then a centered reply button. Spaced and
// shaped so it reads as you answering the director, not another recommendation.
export function DividerReply({
  item,
  onTap,
}: {
  item: ActionItem;
  onTap: (item: ActionItem) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 14px" }}>
        <div style={{ flex: 1, borderTop: "2px solid #C8C3B8" }} />
        <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: "0.18em", color: COLORS.muted, fontWeight: 700 }}>OR</div>
        <div style={{ flex: 1, borderTop: "2px solid #C8C3B8" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onTap(item)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onTap(item);
            }
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            el.style.transform = "translate(-2px, -2px)";
            el.style.boxShadow = `5px 5px 0 ${COLORS.ink}`;
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLDivElement;
            el.style.transform = "none";
            el.style.boxShadow = `3px 3px 0 ${COLORS.ink}`;
          }}
          style={{
            border: `2.5px solid ${COLORS.ink}`,
            background: COLORS.paper,
            boxShadow: `3px 3px 0 ${COLORS.ink}`,
            padding: "10px 18px",
            fontFamily: F,
            fontSize: 14,
            fontWeight: 500,
            color: COLORS.ink,
            display: "flex",
            alignItems: "center",
            gap: 9,
            cursor: "pointer",
            transition: "transform .12s, box-shadow .12s",
          }}
        >
          {item.icon && <i className={`ti ${item.icon}`} style={{ fontSize: 16, color: COLORS.ink }} aria-hidden="true" />}
          {item.label}
        </div>
      </div>
    </div>
  );
}

export function ActionBox({
  item,
  onTap,
  confirmed,
}: {
  item: ActionItem;
  onTap: (item: ActionItem) => void;
  confirmed?: boolean;
}) {
  if (confirmed && item.commit) {
    return <CommitConfirmation successText={item.commit.successText} />;
  }

  if (item.divider) {
    return <DividerReply item={item} onTap={onTap} />;
  }

  if (item.number !== undefined) {
    return <PlayRow item={item} onTap={onTap} />;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onTap(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap(item);
        }
      }}
      style={{
        border: `3px solid ${COLORS.ink}`,
        background: COLORS.cream,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        cursor: "pointer",
        fontFamily: F,
        fontSize: 14,
        lineHeight: 1.5,
        color: COLORS.ink,
      }}
    >
      <span>{item.label}</span>
      <span style={{
        fontFamily: FH,
        fontWeight: 900,
        fontSize: 20,
        color: COLORS.ink,
        flexShrink: 0,
        lineHeight: 1,
      }}>
        ›
      </span>
    </div>
  );
}

export function ActionGroup({
  items,
  committedIds,
  onTap,
  label = "Your call:",
}: {
  items: ActionItem[];
  committedIds?: string[];
  onTap: (item: ActionItem) => void;
  label?: string;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        fontFamily: FM,
        fontSize: 11,
        letterSpacing: "0.2em",
        color: COLORS.ink,
        fontWeight: 700,
        marginBottom: 10,
        textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => (
          <ActionBox
            key={item.id}
            item={item}
            onTap={onTap}
            confirmed={committedIds?.includes(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

const paraStyle: CSSProperties = {
  fontFamily: F,
  fontSize: 14.5,
  lineHeight: 1.6,
  color: COLORS.ink,
  marginBottom: 13,
  margin: "0 0 13px 0",
};

const closingStyle: CSSProperties = {
  fontStyle: "italic",
  color: COLORS.muted,
  fontSize: 13.5,
  marginTop: 4,
};

export function DirectorOpening({
  message,
  onPOVClick,
  onReplyTap,
}: {
  message: Extract<Message, { kind: "director_opening" }>;
  onPOVClick: (pov: POV) => void;
  onReplyTap?: (item: ActionItem) => void;
}) {
  const hasPOVs = message.povs.length > 0;
  const hasClosing = message.closing.trim().length > 0;

  return (
    <DirectorBubble directorLabel={message.directorLabel}>
      <p style={paraStyle}>{message.welcome}</p>

      {message.pitch && <p style={paraStyle}>{message.pitch}</p>}

      {hasPOVs && message.transition && (
        <p style={paraStyle}>{message.transition}</p>
      )}

      {hasPOVs && (
        <div style={{ marginTop: 4 }}>
          {message.povs.map((pov) => (
            <POVBox key={pov.id} pov={pov} onClick={onPOVClick} />
          ))}
        </div>
      )}

      {hasClosing && (
        <p style={{ ...paraStyle, ...closingStyle, marginBottom: 0 }}>
          {message.closing}
        </p>
      )}

      {message.reply && onReplyTap && (
        <DividerReply item={message.reply} onTap={onReplyTap} />
      )}
    </DirectorBubble>
  );
}

function DirectorResponse({
  message,
  onActionTap,
}: {
  message: Extract<Message, { kind: "director_response" }>;
  onActionTap: (item: ActionItem) => void;
}) {
  return (
    <DirectorBubble directorLabel={message.directorLabel}>
      {message.prose.map((para, i) => (
        <p
          key={i}
          style={{
            ...paraStyle,
            marginBottom: i === message.prose.length - 1 && !message.action ? 0 : 13,
          }}
        >
          {para}
        </p>
      ))}
      {message.action && (
        <ActionGroup
          items={message.action.items}
          committedIds={message.committedActionIds}
          onTap={onActionTap}
          label={message.action.label}
        />
      )}
    </DirectorBubble>
  );
}

// Threads are serializable (plain message objects), so a chat can survive
// navigation: pass persistKey and the thread round-trips through
// sessionStorage — leave for the trade machine, hit Back, and you're standing
// exactly where you left the conversation instead of starting the room over.
const PERSIST_TTL_MS = 30 * 60_000;

function readPersistedThread(key: string): Message[] | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; thread: Message[] };
    if (!Array.isArray(parsed.thread) || parsed.thread.length === 0) return null;
    if (Date.now() - (parsed.ts ?? 0) > PERSIST_TTL_MS) return null;
    return parsed.thread;
  } catch {
    return null;
  }
}

export function DirectorChat({
  opening,
  directorLabel,
  directorRole,
  userAvatarInitials,
  onUserMessage,
  onCommit,
  placeholder = "Ask the director…",
  persistKey,
}: {
  opening: Extract<Message, { kind: "director_opening" }>;
  directorLabel: string;
  directorRole: DirectorRole;
  userAvatarInitials: string;
  onUserMessage: (text: string) => Promise<Extract<Message, { kind: "director_response" }> | null>;
  onCommit: (item: ActionItem) => Promise<boolean>;
  placeholder?: string;
  persistKey?: string;
}) {
  const [thread, setThread] = useState<Message[]>(() =>
    (persistKey ? readPersistedThread(persistKey) : null) ?? [opening],
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!persistKey) return;
    try {
      sessionStorage.setItem(persistKey, JSON.stringify({ ts: Date.now(), thread }));
    } catch { /* quota — fine, the thread just won't survive navigation */ }
  }, [persistKey, thread]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, sending]);

  const handlePOVClick = useCallback(async (pov: POV) => {
    const anchor = pov.anchor ?? `Let's dig into #${pov.number}.`;
    const userMsg: Message = { kind: "user", text: anchor, avatarInitials: userAvatarInitials };
    setThread((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const response = await onUserMessage(anchor);
      if (response) setThread((prev) => [...prev, response]);
    } finally {
      setSending(false);
    }
  }, [onUserMessage, userAvatarInitials]);

  const handleActionTap = useCallback(async (item: ActionItem) => {
    if (item.kind === "navigate" && item.href) {
      window.location.href = item.href;
      return;
    }
    if (item.kind === "respond" && item.respondAs) {
      const userMsg: Message = { kind: "user", text: item.respondAs, avatarInitials: userAvatarInitials };
      setThread((prev) => [...prev, userMsg]);
      setSending(true);
      try {
        const response = await onUserMessage(item.respondAs);
        if (response) setThread((prev) => [...prev, response]);
      } finally {
        setSending(false);
      }
      return;
    }
    if (item.kind === "commit") {
      const ok = await onCommit(item);
      if (ok) {
        setThread((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i];
            if (m.kind === "director_response" && m.action?.items.some((it) => it.id === item.id)) {
              next[i] = {
                ...m,
                committedActionIds: [...(m.committedActionIds ?? []), item.id],
              };
              break;
            }
          }
          return next;
        });
      }
    }
  }, [onCommit, onUserMessage, userAvatarInitials]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    const userMsg: Message = { kind: "user", text, avatarInitials: userAvatarInitials };
    setThread((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    try {
      const response = await onUserMessage(text);
      if (response) setThread((prev) => [...prev, response]);
    } finally {
      setSending(false);
    }
  }, [input, onUserMessage, sending, userAvatarInitials]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: "14px 26px 26px 26px" }}>
        {thread.map((m, i) => {
          if (m.kind === "director_opening") {
            return <DirectorOpening key={i} message={m} onPOVClick={handlePOVClick} onReplyTap={handleActionTap} />;
          }
          if (m.kind === "director_response") {
            return <DirectorResponse key={i} message={m} onActionTap={handleActionTap} />;
          }
          return <UserBubble key={i} text={m.text} avatarInitials={m.avatarInitials} />;
        })}
        {sending && (
          <div style={{
            fontFamily: FM,
            fontSize: 11,
            letterSpacing: "0.18em",
            color: COLORS.muted,
            fontWeight: 700,
            textTransform: "uppercase",
            padding: "8px 4px",
          }}>
            {directorLabel} typing…
          </div>
        )}
      </div>

      <div style={{
        padding: "16px 26px 20px 26px",
        background: COLORS.cream,
        borderTop: `2px solid ${COLORS.ink}`,
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexShrink: 0,
      }}>
        <input
          type="text"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          style={{
            flex: 1,
            background: COLORS.paper,
            border: `3px solid ${COLORS.ink}`,
            padding: "12px 14px",
            fontFamily: F,
            fontSize: 14,
            color: COLORS.ink,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          style={{
            background: COLORS.blue,
            color: COLORS.paper,
            border: `3px solid ${COLORS.ink}`,
            boxShadow: `3px 3px 0 ${COLORS.ink}`,
            padding: "12px 20px",
            fontFamily: FH,
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: "0.2em",
            cursor: input.trim() && !sending ? "pointer" : "not-allowed",
            opacity: input.trim() && !sending ? 1 : 0.6,
            textTransform: "uppercase",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}