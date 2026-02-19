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
} from "lucide-react";

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
  created_at: string;
  updated_at: string;
  read_at: string | null;
}

interface TradeMessage {
  id: string;
  offer_id: string;
  from_team_id: string;
  message: string;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Session helpers                                                     */
/* ------------------------------------------------------------------ */

const SELECTED_TEAM_CACHE_KEY = "cfc_selected_team";

const getStoredTeam = () => {
  if (typeof window === "undefined") return { rosterId: "", teamName: "" };
  try {
    const raw = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
    if (!raw) return { rosterId: "", teamName: "" };
    const parsed = JSON.parse(raw);
    return {
      rosterId: typeof parsed?.rosterId === "string" ? parsed.rosterId : "",
      teamName: typeof parsed?.teamName === "string" ? parsed.teamName : "",
    };
  } catch {
    return { rosterId: "", teamName: "" };
  }
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const statusColors: Record<string, string> = {
  pending: "bg-amber-600/80 text-amber-50",
  accepted: "bg-emerald-600/80 text-emerald-50",
  declined: "bg-red-600/80 text-red-50",
  withdrawn: "bg-gray-600/80 text-gray-50",
  countered: "bg-indigo-600/80 text-indigo-50",
  expired: "bg-gray-700/80 text-gray-300",
};

const gradeColors: Record<string, string> = {
  Steal: "bg-emerald-600 text-white",
  "Good Deal": "bg-emerald-700 text-white",
  Fair: "bg-blue-600 text-white",
  "Slight Overpay": "bg-amber-600 text-white",
  "Big Overpay": "bg-red-600 text-white",
  "Slight Underpay": "bg-teal-600 text-white",
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

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function TradeThreadPage() {
  const router = useRouter();
  const params = useParams();
  const offerId = typeof params.id === "string" ? params.id : "";

  const { rosterId } = getStoredTeam();

  const [offer, setOffer] = useState<TradeOffer | null>(null);
  const [messages, setMessages] = useState<TradeMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [rosterNames, setRosterNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showCounter, setShowCounter] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const getTeamLabel = useCallback(
    (teamId: string) => rosterNames[teamId] || `Team ${teamId}`,
    [rosterNames],
  );

  // Fetch roster names
  useEffect(() => {
    fetchRosterNames().then(setRosterNames);
  }, []);

  // Fetch offer
  const fetchOffer = useCallback(async () => {
    if (!offerId) return;
    try {
      const res = await fetch(`/api/trades/list?offerId=${encodeURIComponent(offerId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) setOffer(json.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [offerId]);

  useEffect(() => {
    fetchOffer();
  }, [fetchOffer]);

  // Mark as read
  useEffect(() => {
    if (!offer || !rosterId) return;
    if (offer.to_team_id === rosterId && !offer.read_at) {
      fetch("/api/trades/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer_id: offerId, team_id: rosterId }),
      }).catch(() => {});
    }
  }, [offer, rosterId, offerId]);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!offerId) return;
    try {
      const res = await fetch(`/api/trades/${encodeURIComponent(offerId)}/messages`);
      if (res.ok) {
        const json = await res.json();
        setMessages(json.data ?? []);
      }
    } catch {
      // ignore
    }
  }, [offerId]);

  useEffect(() => {
    fetchMessages();
    chatPollRef.current = setInterval(fetchMessages, 5_000);
    return () => {
      if (chatPollRef.current) clearInterval(chatPollRef.current);
    };
  }, [fetchMessages]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !rosterId) return;
    try {
      await fetch(`/api/trades/${encodeURIComponent(offerId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_team_id: rosterId, message: newMessage.trim() }),
      });
      setNewMessage("");
      await fetchMessages();
    } catch {
      showToast("Failed to send message");
    }
  };

  // Status actions
  const handleStatusChange = async (newStatus: string) => {
    if (!rosterId || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/trades/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer_id: offerId,
          team_id: rosterId,
          status: newStatus,
        }),
      });
      if (res.ok) {
        showToast(
          newStatus === "accepted"
            ? "Offer accepted!"
            : newStatus === "declined"
              ? "Offer declined"
              : "Offer withdrawn",
        );
        await fetchOffer();
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

  // Counter flow
  const handleManualCounter = () => {
    router.push(`/trade-builder?mode=counter&offerId=${encodeURIComponent(offerId)}`);
  };

  if (loading) {
    return (
      <main className="flex h-screen items-center justify-center bg-black text-gray-400">
        Loading…
      </main>
    );
  }

  if (!offer) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-gray-400">
        <p>Offer not found</p>
        <button
          type="button"
          onClick={() => router.push("/trades")}
          className="rounded-md bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700"
        >
          Back to Trades
        </button>
      </main>
    );
  }

