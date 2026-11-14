import { browserStorageKey } from "../infrastructure/identity/browserStorage.ts";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** True when this is an error response from the API */
  isError?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  /** ISO timestamp of last activity */
  updatedAt: string;
  messages: ChatMessage[];
};

export const conversationStorageKey = (scope: string | null) => browserStorageKey("historian-conversations", scope);
export const funFactStorageKey = (scope: string | null) => browserStorageKey("historian-fun-fact", scope);

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function deriveTitle(question: string): string {
  const cleaned = question.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57)}…`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(days / 365);
  return `${years}y ago`;
}

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  return typeof message.id === "string"
    && (message.role === "user" || message.role === "assistant" || message.role === "system")
    && typeof message.content === "string"
    && typeof message.timestamp === "string";
}

export function loadConversations(scope: string | null): Conversation[] {
  if (typeof window === "undefined" || !scope) return [];
  try {
    // Legacy v1 data is retained but has no owner and must not be shown to an arbitrary account.
    const raw = window.localStorage.getItem(conversationStorageKey(scope)!);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is Conversation =>
          c &&
          typeof c.id === "string" &&
          typeof c.title === "string" &&
          typeof c.updatedAt === "string" &&
          Array.isArray(c.messages) && c.messages.every(isMessage),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function saveConversations(scope: string | null, list: Conversation[]) {
  if (typeof window === "undefined" || !scope) return;
  try {
    window.localStorage.setItem(conversationStorageKey(scope)!, JSON.stringify(list));
  } catch {
    // ignore quota errors
  }
}
