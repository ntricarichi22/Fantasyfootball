import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type {
  AvailablePlayer,
  DraftLogEntry,
} from "../../lib/draft/types";
import type { TeamProfile } from "../../lib/trade/profile";
import { BriefingCard } from "./BriefingCard";
import {
  ChatInputBar,
  ChatMessageList,
  type ChatMessage,
} from "./ChatInterface";
import { RecommendationCard, type Recommendation } from "./RecommendationCard";

export type LeagueTeamContext = {
  rosterId: string;
  teamName: string;
  players: Array<{ name: string; pos: string; value: number }>;
  needs: string[];
  mode: string;
  posture: string;
  positionBands: Record<string, string>;
};

export type LeagueDraftContext = {
  status: string;
  isPaused: boolean;
  totalPicks: number;
  picksRemaining: number;
  teams: LeagueTeamContext[];
  fullAvailablePlayers: Array<{
    id: string;
    name: string;
    pos: string;
    team: string;
    school: string;
    rookie: boolean;
    age: string;
    value: number;
    fit: number;
    tradeValue: number;
  }>;
  myTeamTradeValues: Array<{ name: string; pos: string; value: number }>;
};

type Props = {
  teamName: string;
  ownerProfile: TeamProfile | null;
  availablePlayers: AvailablePlayer[];
  draftLog: DraftLogEntry[];
  onClockTeamName: string;
  currentRound: number;
  currentPickNumber: number;
  isOnClock: boolean;
  isDraftPaused: boolean;
  onDraftPlayer: (player: AvailablePlayer) => void;
  leagueContext: LeagueDraftContext | null;
};

export const ASSISTANT_GM_PANEL_WIDTH = 270;

const wrapperStyle: CSSProperties = {
  position: "relative",
  width: ASSISTANT_GM_PANEL_WIDTH,
  flexShrink: 0,
  height: "100%",
  background: "#FEFCF9",
  borderLeft: "2.5px solid #1A1A1A",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const stripeStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  bottom: 0,
  width: 5,
  display: "flex",
  flexDirection: "column",
  pointerEvents: "none",
  zIndex: 1,
};

const stripeSegmentStyle = (color: string): CSSProperties => ({
  flex: 1,
  background: color,
});

const headerStyle: CSSProperties = {
  background: "#F5F0E6",
  borderBottom: "1.5px solid #1A1A1A",
  padding: "8px 12px 8px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
  marginLeft: 5,
};

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#1A1A1A",
};

const liveStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontFamily: "var(--font-mono)",
  fontSize: 7,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const liveDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  background: "#4CAF50",
  borderRadius: 999,
  display: "inline-block",
};

const scrollAreaStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "10px 10px 10px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const RECENT_PICKS_SHOWN = 6;
const TOP_BOARD_FOR_LLM = 12;

// localStorage key tracking the highest pickIndex the user has already seen.
// Stored per-team so different sessions don't smear each other.
function lastSeenKey(teamName: string) {
  return `cfc.assistantGm.lastSeen:${teamName || "anon"}`;
}

function readLastSeen(teamName: string): number {
  if (typeof window === "undefined") return -1;
  try {
    const raw = window.localStorage.getItem(lastSeenKey(teamName));
    if (raw === null) return -1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : -1;
  } catch {
    return -1;
  }
}

function writeLastSeen(teamName: string, pickIndex: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastSeenKey(teamName), String(pickIndex));
  } catch {
    // ignore storage failures
  }
}

// Stable shape of a pick passed to the LLM. Trim down to the fields the
// model actually needs so prompts stay small.
function summarizePick(entry: DraftLogEntry) {
  return {
    pick: entry.pickNumber,
    player: entry.playerName,
    pos: (entry.positions || [])[0]?.toUpperCase() || "",
    team: entry.teamName,
  };
}

function summarizeAvailable(player: AvailablePlayer) {
  return {
    id: player.id,
    name: player.name,
    pos: player.position,
    team: player.team,
    school: player.school,
    rookie: player.isRookie,
    age: player.ageLabel,
    value: Math.round(player.valueScore),
    fit: Math.round(player.fitScore),
  };
}

