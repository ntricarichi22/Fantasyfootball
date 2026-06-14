"use client";

// Shared send-confirmation modal with an optional note. Used by every place a
// trade leaves the building — the trade builder, the door/studio offer flows,
// and the counter drawer. The note posts as a trade_message into the thread.
//
// The primary button flips: "Send as is" with an empty field, the caller's
// primaryLabel (e.g. "Send offer" / "Send counter") once the GM types a line.

import { useState } from "react";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";
const FH = "var(--font-headline, 'Syne', sans-serif)";

type Props = {
  partnerName: string;
  primaryLabel?: string;
  onSend: (message: string) => void;
  onClose: () => void;
  sending?: boolean;
};

export default function SendNoteModal({
  partnerName,
  primaryLabel = "Send offer",
  onSend,
  onClose,
  sending = false,
}: Props) {
  const [msg, setMsg] = useState("");
  const hasNote = msg.trim().length > 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26,26,26,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: "#FEFCF9",
          border: "2.5px solid #1A1A1A",
          boxShadow: "4px 4px 0 #1A1A1A",
          padding: "22px 24px",
          width: "90%",
          maxWidth: 380,
        }}
      >
        <div
          onClick={onClose}
          style={{ position: "absolute", top: 13, right: 16, fontSize: 17, color: "#8C7E6A", cursor: "pointer", fontWeight: 700 }}
        >
          ✕
        </div>
        <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 17, marginBottom: 7, color: "#1A1A1A" }}>
          Add a note?
        </div>
        <div style={{ fontSize: 13, color: "#8C7E6A", marginBottom: 14, lineHeight: 1.45, fontFamily: F }}>
          Send to {partnerName} — in your own words, or as is.
        </div>
        <textarea
          autoFocus
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Type a message…"
          rows={3}
          style={{
            width: "100%",
            boxSizing: "border-box",
            colorScheme: "light",
            background: "#F5F0E6",
            border: "1.5px solid #C8C3B8",
            padding: "11px 13px",
            fontSize: 13,
            lineHeight: 1.45,
            fontFamily: F,
            color: "#1A1A1A",
            outline: "none",
            resize: "none",
            marginBottom: 16,
          }}
        />
        <button
          type="button"
          disabled={sending}
          onClick={() => onSend(msg.trim())}
          style={{
            width: "100%",
            background: "#185FA5",
            color: "#FEFCF9",
            border: "2px solid #1A1A1A",
            boxShadow: "3px 3px 0 #1A1A1A",
            padding: 12,
            textAlign: "center",
            fontFamily: FM,
            fontSize: 12,
            letterSpacing: "0.1em",
            fontWeight: 700,
            textTransform: "uppercase",
            cursor: sending ? "not-allowed" : "pointer",
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? "Sending…" : hasNote ? primaryLabel : "Send as is"}
        </button>
      </div>
    </div>
  );
}
