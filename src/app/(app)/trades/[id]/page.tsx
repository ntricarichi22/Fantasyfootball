"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  X,
  Undo2,
  RefreshCw,
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import TradeCenterTabs from "../../../../components/TradeCenterTabs";
import { readStoredTeam } from "../../../../lib/storedTeam";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface OfferAsset {
  key: string;
  label: string;
  type: "player" | "pick";
  position?: string;
  team?: string;
  ageLabel?: string;
  value: number;
}

interface TradeOffer {
  id: string;
  league_id: string;
  from_team_id: string;
  to_team_id: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
  grade_label: string;
  status: string;
  parent_offer_id: string | null;
  thread_id: string | null;
  created_at: string;
  updated_at: string;
  read_at: string | null;
}

interface TradeThread {
  id: string;
  league_id: string;
  team_a_id: string;
  team_b_id: string;
  created_by_team_id: string;
  status: string;
  last_activity_at: string;
}

interface TradeMessage {
  id: string;
  thread_id: string;
  from_team_id: string;
  message: string;
  created_at: string;
}

interface AISuggestion {
  grade_label: string;
  assets_from: OfferAsset[];
  assets_to: OfferAsset[];
  from_value: number;
  to_value: number;
  grade: string;
}

type Preference =
  | "more_value"
  | "more_picks"
  | "more_depth"
  | "prefer_2026"
  | "prefer_2027";

/* ------------------------------------------------------------------ */
/*  Session helpers                                                     */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const offerStatusColors: Record<string, string> = {
  pending: "cfc-chip cfc-chip-yellow",
  accepted: "cfc-chip cfc-chip-blue",
  declined: "cfc-chip cfc-chip-red",
  withdrawn: "cfc-chip cfc-chip-ink",
  countered: "cfc-chip",
};

const threadStatusColors: Record<string, string> = {
  open: "cfc-chip cfc-chip-yellow",
  accepted: "cfc-chip cfc-chip-blue",
  declined: "cfc-chip cfc-chip-red",
  withdrawn: "cfc-chip",
  closed: "cfc-chip cfc-chip-ink",
};

const gradeColors: Record<string, string> = {
  Steal: "cfc-chip cfc-chip-blue",
  "Good Deal": "cfc-chip cfc-chip-blue",
  Fair: "cfc-chip cfc-chip-yellow",
  "Slight Overpay": "cfc-chip cfc-chip-yellow",
  "Big Overpay": "cfc-chip cfc-chip-red",
  "Slight Underpay": "cfc-chip cfc-chip-ink",
};

const LEAGUE_ID_ENV = process.env.NEXT_PUBLIC_SLEEPER_LEAGUE_ID?.trim() || "";

