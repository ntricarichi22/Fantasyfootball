"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatPickKey,
  PICK_SLOT_SEASON,
} from "@/infrastructure/picks";
import { getLeagueId } from "@/infrastructure/config";
import {
  ACTIVE_TEAMS_REFRESH_MS,
  HEARTBEAT_INTERVAL_MS,
  SELECTED_TEAM_CACHE_KEY,
} from "@/scouting/draft-room/constants";
import type {
  ActiveTeamApiRow,
  ActiveTeamRecord,
} from "@/scouting/draft-room/types";
import {
  generateSessionId,
  getStoredSessionSelection,
  toId,
} from "@/scouting/draft-room/helpers";
import { useSleeperData } from "@/infrastructure/sleeper/useSleeperData";
import { HomeScreen } from "@/components/HomeScreen";

export default function Home() {
  const draftRoute = "/scouting/draft-room";

  // ─── Identity & session state ────────────────────────────────────────────
  const [selectedTeam, setSelectedTeam] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith("cfc_identity="));
      if (!match) return "";
      const raw = decodeURIComponent(match.split("=")[1]);
      const identity = JSON.parse(raw);
      return identity?.rosterId ?? "";
    } catch {
      return "";
    }
  });
  const [sessionId, setSessionId] = useState(() => getStoredSessionSelection().sessionId);
  const [teamSelectionInput, setTeamSelectionInput] = useState(
    () => getStoredSessionSelection().rosterId
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [claimingTeam, setClaimingTeam] = useState(false);
  const [openTradeCount, setOpenTradeCount] = useState(0);
  const [activeTeams, setActiveTeams] = useState<ActiveTeamRecord[]>([]);

  // ─── League ID ───────────────────────────────────────────────────────────
  const { leagueId, leagueIdError } = useMemo(() => {
    try {
      return { leagueId: getLeagueId(), leagueIdError: "" };
    } catch (error) {
      return {
        leagueId: "",
        leagueIdError:
          error instanceof Error
            ? error.message
            : "Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID.",
      };
    }
  }, []);

  // ─── Sleeper data (teams + draftState for pick slots) ────────────────────
  const { teams, draftState } = useSleeperData({
    leagueId,
    leagueIdError,
    setErrorMessage,
  });

  // ─── Identity sync from cookie ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith("cfc_identity="));
      if (!match) return;
      const raw = decodeURIComponent(match.split("=")[1]);
      const identity = JSON.parse(raw);
      if (identity?.rosterId && identity?.teamName) {
        const stored = sessionStorage.getItem(SELECTED_TEAM_CACHE_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        if (parsed.rosterId !== identity.rosterId) {
          sessionStorage.setItem(
            SELECTED_TEAM_CACHE_KEY,
            JSON.stringify({
              rosterId: identity.rosterId,
              teamName: identity.teamName,
              sessionId: parsed.sessionId || "",
            })
          );
          setSelectedTeam(identity.rosterId);
          setTeamSelectionInput(identity.rosterId);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // ─── Open trade count ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedTeam) return;
    fetch("/api/home/trade-count")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.count === "number") setOpenTradeCount(data.count);
      })
      .catch(() => {});
  }, [selectedTeam]);

  // ─── My draft pick slots (for War Room door stat) ────────────────────────
  const myDraftPickSlots = useMemo(() => {
    if (!draftState?.pickOwnerByPickKey || !selectedTeam) return [];
    return Object.entries(draftState.pickOwnerByPickKey)
      .filter(([, owner]) => toId(owner) === selectedTeam)
      .map(([pickKey]) => pickKey)
      .sort();
  }, [draftState?.pickOwnerByPickKey, selectedTeam]);

  // ─── Session management ──────────────────────────────────────────────────
  const clearSessionSelection = useCallback(() => {
    setSelectedTeam("");
    setTeamSelectionInput("");
    setSessionId("");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SELECTED_TEAM_CACHE_KEY);
    }
  }, []);

  const releaseActiveTeam = useCallback(async () => {
    if (!selectedTeam || !sessionId || !leagueId) return;
    try {
      await fetch("/api/active-teams/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId, rosterId: selectedTeam, sessionId }),
        keepalive: true,
      });
    } catch (error) {
      console.warn("Unable to release team", error);
    }
  }, [leagueId, selectedTeam, sessionId]);

  const releaseAndClearSession = useCallback(async () => {
    await releaseActiveTeam();
    clearSessionSelection();
  }, [clearSessionSelection, releaseActiveTeam]);

  const ensureSession = useCallback(() => {
    if (sessionId) return sessionId;
    try {
      const next = generateSessionId();
      setSessionId(next);
      return next;
    } catch (error) {
      console.error("Unable to generate session id", error);
      setErrorMessage("Unable to generate secure session ID. Please refresh and try again.");
      return "";
    }
  }, [sessionId]);

  const fetchActiveTeams = useCallback(async () => {
    if (!leagueId) return;
    try {
      const res = await fetch(`/api/active-teams?leagueId=${leagueId}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch active teams");
      const json = await res.json();
      const rows: ActiveTeamApiRow[] = Array.isArray(json?.data) ? json.data : [];
      const normalized = rows
        .map(
          (row): ActiveTeamRecord => ({
            rosterId: toId(row?.rosterId ?? row?.roster_id),
            sessionId:
              typeof row?.sessionId === "string"
                ? row.sessionId
                : typeof row?.session_id === "string"
                  ? row.session_id
                  : "",
          })
        )
        .filter((row): row is ActiveTeamRecord => Boolean(row.rosterId));
      setActiveTeams(normalized);
    } catch (error) {
      console.warn("Unable to load active teams", error);
    }
  }, [leagueId]);

  // poll active teams while no team selected
  useEffect(() => {
    if (selectedTeam || !leagueId) return;
    fetchActiveTeams();
    const interval = setInterval(fetchActiveTeams, ACTIVE_TEAMS_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchActiveTeams, leagueId, selectedTeam]);

  // heartbeat to keep claim alive
  useEffect(() => {
    if (!selectedTeam || !sessionId || !leagueId) return;
    let cancelled = false;

    const sendHeartbeat = async () => {
      try {
        const res = await fetch("/api/active-teams/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leagueId, rosterId: selectedTeam, sessionId }),
        });

        if (!res.ok && !cancelled) {
          setErrorMessage(
            res.status === 409
              ? "Another session is using this team. Please pick again."
              : "Your session ended. Please pick a team again."
          );
          await releaseAndClearSession();
        }
      } catch (error) {
        console.warn("Heartbeat failed", error);
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [leagueId, releaseAndClearSession, selectedTeam, sessionId]);

  // release on tab unload
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedTeam || !sessionId || !leagueId) return;

    const handleUnload = () => {
      try {
        const payload = JSON.stringify({ leagueId, rosterId: selectedTeam, sessionId });
        const blob = new Blob([payload], { type: "application/json" });
        const queued = navigator.sendBeacon("/api/active-teams/release", blob);
        if (!queued) {
          fetch("/api/active-teams/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener("unload", handleUnload);
    return () => window.removeEventListener("unload", handleUnload);
  }, [leagueId, selectedTeam, sessionId]);

  // sync sessionStorage with selectedTeam/sessionId/teamName
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedTeam || !sessionId) {
      sessionStorage.removeItem(SELECTED_TEAM_CACHE_KEY);
      return;
    }
    const selectedTeamName = teams.find((t) => toId(t.id) === selectedTeam)?.name;
    try {
      sessionStorage.setItem(
        SELECTED_TEAM_CACHE_KEY,
        JSON.stringify({
          rosterId: selectedTeam,
          sessionId,
          teamName: selectedTeamName || "",
        })
      );
    } catch {
      // ignore
    }
  }, [selectedTeam, sessionId, teams]);

  // ─── Enter draft room ────────────────────────────────────────────────────
  const handleEnterDraftRoom = useCallback(async () => {
    if (!teamSelectionInput) {
      setErrorMessage("Please choose a team.");
      return;
    }
    if (!leagueId) {
      setErrorMessage(
        leagueIdError || "Sleeper league ID is not configured. Set NEXT_PUBLIC_SLEEPER_LEAGUE_ID."
      );
      return;
    }
    const activeSessionId = ensureSession();
    if (!activeSessionId) return;

    setClaimingTeam(true);
    try {
      const res = await fetch("/api/active-teams/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId,
          rosterId: teamSelectionInput,
          sessionId: activeSessionId,
        }),
      });

      if (!res.ok) {
        await fetchActiveTeams();
        setErrorMessage(
          res.status === 409
            ? "That team is currently taken. Please choose another team."
            : "Unable to enter the draft room. Please try again."
        );
        return;
      }

      setSelectedTeam(teamSelectionInput);
      setErrorMessage("");
      sessionStorage.setItem(
        SELECTED_TEAM_CACHE_KEY,
        JSON.stringify({
          rosterId: teamSelectionInput,
          sessionId: activeSessionId,
          teamName: teams.find((t) => toId(t.id) === teamSelectionInput)?.name || "",
        })
      );
      window.location.href = draftRoute;
    } catch (error) {
      console.warn("Unable to claim team", error);
      setErrorMessage("Unable to enter the draft room. Please try again.");
    } finally {
      setClaimingTeam(false);
    }
  }, [draftRoute, ensureSession, fetchActiveTeams, leagueId, leagueIdError, teamSelectionInput, teams]);

  // suppress unused-var lint while keeping the values in scope for future hooks/components
  void activeTeams;
  void errorMessage;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <main className="relative min-h-screen text-[var(--cfc-ink)]">
      {leagueIdError && (
        <div
          className="relative z-20 mx-auto mb-4 mt-4 w-[calc(100%-2rem)] max-w-4xl px-4 py-3"
          style={{
            background: "var(--cfc-yellow)",
            color: "var(--cfc-ink)",
            border: "var(--cfc-border)",
            borderRadius: "8px",
            boxShadow: "var(--cfc-shadow-sm)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {leagueIdError} Live Sleeper data is unavailable until it is set.
        </div>
      )}
      <HomeScreen
        teamName={teams.find((t) => toId(t.id) === selectedTeam)?.name || ""}
        rosterId={selectedTeam}
        claimingTeam={claimingTeam}
        draftPickSlots={myDraftPickSlots}
        openTradeCount={openTradeCount}
        onEnterDraftRoom={() => {
          setTeamSelectionInput(selectedTeam);
          void handleEnterDraftRoom();
        }}
      />
    </main>
  );
}

// formatPickKey + PICK_SLOT_SEASON are imported above for HomeScreen-adjacent calculations
// that may consume them via hooks in the future. Suppress unused-import lint for now.
void formatPickKey;
void PICK_SLOT_SEASON;