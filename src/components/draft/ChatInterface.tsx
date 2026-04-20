import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Props = {
  messages: ChatMessage[];
  pending: boolean;
  errorMessage: string;
  onSendMessage: (text: string) => void;
};

const wrapperStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const baseBubbleStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 10,
  lineHeight: 1.4,
  padding: "5px 7px",
  border: "1.5px solid #1A1A1A",
  borderRadius: 0,
  maxWidth: "88%",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const userBubbleStyle: CSSProperties = {
  ...baseBubbleStyle,
  alignSelf: "flex-end",
  background: "#3366CC",
  color: "#FFFFFF",
};

const assistantBubbleStyle: CSSProperties = {
  ...baseBubbleStyle,
  alignSelf: "flex-start",
  background: "#F5F0E6",
  color: "#1A1A1A",
};

const errorBubbleStyle: CSSProperties = {
  ...assistantBubbleStyle,
  background: "#FCE8E4",
  color: "#8a2418",
};

const formStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 6,
  borderTop: "2px solid #1A1A1A",
  background: "#FFFFFF",
  padding: 8,
  flexShrink: 0,
};

const inputStyle: CSSProperties = {
  flex: 1,
  background: "#FEFCF9",
  border: "1px solid #ccc",
  borderRadius: 0,
  padding: "5px 7px",
  fontFamily: "var(--font-body)",
  fontSize: 10,
  color: "#1A1A1A",
  outline: "none",
  minWidth: 0,
};

const sendButtonStyle: CSSProperties = {
  width: 26,
  height: 26,
  border: "1.5px solid #1A1A1A",
  background: "#F5C230",
  color: "#1A1A1A",
  fontFamily: "var(--font-headline)",
  fontWeight: 700,
  fontSize: 12,
  lineHeight: 1,
  cursor: "pointer",
  borderRadius: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  padding: 0,
};

const sendButtonDisabledStyle: CSSProperties = {
  ...sendButtonStyle,
  background: "#e6dcb8",
  cursor: "not-allowed",
};

export function ChatMessageList({
  messages,
  pending,
  errorMessage,
}: Pick<Props, "messages" | "pending" | "errorMessage">) {
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending, errorMessage]);

  return (
    <div style={wrapperStyle}>
      {messages.map((message, index) => (
        <div
          key={index}
          style={message.role === "user" ? userBubbleStyle : assistantBubbleStyle}
        >
          {message.content}
        </div>
      ))}
      {pending ? <div style={assistantBubbleStyle}>Thinking…</div> : null}
      {errorMessage ? <div style={errorBubbleStyle}>{errorMessage}</div> : null}
      <div ref={scrollAnchorRef} />
    </div>
  );
}

export function ChatInputBar({
  pending,
  onSendMessage,
}: Pick<Props, "pending" | "onSendMessage">) {
  const [draft, setDraft] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || pending) return;
    onSendMessage(trimmed);
    setDraft("");
  };

  const disabled = pending || draft.trim().length === 0;

  return (
    <form style={formStyle} onSubmit={submit}>
      <input
        style={inputStyle}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Ask the Assistant GM..."
        aria-label="Ask the Assistant GM"
        disabled={pending}
      />
      <button
        type="submit"
        style={disabled ? sendButtonDisabledStyle : sendButtonStyle}
        disabled={disabled}
        aria-label="Send message"
      >
        →
      </button>
    </form>
  );
}
