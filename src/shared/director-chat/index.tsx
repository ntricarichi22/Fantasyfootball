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
    }
  | {
      kind: "director_response";
      directorRole: DirectorRole;
      directorLabel: string;
      prose: string[];
      action?: {
        type: InlineActionType;
        items: ActionItem[];
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
}: {
  items: ActionItem[];
  committedIds?: string[];
  onTap: (item: ActionItem) => void;
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
        Your call:
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
}: {
  message: Extract<Message, { kind: "director_opening" }>;
  onPOVClick: (pov: POV) => void;
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
        />
      )}
    </DirectorBubble>
  );
}

export function DirectorChat({
  opening,
  directorLabel,
  directorRole,
  userAvatarInitials,
  onUserMessage,
  onCommit,
  placeholder = "Ask the director…",
}: {
  opening: Extract<Message, { kind: "director_opening" }>;
  directorLabel: string;
  directorRole: DirectorRole;
  userAvatarInitials: string;
  onUserMessage: (text: string) => Promise<Extract<Message, { kind: "director_response" }> | null>;
  onCommit: (item: ActionItem) => Promise<boolean>;
  placeholder?: string;
}) {
  const [thread, setThread] = useState<Message[]>([opening]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

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
            return <DirectorOpening key={i} message={m} onPOVClick={handlePOVClick} />;
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