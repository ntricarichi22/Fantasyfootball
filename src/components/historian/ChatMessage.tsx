"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ScrollText, AlertTriangle, User } from "lucide-react";

import { Markdown } from "./markdown";
import { type ChatMessage as ChatMessageType, formatTimestamp } from "./types";

type Props = {
  message: ChatMessageType;
  question?: string;
};

export function ChatMessage({ message, question }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    const payload = `🏈 CFC Historian\nQ: ${question ?? ""}\nA: ${message.content}`.trim();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="flex max-w-[85%] flex-col items-end">
          <div className="cfc-card-ink px-4 py-3 text-sm leading-relaxed">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
          <span className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--cfc-muted)" }}>
            {formatTimestamp(message.timestamp)}
          </span>
        </div>
        <div className="mt-1 cfc-ai-icon bg-[var(--cfc-card)] border-[var(--cfc-muted-border)]">
          <User className="h-4 w-4" style={{ color: "var(--cfc-ink)" }} />
        </div>
      </div>
    );
  }

  const isError = message.isError;
  return (
    <div className="flex justify-start gap-3">
      <div className="mt-1 cfc-ai-icon">
        {isError ? <AlertTriangle className="h-4 w-4" style={{ color: "var(--cfc-yellow)" }} /> : <ScrollText className="h-4 w-4" />}
      </div>
      <div className="flex max-w-[85%] flex-col items-start">
        <div
          className={[
            "px-4 py-3",
            isError
              ? "cfc-toast cfc-toast-warning"
              : "cfc-card",
          ].join(" ")}
        >
          {isError ? (
            <p className="text-sm leading-relaxed">{message.content}</p>
          ) : (
            <Markdown text={message.content} />
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--cfc-muted)" }}>
          <span>{formatTimestamp(message.timestamp)}</span>
          {!isError && (
            <button
              type="button"
              onClick={handleCopy}
              className="cfc-chip cfc-chip-interactive text-[11px] normal-case tracking-normal inline-flex items-center gap-1"
              aria-label="Copy answer"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" style={{ color: "var(--cfc-blue)" }} />
                  <span className="text-[11px]" style={{ color: "var(--cfc-blue)" }}>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span className="text-[11px]">Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex justify-start gap-3">
      <div className="mt-1 cfc-ai-icon">
        <ScrollText className="h-4 w-4" />
      </div>
      <div className="cfc-card px-4 py-3">
        <div className="flex items-center gap-1.5" aria-label="Historian is typing">
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--cfc-red)] [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--cfc-red)] [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--cfc-red)]" />
        </div>
      </div>
    </div>
  );
}
