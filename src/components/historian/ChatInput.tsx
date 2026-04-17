"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";
import { Send } from "lucide-react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
};

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Ask the CFC Historian anything...",
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Autosize textarea up to a max height.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!disabled && value.trim()) onSend();
  };

  const canSend = !disabled && value.trim().length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#11131b] p-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] focus-within:border-red-500/50"
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        className="max-h-[180px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none disabled:opacity-60"
        aria-label="Ask the CFC Historian"
      />
      <button
        type="submit"
        disabled={!canSend}
        className={[
          "flex h-10 w-10 flex-none items-center justify-center rounded-xl transition",
          canSend
            ? "bg-red-600 text-white shadow-[0_10px_30px_rgba(239,68,68,0.25)] hover:bg-red-500"
            : "cursor-not-allowed bg-white/5 text-gray-500",
        ].join(" ")}
        aria-label="Send message"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
