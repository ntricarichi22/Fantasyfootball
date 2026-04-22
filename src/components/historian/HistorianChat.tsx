"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, ScrollText } from "lucide-react";

import { ChatInput } from "./ChatInput";
import { ChatMessage, TypingIndicator } from "./ChatMessage";
import { ConversationSidebar } from "./ConversationSidebar";
import { WelcomeScreen } from "./WelcomeScreen";
import {
  type ChatMessage as ChatMessageType,
  type Conversation,
  FUN_FACT_SESSION_KEY,
  deriveTitle,
  loadConversations,
  saveConversations,
  uid,
} from "./types";

const FUN_FACT_QUESTION =
  "Give me one fun or surprising fact about CFC league history. Pick something random and interesting — a crazy stat, a wild trade, an unlikely comeback, a record that still stands, etc. Keep it to 2-3 sentences and make it engaging.";

type State = {
  conversations: Conversation[];
  activeId: string | null;
};

type Action =
  | { type: "hydrate"; conversations: Conversation[] }
  | { type: "select"; id: string | null }
  | { type: "new" }
  | { type: "delete"; id: string }
  | { type: "appendMessage"; message: ChatMessageType };

function touchAndSort(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "hydrate":
      return {
        conversations: touchAndSort(action.conversations),
        activeId: null,
      };
    case "select":
      return { ...state, activeId: action.id };
    case "new":
      return { ...state, activeId: null };
    case "delete": {
      const next = state.conversations.filter((c) => c.id !== action.id);
      return {
        conversations: next,
        activeId: state.activeId === action.id ? null : state.activeId,
      };
    }
    case "appendMessage": {
      const now = new Date().toISOString();
      const activeId = state.activeId;
      if (activeId) {
        const next = state.conversations.map((c) =>
          c.id === activeId
            ? { ...c, updatedAt: now, messages: [...c.messages, action.message] }
            : c,
        );
        return { conversations: touchAndSort(next), activeId };
      }
      // Create a new conversation seeded with this message.
      // Title is derived from the first user message; otherwise a generic label.
      const title =
        action.message.role === "user"
          ? deriveTitle(action.message.content)
          : "New conversation";
      const newConv: Conversation = {
        id: uid(),
        title,
        updatedAt: now,
        messages: [action.message],
      };
      return {
        conversations: touchAndSort([newConv, ...state.conversations]),
        activeId: newConv.id,
      };
    }
    default:
      return state;
  }
}

async function askHistorian(question: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/api/llm/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  let data: {
    ok?: boolean;
    answer?: string;
    error?: string;
  } | null = null;
  try {
    data = await res.json();
  } catch {
    // ignore JSON parse error, handled below
  }
  if (!res.ok || !data || data.ok === false) {
    const message =
      (data && (data.error || data.answer)) ||
      `The historian couldn't answer that (HTTP ${res.status}).`;
    throw new Error(message);
  }
  return (data.answer ?? "").trim() || "The historian returned an empty response.";
}