  const isReceiver = offer.to_team_id === rosterId;
  const isSender = offer.from_team_id === rosterId;
  const isPending = offer.status === "pending";

  const senderName = getTeamLabel(offer.from_team_id);
  const receiverName = getTeamLabel(offer.to_team_id);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-black text-gray-100">
      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-lg bg-emerald-700 px-6 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-4 py-4">
        {/* Header */}
        <header className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/trades")}
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold text-white">Trade Thread</h1>
          <span
            className={`rounded-full px-3 py-0.5 text-xs font-bold uppercase ${statusColors[offer.status] || "bg-gray-700 text-gray-300"}`}
          >
            {offer.status}
          </span>
          <span
            className={`rounded-full px-3 py-0.5 text-xs font-bold ${gradeColors[offer.grade_label] || "bg-gray-700 text-gray-300"}`}
          >
            {offer.grade_label}
          </span>
        </header>

        {/* Main content: two panels */}
        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Left panel: Offer details */}
          <div className="flex w-1/2 flex-col gap-3 overflow-y-auto">
            {/* Offer card */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Sender gives */}
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                    {senderName} sends
                  </p>
                  <div className="space-y-1">
                    {(offer.assets_from ?? []).map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-1.5 text-xs"
                      >
                        <span className="flex-1 text-white">{a.label}</span>
                        {a.position && (
                          <span className="text-gray-500">
                            {a.position}
                            {a.team ? ` • ${a.team}` : ""}
                          </span>
                        )}
                        <span className="font-medium text-gray-300">
                          {a.value.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-right text-xs font-semibold text-gray-300">
                    Total: {offer.from_value.toLocaleString()}
                  </p>
                </div>

                {/* Receiver gives */}
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                    {receiverName} sends
                  </p>
                  <div className="space-y-1">
                    {(offer.assets_to ?? []).map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950 px-2 py-1.5 text-xs"
                      >
                        <span className="flex-1 text-white">{a.label}</span>
                        {a.position && (
                          <span className="text-gray-500">
                            {a.position}
                            {a.team ? ` • ${a.team}` : ""}
                          </span>
                        )}
                        <span className="font-medium text-gray-300">
                          {a.value.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-right text-xs font-semibold text-gray-300">
                    Total: {offer.to_value.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            {isPending && (
              <div className="flex gap-2">
                {isReceiver && (
                  <>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStatusChange("accepted")}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-40"
                    >
                      <Check className="h-4 w-4" />
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStatusChange("declined")}
                      className="flex items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-40"
                    >
                      <X className="h-4 w-4" />
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCounter(!showCounter)}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Counter
                    </button>
                  </>
                )}
                {isSender && (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleStatusChange("withdrawn")}
                    className="flex items-center gap-1.5 rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-600 disabled:opacity-40"
                  >
                    <Undo2 className="h-4 w-4" />
                    Withdraw
                  </button>
                )}
              </div>
            )}

            {/* Counter panel */}
            {showCounter && isPending && isReceiver && (
              <div className="rounded-xl border border-indigo-800/60 bg-indigo-950/30 p-4">
                <h3 className="mb-3 text-sm font-bold text-white">Counter Options</h3>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleManualCounter}
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-700"
                  >
                    ✏️ Edit Counter Manually
                    <p className="mt-1 text-xs font-normal text-gray-400">
                      Opens Manual Trade Builder pre-filled
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* Status message for non-pending */}
            {!isPending && (
              <div className="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-center text-sm text-gray-400">
                This offer has been <strong className="text-white">{offer.status}</strong>.
              </div>
            )}
          </div>

          {/* Right panel: Chat */}
          <div className="flex w-1/2 flex-col rounded-xl border border-gray-800 bg-gray-900/50">
            <div className="border-b border-gray-800 px-4 py-3">
              <h2 className="text-sm font-bold text-white">Chat</h2>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-gray-600">
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
                          isMe
                            ? "bg-red-700/60 text-white"
                            : "bg-gray-800 text-gray-200",
                        ].join(" ")}
                      >
                        {!isMe && (
                          <p className="mb-0.5 text-[10px] font-semibold text-gray-400">
                            {getTeamLabel(msg.from_team_id)}
                          </p>
                        )}
                        <p>{msg.message}</p>
                        <p className="mt-1 text-[10px] text-gray-500">
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
            <div className="border-t border-gray-800 p-3">
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
                  className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-gray-500"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim()}
                  className="rounded-lg bg-red-600 px-3 py-2 text-white transition hover:bg-red-500 disabled:opacity-40"
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
