"use client";

import { authenticatedAiFetch } from "@/infrastructure/ai/client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, ScrollText } from "lucide-react";

import { ChatInput } from "./ChatInput";
import { ChatMessage, TypingIndicator } from "./ChatMessage";
import { ConversationSidebar } from "./ConversationSidebar";
import { historianReducer } from "./state";
import { useBrowserStorageScope } from "@/infrastructure/identity/BrowserStorageScopeProvider";
import { WelcomeScreen } from "./WelcomeScreen";
import {
  type ChatMessage as ChatMessageType,
  funFactStorageKey,
  loadConversations,
  saveConversations,
  uid,
} from "./types";

const FUN_FACT_QUESTION =
  "Give me one fun or surprising fact about CFC league history. Pick something random and interesting — a crazy stat, a wild trade, an unlikely comeback, a record that still stands, etc. Keep it to 2-3 sentences and make it engaging.";

type Quota = { used_micros: number; remaining_micros: number; reset_at: string };

function dollars(micros: number) {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

async function askHistorian(question: string, signal?: AbortSignal): Promise<string> {
  const res = await authenticatedAiFetch("/api/llm/ask", {
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
  const storageScope = useBrowserStorageScope();
  const [state, dispatch] = useReducer(historianReducer, {
    conversations: [],
    activeId: null,
    hydrated: false,
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Fun-fact (cached in sessionStorage)
  const [funFact, setFunFact] = useState<string | null>(null);
  const [funFactLoading, setFunFactLoading] = useState(false);
  const [funFactError, setFunFactError] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate conversations from localStorage on mount.
  useEffect(() => {
    dispatch({ type: "hydrate", conversations: loadConversations(storageScope) });
  }, [storageScope]);

  const refreshQuota = useCallback(async () => {
    try {
      const response = await authenticatedAiFetch("/api/ai/quota");
      const payload = await response.json() as { quota?: Quota };
      if (response.ok && payload.quota) setQuota(payload.quota);
    } catch { /* The chat error remains the actionable failure surface. */ }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Load the authenticated remote quota after mount.
  useEffect(() => { void refreshQuota(); }, [refreshQuota]);

  // Persist conversations whenever they change (after hydration).
  useEffect(() => {
    if (!state.hydrated) return;
    saveConversations(storageScope, state.conversations);
  }, [state.conversations, state.hydrated, storageScope]);

  // Open the sidebar by default on desktop.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The browser media query is unavailable during server rendering.
    setSidebarOpen(window.matchMedia("(min-width: 768px)").matches);
  }, []);

  // Fun fact: load from sessionStorage cache or fetch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cacheKey = funFactStorageKey(storageScope);
    let cached: string | null = null;
    try { if (cacheKey) cached = window.sessionStorage.getItem(cacheKey); } catch { /* storage is optional */ }
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the optional browser cache before making a paid request.
      setFunFact(cached);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setFunFactLoading(true);
    askHistorian(FUN_FACT_QUESTION, controller.signal)
      .then((answer) => {
        if (cancelled) return;
        setFunFact(answer);
        try {
          if (cacheKey) window.sessionStorage.setItem(cacheKey, answer);
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
      controller.abort();
    };
  }, [storageScope]);

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
      if (!trimmed || isLoading || !state.hydrated) return;
      const conversationId = state.activeId ?? uid();

      const userMsg: ChatMessageType = {
        id: uid(),
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: "appendMessage", conversationId, message: userMsg });
      setInput("");
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      try {
        const answer = await askHistorian(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        dispatch({
          type: "appendMessage",
          conversationId,
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
          conversationId,
          message: {
            id: uid(),
            role: "assistant",
            content: message,
            timestamp: new Date().toISOString(),
            isError: true,
          },
        });
      } finally {
        void refreshQuota();
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [isLoading, refreshQuota, state.activeId, state.hydrated],
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
    <div className="flex flex-1" style={{ height: "calc(100vh - 44px - 50px)", overflow: "hidden" }}>
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
              {quota
                ? `${dollars(quota.used_micros)} used · ${dollars(quota.remaining_micros)} left · resets ${new Date(quota.reset_at).toLocaleDateString()}`
                : "League history assistant"}
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