export default function HistorianChat() {
  const [state, dispatch] = useReducer(reducer, {
    conversations: [],
    activeId: null,
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Fun-fact (cached in sessionStorage)
  const [funFact, setFunFact] = useState<string | null>(null);
  const [funFactLoading, setFunFactLoading] = useState(false);
  const [funFactError, setFunFactError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);

  // Hydrate conversations from localStorage on mount.
  useEffect(() => {
    dispatch({ type: "hydrate", conversations: loadConversations() });
    hydratedRef.current = true;
  }, []);

  // Persist conversations whenever they change (after hydration).
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveConversations(state.conversations);
  }, [state.conversations]);

  // Open the sidebar by default on desktop.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSidebarOpen(window.matchMedia("(min-width: 768px)").matches);
  }, []);

  // Fun fact: load from sessionStorage cache or fetch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = window.sessionStorage.getItem(FUN_FACT_SESSION_KEY);
    if (cached) {
      setFunFact(cached);
      return;
    }
    let cancelled = false;
    setFunFactLoading(true);
    askHistorian(FUN_FACT_QUESTION)
      .then((answer) => {
        if (cancelled) return;
        setFunFact(answer);
        try {
          window.sessionStorage.setItem(FUN_FACT_SESSION_KEY, answer);
        } catch {
          // ignore storage errors
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFunFactError(
          err instanceof Error
            ? err.message
            : "Couldn't load this week's CFC history fact.",
        );
      })
      .finally(() => {
        if (!cancelled) setFunFactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeConversation = useMemo(
    () => state.conversations.find((c) => c.id === state.activeId) ?? null,
    [state.activeId, state.conversations],
  );

  const messages = useMemo(
    () => activeConversation?.messages ?? [],
    [activeConversation],
  );

  // Auto-scroll on new messages or typing indicator.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, isLoading]);

  // Cancel in-flight request on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const sendQuestion = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || isLoading) return;

      const userMsg: ChatMessageType = {
        id: uid(),
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: "appendMessage", message: userMsg });
      setInput("");
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      try {
        const answer = await askHistorian(trimmed, controller.signal);
        dispatch({
          type: "appendMessage",
          message: {
            id: uid(),
            role: "assistant",
            content: answer,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error
            ? err.message
            : "Something went wrong contacting the historian.";
        dispatch({
          type: "appendMessage",
          message: {
            id: uid(),
            role: "assistant",
            content: message,
            timestamp: new Date().toISOString(),
            isError: true,
          },
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsLoading(false);
      }
    },
    [isLoading],
  );

  const handleSend = useCallback(() => {
    void sendQuestion(input);
  }, [input, sendQuestion]);

  const handleSuggestion = useCallback(
    (q: string) => {
      void sendQuestion(q);
    },
    [sendQuestion],
  );

  const handleNewConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setInput("");
    dispatch({ type: "new" });
  }, []);

  // Pair assistant messages back to the question that prompted them, for Copy.
  const questionForMessage = useCallback(
    (id: string): string | undefined => {
      const idx = messages.findIndex((m) => m.id === id);
      if (idx <= 0) return undefined;
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") return messages[i].content;
      }
      return undefined;
    },
    [messages],
  );

  return (
    <div className="flex flex-1" style={{ height: "calc(100vh - 44px - 44px)", overflow: "hidden" }}>
      <ConversationSidebar
        conversations={state.conversations}
        activeId={state.activeId}
        onSelect={(id) => {
          dispatch({ type: "select", id });
          if (typeof window !== "undefined" && window.innerWidth < 768) {
            setSidebarOpen(false);
          }
        }}
        onNew={() => {
          handleNewConversation();
          if (typeof window !== "undefined" && window.innerWidth < 768) {
            setSidebarOpen(false);
          }
        }}
        onDelete={(id) => dispatch({ type: "delete", id })}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b-[2.5px] border-[var(--cfc-ink)] bg-[var(--cfc-card)]">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="cfc-btn cfc-btn-sm"
            aria-label={sidebarOpen ? "Hide conversations" : "Show conversations"}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="hidden h-4 w-4 md:block" />
            ) : (
              <PanelLeftOpen className="hidden h-4 w-4 md:block" />
            )}
            <Menu className="h-4 w-4 md:hidden" />
          </button>
          <div className="cfc-ai-icon">
            <ScrollText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {activeConversation?.title ?? "CFC Historian"}
            </p>
            <p className="text-[11px]" style={{ color: "var(--cfc-muted)" }}>
              League history assistant
            </p>
          </div>
        </div>

        {/* Messages / welcome */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <WelcomeScreen
              onPick={handleSuggestion}
              funFact={funFact}
              funFactLoading={funFactLoading}
              funFactError={funFactError}
            />
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
              {messages.map((m) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  question={
                    m.role === "assistant" ? questionForMessage(m.id) : undefined
                  }
                />
              ))}
              {isLoading && <TypingIndicator />}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t-[2.5px] border-[var(--cfc-ink)] bg-[var(--cfc-card)] px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              disabled={isLoading}
            />
            <p className="mt-2 text-center text-[11px]" style={{ color: "var(--cfc-muted)" }}>
              Press <kbd className="cfc-chip text-[10px] px-1">Enter</kbd> to send,{" "}
              <kbd className="cfc-chip text-[10px] px-1">Shift</kbd> +{" "}
              <kbd className="cfc-chip text-[10px] px-1">Enter</kbd> for newline.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
