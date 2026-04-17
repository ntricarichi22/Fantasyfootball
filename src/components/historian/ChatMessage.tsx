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
          <div className="rounded-2xl rounded-tr-md bg-red-600/90 px-4 py-3 text-sm leading-relaxed text-white shadow-[0_10px_30px_rgba(239,68,68,0.18)]">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
          <span className="mt-1 text-[10px] uppercase tracking-wider text-gray-500">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>
        <div className="mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white/10 text-gray-300">
          <User className="h-4 w-4" />
        </div>
      </div>
    );
  }

  const isError = message.isError;
  return (
    <div className="flex justify-start gap-3">
      <div
        className={[
          "mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full ring-1",
          isError
            ? "bg-amber-500/15 text-amber-300 ring-amber-500/40"
            : "bg-red-600/20 text-red-300 ring-red-500/40",
        ].join(" ")}
      >
        {isError ? <AlertTriangle className="h-4 w-4" /> : <ScrollText className="h-4 w-4" />}
      </div>
      <div className="flex max-w-[85%] flex-col items-start">
        <div
          className={[
            "rounded-2xl rounded-tl-md border px-4 py-3 shadow-sm",
            isError
              ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
              : "border-white/5 bg-[#171a23] text-gray-100",
          ].join(" ")}
        >
          {isError ? (
            <p className="text-sm leading-relaxed">{message.content}</p>
          ) : (
            <Markdown text={message.content} />
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500">
          <span>{formatTimestamp(message.timestamp)}</span>
          {!isError && (
            <button
              type="button"
              onClick={handleCopy}
              className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 normal-case tracking-normal text-gray-500 transition hover:bg-white/5 hover:text-gray-200"
              aria-label="Copy answer"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span className="text-[11px] text-emerald-400">Copied!</span>
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
      <div className="mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-red-600/20 text-red-300 ring-1 ring-red-500/40">
        <ScrollText className="h-4 w-4" />
      </div>
      <div className="rounded-2xl rounded-tl-md border border-white/5 bg-[#171a23] px-4 py-3">
        <div className="flex items-center gap-1.5" aria-label="Historian is typing">
          <span className="h-2 w-2 animate-bounce rounded-full bg-red-400 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-red-400 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-red-400" />
        </div>
      </div>
    </div>
  );
}