export function AssistantGmPanel({
  teamName,
  ownerProfile,
  availablePlayers,
  draftLog,
  onClockTeamName,
  currentRound,
  currentPickNumber,
  isOnClock,
  isDraftPaused,
  onDraftPlayer,
  leagueContext,
}: Props) {
  // ----- briefing -----
  const [trendsText, setTrendsText] = useState("");
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState("");
  const briefingFetchedRef = useRef(false);

  // ----- recommendation -----
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const recommendationKeyRef = useRef("");

  // ----- chat -----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState("");

  const teamNeeds = useMemo(() => ownerProfile?.needs ?? [], [ownerProfile]);

  const topBoard = useMemo(
    () => availablePlayers.slice(0, TOP_BOARD_FOR_LLM).map(summarizeAvailable),
    [availablePlayers]
  );

  // Capture the last-seen pick index ONCE on first mount (per team) so the
  // briefing reflects "what happened while you were away," not "what's
  // happened ever." We then bump it forward after the briefing renders.
  const [lastSeenAtMount] = useState(() => readLastSeen(teamName));

  const recentPicks = useMemo(() => {
    return draftLog
      .filter((entry) => entry.pickIndex > lastSeenAtMount)
      .slice(-RECENT_PICKS_SHOWN);
  }, [draftLog, lastSeenAtMount]);

  // Auto-fire the briefing trends call once the data needed has arrived.
  useEffect(() => {
    if (briefingFetchedRef.current) return;
    if (!teamName) return;
    // Wait for at least the board to be populated; if there are no recent
    // picks we still want to mark the briefing fetched so we don't spin.
    if (availablePlayers.length === 0) return;

    briefingFetchedRef.current = true;

    if (recentPicks.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrendsText("Quiet board so far — no recent picks to analyze.");
      // Move the last-seen marker forward.
      const lastIndex = draftLog.reduce(
        (max, entry) => (entry.pickIndex > max ? entry.pickIndex : max),
        -1
      );
      writeLastSeen(teamName, lastIndex);
      return;
    }

    const controller = new AbortController();
    setTrendsLoading(true);
    setTrendsError("");

    fetch("/api/llm/draft-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        mode: "briefing",
        teamName,
        teamNeeds,
        recentPicks: recentPicks.map(summarizePick),
        availablePlayers: topBoard,
      }),
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as {
          ok?: boolean;
          text?: string;
          error?: string;
        } | null;
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || "Briefing unavailable");
        }
        setTrendsText(json.text || "");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTrendsError(
          error instanceof Error ? error.message : "Briefing unavailable right now."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setTrendsLoading(false);
        // Mark all current picks as seen.
        const lastIndex = draftLog.reduce(
          (max, entry) => (entry.pickIndex > max ? entry.pickIndex : max),
          -1
        );
        writeLastSeen(teamName, lastIndex);
      });

    return () => controller.abort();
  }, [teamName, availablePlayers.length, recentPicks, draftLog, teamNeeds, topBoard]);

  // Refresh the recommendation whenever the relevant inputs change. The key
  // dedupes back-to-back fetches caused by unrelated re-renders.
  useEffect(() => {
    // Bug 2 guard: only fire after available players, the user's roster
    // (ownerProfile), team needs, and the league context have all loaded.
    if (!teamName) return;
    if (availablePlayers.length === 0) return;
    if (!ownerProfile) return;
    if (teamNeeds.length === 0) return;
    if (!leagueContext) return;

    const key = [
      teamName,
      currentPickNumber,
      availablePlayers.length,
      availablePlayers[0]?.id ?? "",
      teamNeeds.join("|"),
    ].join(":");

    if (recommendationKeyRef.current === key) return;
    recommendationKeyRef.current = key;

    const controller = new AbortController();

    const myTeamSummary = leagueContext.teams.find(
      (t) => t.teamName === teamName
    );

    // Fix 4: keep the recommendation prompt small (top 15) and time it out
    // after 15s so the card doesn't spin forever.
    const recommendationPool = leagueContext.fullAvailablePlayers.slice(0, 15);
    const timeoutId = setTimeout(() => controller.abort("timeout"), 15000);

    const requestPayload = {
      mode: "recommendation" as const,
      teamName,
      teamNeeds,
      availablePlayers: recommendationPool,
      recentPicks: draftLog.slice(-RECENT_PICKS_SHOWN).map(summarizePick),
      roster: ownerProfile
        ? {
            mode: ownerProfile.mode,
            posture: ownerProfile.posture,
            positionRanks: ownerProfile.positionRanks,
            positionBands: ownerProfile.positionBands,
            averageAge: ownerProfile.averageAge,
            players: myTeamSummary?.players ?? [],
          }
        : null,
      myTeamTradeValues: leagueContext.myTeamTradeValues,
      leagueContext: {
        ...leagueContext,
        // Trim to the same top-15 so the server prompt stays small.
        fullAvailablePlayers: recommendationPool,
      },
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecommendationLoading(true);
    setRecommendationError("");

    console.log("[AssistantGM] recommendation request", requestPayload);

    fetch("/api/llm/draft-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(requestPayload),
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as {
          ok?: boolean;
          recommendation?: Recommendation;
          error?: string;
          raw?: string;
        } | null;
        console.log("[AssistantGM] recommendation response", {
          status: response.status,
          json,
        });
        if (!response.ok || !json?.ok || !json.recommendation) {
          throw new Error(
            json?.error || `Recommendation unavailable (${response.status})`
          );
        }
        setRecommendation(json.recommendation);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          if (controller.signal.reason === "timeout") {
            console.error("[AssistantGM] recommendation timed out");
            setRecommendationError(
              "Recommendation timed out — ask me in chat instead"
            );
          }
          return;
        }
        const message =
          error instanceof Error
            ? error.message
            : "Recommendation unavailable right now.";
        console.error("[AssistantGM] recommendation error", error);
        setRecommendationError(`Error: ${message}`);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        setRecommendationLoading(false);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    teamName,
    teamNeeds,
    availablePlayers,
    draftLog,
    ownerProfile,
    currentPickNumber,
    leagueContext,
  ]);

  const handleSendChat = useCallback(
    (text: string) => {
      const nextMessages: ChatMessage[] = [
        ...chatMessages,
        { role: "user", content: text },
      ];
      setChatMessages(nextMessages);
      setChatPending(true);
      setChatError("");

      // Bug 3: rebuild the full draft context fresh on every send so the
      // assistant always sees the latest available pool, draft log,
      // current pick, all team rosters, and team needs.
      const myTeamSummary =
        leagueContext?.teams.find((t) => t.teamName === teamName) ?? null;

      const requestPayload = {
        mode: "chat" as const,
        teamName,
        teamNeeds,
        availablePlayers: leagueContext?.fullAvailablePlayers ?? topBoard,
        draftLog: draftLog.map(summarizePick),
        roster: ownerProfile
          ? {
              mode: ownerProfile.mode,
              posture: ownerProfile.posture,
              positionRanks: ownerProfile.positionRanks,
              positionBands: ownerProfile.positionBands,
              averageAge: ownerProfile.averageAge,
              players: myTeamSummary?.players ?? [],
            }
          : null,
        currentPick: {
          round: currentRound,
          pick: currentPickNumber,
          onClock: onClockTeamName,
        },
        isDraftPaused,
        leagueContext,
        myTeamTradeValues: leagueContext?.myTeamTradeValues ?? [],
        messages: nextMessages,
      };

      console.log("[AssistantGM] chat request", requestPayload);

      fetch("/api/llm/draft-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      })
        .then(async (response) => {
          const json = (await response.json().catch(() => null)) as {
            ok?: boolean;
            text?: string;
            error?: string;
          } | null;
          console.log("[AssistantGM] chat response", {
            status: response.status,
            json,
          });
          if (!response.ok || !json?.ok) {
            throw new Error(json?.error || "Assistant GM is unavailable.");
          }
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: json.text || "(no response)" },
          ]);
        })
        .catch((error: unknown) => {
          console.error("[AssistantGM] chat error", error);
          setChatError(
            error instanceof Error
              ? error.message
              : "Assistant GM is unavailable right now."
          );
        })
        .finally(() => setChatPending(false));
    },
    [
      chatMessages,
      teamName,
      teamNeeds,
      topBoard,
      draftLog,
      ownerProfile,
      currentRound,
      currentPickNumber,
      onClockTeamName,
      isDraftPaused,
      leagueContext,
    ]
  );

  const handleDraftRecommended = useCallback(
    (rec: Recommendation) => {
      const player =
        availablePlayers.find((p) => p.id === rec.playerId) ||
        availablePlayers.find(
          (p) => p.name.toLowerCase() === rec.playerName.toLowerCase()
        );
      if (player) {
        onDraftPlayer(player);
      }
    },
    [availablePlayers, onDraftPlayer]
  );

  const canDraftRecommended =
    !isDraftPaused &&
    isOnClock &&
    !!recommendation &&
    !!availablePlayers.find(
      (p) =>
        p.id === recommendation.playerId ||
        p.name.toLowerCase() === recommendation.playerName.toLowerCase()
    );

  return (
    <div style={wrapperStyle} aria-label="Assistant GM panel">
      <div style={stripeStyle} aria-hidden="true">
        <div style={stripeSegmentStyle("#E8503A")} />
        <div style={stripeSegmentStyle("#F5C230")} />
        <div style={stripeSegmentStyle("#3366CC")} />
      </div>

      <div style={headerStyle}>
        <span style={titleStyle}>Assistant GM</span>
        <span style={liveStyle}>
          <span style={liveDotStyle} />
          Live
        </span>
      </div>

      <div style={scrollAreaStyle}>
        <BriefingCard
          recentPicks={recentPicks}
          trendsText={trendsText}
          trendsLoading={trendsLoading}
          trendsError={trendsError}
        />
        <RecommendationCard
          recommendation={recommendation}
          loading={recommendationLoading}
          errorMessage={recommendationError}
          canDraft={canDraftRecommended}
          onDraft={handleDraftRecommended}
        />
        <ChatMessageList
          messages={chatMessages}
          pending={chatPending}
          errorMessage={chatError}
        />
      </div>

      <ChatInputBar pending={chatPending} onSendMessage={handleSendChat} />
    </div>
  );
}