async function fetchRosterNames(): Promise<Record<string, string>> {
  if (!LEAGUE_ID_ENV) return {};
  try {
    const [rostersRes, usersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID_ENV}/users`),
    ]);
    if (!rostersRes.ok || !usersRes.ok) return {};
    const rosters = await rostersRes.json();
    const users = await usersRes.json();
    const userMap: Record<string, string> = {};
    for (const u of users) {
      const name = u.metadata?.team_name || u.display_name || u.user_id;
      userMap[u.user_id] = name;
    }
    const map: Record<string, string> = {};
    for (const r of rosters) {
      const rid = String(r.roster_id);
      map[rid] = userMap[r.owner_id] || `Team ${rid}`;
    }
    return map;
  } catch {
    return {};
  }
}

const PREFERENCES: { value: Preference; label: string }[] = [
  { value: "more_value", label: "More value" },
  { value: "more_picks", label: "More picks" },
  { value: "more_depth", label: "More depth (2-for-1)" },
  { value: "prefer_2026", label: "Prefer 2026 picks" },
  { value: "prefer_2027", label: "Prefer 2027 picks" },
];

/* ------------------------------------------------------------------ */
/*  Offer card sub-component                                            */
/* ------------------------------------------------------------------ */

function OfferCard({
  offer,
  index,
  isLatest,
  senderName,
  receiverName,
  rosterId,
  onAccept,
  onDecline,
  onWithdraw,
  onCounter,
  actionLoading,
}: {
  offer: TradeOffer;
  index: number;
  isLatest: boolean;
  senderName: string;
  receiverName: string;
  rosterId: string;
  onAccept: () => void;
  onDecline: () => void;
  onWithdraw: () => void;
  onCounter: () => void;
  actionLoading: boolean;
}) {
  const isReceiver = offer.to_team_id === rosterId;
  const isSender = offer.from_team_id === rosterId;
  const isPending = offer.status === "pending";

  return (
    <div
      className={[
        "cfc-card rounded-xl p-4",
        isLatest && isPending
          ? "border-2"
          : "",
      ].join(" ")}
      style={
        isLatest && isPending
          ? { borderColor: "var(--cfc-blue)" }
          : undefined
      }
    >
      {/* Offer header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold" style={{ color: "var(--cfc-muted)" }}>
          #{index + 1} — {senderName} proposed
        </span>
        <span className="text-xs" style={{ color: "var(--cfc-muted)" }}>
          {new Date(offer.created_at).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span
          className={`ml-auto text-[10px] font-bold uppercase ${offerStatusColors[offer.status] || "cfc-chip cfc-chip-ink"}`}
        >
          {offer.status}
        </span>
        <span
          className={`text-[10px] font-bold ${gradeColors[offer.grade_label] || "cfc-chip cfc-chip-ink"}`}
        >
          {offer.grade_label}
        </span>
      </div>

      {/* Two-column assets */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--cfc-muted)" }}>
            {senderName} sends
          </p>
          <div className="space-y-1">
            {(offer.assets_from ?? []).map((a) => (
              <div
                key={a.key}
                className="cfc-card-flat flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
              >
                <span className="flex-1 text-[var(--cfc-ink)]">{a.label}</span>
                {a.position && (
                  <span style={{ color: "var(--cfc-muted)" }}>
                    {a.position}
                    {a.team ? ` · ${a.team}` : ""}
                  </span>
                )}
                <span className="font-medium" style={{ color: "var(--cfc-muted)" }}>{a.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-right text-[11px] font-semibold" style={{ color: "var(--cfc-muted)" }}>
            {offer.from_value.toLocaleString()}
          </p>
        </div>

        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--cfc-muted)" }}>
            {receiverName} sends
          </p>
          <div className="space-y-1">
            {(offer.assets_to ?? []).map((a) => (
              <div
                key={a.key}
                className="cfc-card-flat flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
              >
                <span className="flex-1 text-[var(--cfc-ink)]">{a.label}</span>
                {a.position && (
                  <span style={{ color: "var(--cfc-muted)" }}>
                    {a.position}
                    {a.team ? ` · ${a.team}` : ""}
                  </span>
                )}
                <span className="font-medium" style={{ color: "var(--cfc-muted)" }}>{a.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-right text-[11px] font-semibold" style={{ color: "var(--cfc-muted)" }}>
            {offer.to_value.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Action buttons (only on latest pending offer) */}
      {isLatest && isPending && (
        <div className="cfc-divider mt-3 flex flex-wrap gap-2 pt-3">
          {isReceiver && (
            <>
              <button
                type="button"
                disabled={actionLoading}
                onClick={onAccept}
                className="cfc-btn cfc-btn-accent cfc-btn-sm flex items-center gap-1.5"
              >
                <Check className="h-3.5 w-3.5" />
                Accept
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={onDecline}
                className="cfc-btn cfc-btn-danger cfc-btn-sm flex items-center gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                Decline
              </button>
              <button
                type="button"
                onClick={onCounter}
                className="cfc-btn cfc-btn-primary cfc-btn-sm flex items-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Counter
              </button>
            </>
          )}
          {isSender && (
            <button
              type="button"
              disabled={actionLoading}
              onClick={onWithdraw}
              className="cfc-btn cfc-btn-sm flex items-center gap-1.5"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Withdraw
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export default function TradeThreadPage() {
  const router = useRouter();
  const params = useParams();
  const threadId = typeof params.id === "string" ? params.id : "";

  const { rosterId = "" } = readStoredTeam();

  const [thread, setThread] = useState<TradeThread | null>(null);
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [messages, setMessages] = useState<TradeMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Counter panel state
  const [showCounterPanel, setShowCounterPanel] = useState(false);
  const [preference, setPreference] = useState<Preference>("more_value");
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<number | null>(null);
  const [sendingCounter, setSendingCounter] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const getTeamLabel = useCallback(
    (teamId: string) => rosterNames[teamId] || `Team ${teamId}`,
    [rosterNames],
  );

  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  // Fetch thread + offers
  const fetchThread = useCallback(async () => {
    if (!threadId) return;
    try {
      const res = await fetch(`/api/trades/threads/${encodeURIComponent(threadId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.thread) setThread(json.thread);
        if (json.offers) setOffers(json.offers);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    fetchThread();
    const interval = setInterval(fetchThread, 10_000);
    return () => clearInterval(interval);
  }, [fetchThread]);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!threadId) return;
    try {
      const res = await fetch(
        `/api/trades/threads/${encodeURIComponent(threadId)}/messages`,
      );
      if (res.ok) {
        const json = await res.json();
        setMessages(json.data ?? []);
      }
    } catch {
      // ignore
    }
  }, [threadId]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5_000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // The latest pending offer is the "active" one
  const latestPendingOffer = [...offers].reverse().find((o) => o.status === "pending") ?? null;

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !rosterId) return;
    const trimmed = newMessage.trim();
    try {
      const res = await fetch(
        `/api/trades/threads/${encodeURIComponent(threadId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from_team_id: rosterId, message: trimmed }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || `Server error ${res.status}`);
      }
      const saved: TradeMessage = json.data;
      // Optimistically append the message so the sender sees it immediately
      setMessages((prev) => [...prev, saved]);
      setNewMessage("");
      // Background refetch so the other team's polling picks up the persisted row
      fetchMessages();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to send message");
    }
  };

  // Status actions
  const handleStatusChange = async (newStatus: string) => {
    if (!rosterId || actionLoading || !latestPendingOffer) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/trades/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer_id: latestPendingOffer.id,
          team_id: rosterId,
          status: newStatus,
        }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        if (newStatus === "withdrawn" && json.deleted) {
          // Thread was hard-deleted; navigate back to trades list
          router.push("/trades");
          return;
        }
        showToast(
          newStatus === "accepted"
            ? "Offer accepted!"
            : newStatus === "declined"
              ? "Offer declined"
              : "Offer withdrawn",
        );
        await fetchThread();
      } else {
        const json = await res.json().catch(() => ({}));
        showToast(json.error || "Action failed");
      }
    } catch {
      showToast("Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  // Manual counter
  const handleManualCounter = () => {
    router.push(
      `/trade-builder?mode=counter&threadId=${encodeURIComponent(threadId)}`,
    );
  };

  // AI counter suggestions
  const handleGenerateAI = async () => {
    if (!latestPendingOffer || !rosterId) return;
    setAiLoading(true);
    setAiSuggestions(null);
    setSelectedSuggestion(null);
    try {
      const res = await fetch("/api/trades/ai-counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadId,
          counter_team_id: rosterId,
          preference,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setAiSuggestions(json.suggestions ?? []);
      } else {
        const json = await res.json().catch(() => ({}));
        showToast(json.error || "Failed to generate suggestions");
      }
    } catch {
      showToast("Failed to generate suggestions");
    } finally {
      setAiLoading(false);
    }
  };

  // Submit selected AI counter
  const handleSubmitAICounter = async () => {
    if (selectedSuggestion === null || !aiSuggestions || !latestPendingOffer || !rosterId)
      return;
    const suggestion = aiSuggestions[selectedSuggestion];
    setSendingCounter(true);
    try {
      const res = await fetch("/api/trades/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_team_id: rosterId,
          to_team_id: latestPendingOffer.from_team_id,
          assets_from: suggestion.assets_to, // what counter team sends
          assets_to: suggestion.assets_from, // what original sender sends back
          from_value: suggestion.to_value,
          to_value: suggestion.from_value,
          grade_label: suggestion.grade_label,
          parent_offer_id: latestPendingOffer.id,
          thread_id: threadId,
        }),
      });
      if (res.ok) {
        showToast("Counter offer sent!");
        setShowCounterPanel(false);
        setAiSuggestions(null);
        setSelectedSuggestion(null);
        await fetchThread();
      } else {
        const json = await res.json().catch(() => ({}));
        showToast(json.error || "Failed to send counter");
      }
    } catch {
      showToast("Failed to send counter");
    } finally {
      setSendingCounter(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-44px)] items-center justify-center">
        Loading…
      </main>
    );
  }

  if (!thread) {
    return (
      <main className="flex min-h-[calc(100vh-44px)] flex-col items-center justify-center gap-4">
        <p>Thread not found</p>
        <button
          type="button"
          onClick={() => router.push("/trades")}
          className="cfc-btn cfc-btn-sm"
        >
          Back to Trades
        </button>
      </main>
    );
  }

  const counterpartId =
    thread.team_a_id === rosterId ? thread.team_b_id : thread.team_a_id;

  return (
    <main className="flex min-h-[calc(100vh-44px)] flex-col overflow-hidden" style={{ background: "var(--cfc-canvas)" }}>
      {/* Toast */}
      {toast && (
        <div className="cfc-toast cfc-toast-success fixed left-1/2 top-6 z-50 -translate-x-1/2">
          {toast}
        </div>
      )}

      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-4 py-4">
        {/* Header */}
        <header className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/trades")}
            className="cfc-btn cfc-btn-sm"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="font-headline text-lg font-bold text-[var(--cfc-ink)]">
            Trade Thread · {getTeamLabel(counterpartId)}
          </h1>
          <span
            className={`text-xs font-bold uppercase ${threadStatusColors[thread.status] || "cfc-chip cfc-chip-ink"}`}
          >
            {thread.status}
          </span>
          <span className="ml-auto text-xs" style={{ color: "var(--cfc-muted)" }}>
            {offers.length} offer{offers.length !== 1 ? "s" : ""}
          </span>
        </header>

        {/* Trade Center tabs */}
        <TradeCenterTabs />

        {/* Main content: two panels */}
        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Left: Offer timeline */}
          <div className="flex w-1/2 flex-col gap-3 overflow-y-auto">
            {offers.length === 0 ? (
              <div className="cfc-card rounded-xl p-6 text-center text-sm" style={{ color: "var(--cfc-muted)" }}>
                No offers yet.
              </div>
            ) : (
              offers.map((offer, idx) => {
                const isLatest = idx === offers.length - 1;
                const senderName = getTeamLabel(offer.from_team_id);
                const receiverName = getTeamLabel(offer.to_team_id);
                return (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    index={idx}
                    isLatest={isLatest}
                    senderName={senderName}
                    receiverName={receiverName}
                    rosterId={rosterId}
                    onAccept={() => handleStatusChange("accepted")}
                    onDecline={() => handleStatusChange("declined")}
                    onWithdraw={() => handleStatusChange("withdrawn")}
                    onCounter={() => setShowCounterPanel(true)}
                    actionLoading={actionLoading}
                  />
                );
              })
            )}

            {/* Counter panel */}
            {showCounterPanel && latestPendingOffer && latestPendingOffer.to_team_id === rosterId && (
              <div className="cfc-card rounded-xl p-4">
                <div className="cfc-section-tag cfc-section-tag-blue mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--cfc-ink)]">Counter Options</h3>
                  <button
                    type="button"
                    onClick={() => setShowCounterPanel(false)}
                    style={{ color: "var(--cfc-muted)" }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  {/* AI Suggestions */}
                  <div className="cfc-card rounded-lg p-3">
                    <button
                      type="button"
                      onClick={() => setShowAiSuggestions(!showAiSuggestions)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <Sparkles className="h-4 w-4" style={{ color: "var(--cfc-blue)" }} />
                      <span className="flex-1 text-sm font-semibold text-[var(--cfc-ink)]">
                        AI Counter Suggestions
                      </span>
                      {showAiSuggestions ? (
                        <ChevronUp className="h-4 w-4" style={{ color: "var(--cfc-muted)" }} />
                      ) : (
                        <ChevronDown className="h-4 w-4" style={{ color: "var(--cfc-muted)" }} />
                      )}
                    </button>

                    {showAiSuggestions && (
                      <div className="mt-3 space-y-3">
                        {/* Preference chips */}
                        <div>
                          <p className="mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: "var(--cfc-muted)" }}>
                            Preference
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {PREFERENCES.map((p) => (
                              <button
                                key={p.value}
                                type="button"
                                onClick={() => setPreference(p.value)}
                                className={[
                                  "cfc-btn cfc-btn-sm",
                                  preference === p.value
                                    ? "cfc-btn-primary"
                                    : "",
                                ].join(" ")}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={aiLoading}
                          onClick={handleGenerateAI}
                          className="cfc-btn cfc-btn-primary w-full"
                        >
                          {aiLoading ? "Generating…" : "Generate 3 suggestions"}
                        </button>

                        {aiSuggestions && aiSuggestions.length > 0 && (
                          <div className="space-y-2">
                            {aiSuggestions.map((s, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setSelectedSuggestion(i)}
                                className={[
                                  "cfc-card w-full rounded-lg p-3 text-left transition",
                                  selectedSuggestion === i
                                    ? "border-2"
                                    : "",
                                ].join(" ")}
                                style={
                                  selectedSuggestion === i
                                    ? { borderColor: "var(--cfc-blue)" }
                                    : undefined
                                }
                              >
                                <div className="mb-1 flex items-center gap-2">
                                  <span className="text-xs font-bold text-[var(--cfc-ink)]">
                                    {s.grade_label}
                                  </span>
                                  <span
                                    className={`text-[9px] font-bold ${gradeColors[s.grade] || "cfc-chip cfc-chip-ink"}`}
                                  >
                                    {s.grade}
                                  </span>
                                  <span className="ml-auto text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                                    {s.from_value.toLocaleString()} pts
                                  </span>
                                </div>
                                <div className="text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                                  You get:{" "}
                                  {(s.assets_from ?? [])
                                    .slice(0, 3)
                                    .map((a) => a.label)
                                    .join(", ")}
                                  {(s.assets_from?.length ?? 0) > 3 && " …"}
                                </div>
                              </button>
                            ))}

                            {selectedSuggestion !== null && (
                              <button
                                type="button"
                                disabled={sendingCounter}
                                onClick={handleSubmitAICounter}
                                className="cfc-btn cfc-btn-accent w-full"
                              >
                                {sendingCounter ? "Sending…" : "Send this counter"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Manual counter */}
                  <button
                    type="button"
                    onClick={handleManualCounter}
                    className="cfc-btn flex w-full items-center gap-2 text-left"
                  >
                    <span>✏️</span>
                    <div>
                      <p>Edit Counter Manually</p>
                      <p className="text-xs font-normal" style={{ color: "var(--cfc-muted)" }}>
                        Opens Manual Trade Builder pre-filled
                      </p>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Closed thread notice */}
            {thread.status !== "open" && (
              <div className="cfc-card rounded-lg px-4 py-3 text-center text-sm" style={{ color: "var(--cfc-muted)" }}>
                This thread has been{" "}
                <strong className="text-[var(--cfc-ink)]">{thread.status}</strong>.
              </div>
            )}
          </div>

          {/* Right: Chat */}
          <div className="cfc-card flex w-1/2 flex-col rounded-xl">
            <div className="cfc-divider px-4 py-3">
              <h2 className="text-sm font-bold text-[var(--cfc-ink)]">Chat</h2>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="text-center text-sm" style={{ color: "var(--cfc-muted)" }}>
                  No messages yet. Start the conversation!
                </p>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.from_team_id === rosterId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={[
                          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                          isMe ? "cfc-card-ink" : "cfc-card",
                        ].join(" ")}
                        style={isMe ? { color: "#fff" } : undefined}
                      >
                        {!isMe && (
                          <p className="mb-0.5 text-[10px] font-semibold" style={{ color: "var(--cfc-muted)" }}>
                            {getTeamLabel(msg.from_team_id)}
                          </p>
                        )}
                        <p>{msg.message}</p>
                        <p className="mt-1 text-[10px]" style={{ color: isMe ? "rgba(255,255,255,0.6)" : "var(--cfc-muted)" }}>
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Message input */}
            <div className="cfc-divider p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type a message…"
                  className="cfc-input cfc-mono flex-1"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim()}
                  className="cfc-btn cfc-btn-primary cfc-btn-sm"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
