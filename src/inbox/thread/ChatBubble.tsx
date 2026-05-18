"use client";

type Props = {
  teamName: string;
  message: string;
  timestamp: string;
  isMe: boolean;
};

export default function ChatBubble({ teamName, message, timestamp, isMe }: Props) {
  return (
    <div style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: "65%",
          border: "1.5px solid #1A1A1A",
          background: isMe ? "#1A1A1A" : "#FEFCF9",
          color: isMe ? "#FEFCF9" : "#1A1A1A",
          padding: "10px 14px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 8,
            color: isMe ? "rgba(255,255,255,0.5)" : "#8C7E6A",
            marginBottom: 4,
          }}
        >
          {teamName} ·{" "}
          {new Date(timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.4,
            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
          }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}
