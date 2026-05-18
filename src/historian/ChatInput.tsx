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
      className="cfc-input flex items-end gap-2 p-2"
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        className="max-h-[180px] flex-1 resize-none bg-transparent px-3 py-2 text-sm focus:outline-none disabled:opacity-60"
        style={{ color: "var(--cfc-ink)", caretColor: "var(--cfc-ink)" }}
        aria-label="Ask the CFC Historian"
      />
      <button
        type="submit"
        disabled={!canSend}
        className={[
          "cfc-btn cfc-btn-sm h-10 w-10 flex-none",
          canSend
            ? "cfc-btn-primary"
            : "opacity-50 cursor-not-allowed",
        ].join(" ")}
        aria-label="Send message"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
