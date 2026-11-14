"use client";

import { useLeagueFetch } from "@/infrastructure/identity/useLeagueFetch";

import { useEffect, useState, useCallback } from "react";
import { useStoredTeam } from "@/infrastructure/identity/BrowserStorageScopeProvider";
import { browserStorageKey, readBrowserJson, writeBrowserJson } from "@/infrastructure/identity/browserStorage";
import { useBrowserStorageScope } from "@/infrastructure/identity/BrowserStorageScopeProvider";
import { teamCrestSrc, teamInitials } from "@/shared/league-data/nicknames";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import {
  DirectorChat,
  type Message,
  type ActionItem,
  type POV,
} from "@/shared/director-chat";

const DIRECTOR_LABEL = "SCOUTING DIRECTOR";

const FIRST_TIME_WELCOME =
  "Boss — good to finally sit down.";

const FIRST_TIME_PITCH =
  "I keep our board sharper than the league's, and I'm reading the teams around our pick to know exactly when we should move up or down. I run mocks so we know how every scenario plays out before draft day. Bottom line, if it touches the draft, it runs through me.";

const TRANSITION_3_POVS = "Few things on my mind already:";
const TRANSITION_1_POV = "One thing on my mind already, boss:";
const CLOSING_WITH_POVS = "Tap one, or tell me what's on your mind.";
const CLOSING_1_POV_TAIL = "Otherwise we're in good shape. What do you want to look at?";
const CLOSING_EMPTY_FIRST_TIME = "Nothing on fire yet — what's on your mind?";

const RETURNING_WELCOME_3 = "Welcome back, boss. Couple things to flag:";
const RETURNING_WELCOME_1 = "Welcome back, boss. One thing on my mind:";
const RETURNING_WELCOME_0 = "Welcome back, boss. Nothing new on my end. Anything you want to dig into?";

function buildFirstTimeOpening(povs: POV[]): Extract<Message, { kind: "director_opening" }> {
  if (povs.length === 0) {
    return {
      kind: "director_opening",
      directorRole: "scouting",
      directorLabel: DIRECTOR_LABEL,
      welcome: FIRST_TIME_WELCOME,
      pitch: FIRST_TIME_PITCH,
      povs: [],
      closing: CLOSING_EMPTY_FIRST_TIME,
    };
  }
  if (povs.length === 1) {
    return {
      kind: "director_opening",
      directorRole: "scouting",
      directorLabel: DIRECTOR_LABEL,
      welcome: FIRST_TIME_WELCOME,
      pitch: FIRST_TIME_PITCH,
      transition: TRANSITION_1_POV,
      povs,
      closing: CLOSING_1_POV_TAIL,
    };
  }
  return {
    kind: "director_opening",
    directorRole: "scouting",
    directorLabel: DIRECTOR_LABEL,
    welcome: FIRST_TIME_WELCOME,
    pitch: FIRST_TIME_PITCH,
    transition: TRANSITION_3_POVS,
    povs: povs.slice(0, 3),
    closing: CLOSING_WITH_POVS,
  };
}

function buildReturningOpening(povs: POV[]): Extract<Message, { kind: "director_opening" }> {
  if (povs.length === 0) {
    return {
      kind: "director_opening",
      directorRole: "scouting",
      directorLabel: DIRECTOR_LABEL,
      welcome: RETURNING_WELCOME_0,
      povs: [],
      closing: "",
    };
  }
  if (povs.length === 1) {
    return {
      kind: "director_opening",
      directorRole: "scouting",
      directorLabel: DIRECTOR_LABEL,
      welcome: RETURNING_WELCOME_1,
      povs,
      closing: CLOSING_1_POV_TAIL,
    };
  }
  return {
    kind: "director_opening",
    directorRole: "scouting",
    directorLabel: DIRECTOR_LABEL,
    welcome: RETURNING_WELCOME_3,
    povs: povs.slice(0, 3),
    closing: CLOSING_WITH_POVS,
  };
}

export function ScoutingOffice() {
  const fetch = useLeagueFetch();
  const leagueId = useStoredTeam().leagueId ?? "";
  const storageScope = useBrowserStorageScope();
  const visitedKey = browserStorageKey("scouting-office-visited", storageScope);
  const stored = useStoredTeam();
  const rosterId = stored.rosterId ?? "";
  const teamName = stored.teamName ?? "";
  const avatarInitials = teamInitials(teamName);
  const avatarSrc = teamCrestSrc(teamName, leagueId);

  const [opening, setOpening] = useState<Extract<Message, { kind: "director_opening" }> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const isFirstTime = readBrowserJson("localStorage", visitedKey) !== true;

    if (!rosterId) {
      const built = isFirstTime ? buildFirstTimeOpening([]) : buildReturningOpening([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the opening from browser identity and visit storage.
      setOpening(built);
      setLoadFailed(true);
      return;
    }

    (async () => {
      let povs: POV[] = [];
      try {
        const r = await fetch("/api/scouting/office/opening", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roster_id: rosterId }),
        });
        if (r.ok) {
          const j = await r.json();
          povs = j.povs ?? [];
        } else if (!cancelled) setLoadFailed(true);
      } catch (err) {
        console.error("Opening fetch failed", err);
        if (!cancelled) setLoadFailed(true);
      }

      if (cancelled) return;
      const built = isFirstTime ? buildFirstTimeOpening(povs) : buildReturningOpening(povs);
      setOpening(built);

      if (isFirstTime) writeBrowserJson("localStorage", visitedKey, true);
    })();

    return () => { cancelled = true; };
  }, [fetch, rosterId, visitedKey]);

  const handleUserMessage = useCallback(async (text: string): Promise<Extract<Message, { kind: "director_response" }> | null> => {
    try {
      const r = await fetch("/api/scouting/office/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, message: text }),
      });
      if (r.ok) {
        const j = await r.json();
        return {
          kind: "director_response",
          directorRole: "scouting",
          directorLabel: DIRECTOR_LABEL,
          prose: j.prose ?? [],
          action: j.action,
        };
      }
      if (r.status === 501) {
        return {
          kind: "director_response",
          directorRole: "scouting",
          directorLabel: DIRECTOR_LABEL,
          prose: [
            "I hear you. Real response coming once the intel backend ships — for now this is a stub so you can see the chat flow.",
          ],
        };
      }
    } catch (err) {
      console.error("Respond failed", err);
    }
    return {
      kind: "director_response",
      directorRole: "scouting",
      directorLabel: DIRECTOR_LABEL,
      prose: ["Something went wrong. Try again in a sec."],
    };
  }, [fetch, rosterId]);

  const handleCommit = useCallback(async (item: ActionItem): Promise<boolean> => {
    if (!item.commit) return false;
    try {
      const r = await fetch(item.commit.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.commit.body ?? {}),
      });
      return r.ok;
    } catch (err) {
      console.error("Commit failed", err);
      return false;
    }
  }, [fetch]);

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "#F5F0E6",
    }}>
      <UnifiedTopbar />

      <div style={{ padding: "28px 26px 14px 26px", flexShrink: 0 }}>
        <div style={{
          fontFamily: "var(--font-headline, 'Syne', sans-serif)",
          fontWeight: 900,
          fontSize: 36,
          color: "#1A1A1A",
          letterSpacing: "-0.015em",
          lineHeight: 1.04,
        }}>
          Scouting Director
        </div>
        {loadFailed && (
          <div style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            letterSpacing: "0.16em",
            color: "#E8503A",
            fontWeight: 700,
            marginTop: 6,
            textTransform: "uppercase",
          }}>
            Scouting insights are unavailable. Please try again later.
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {opening ? (
          <DirectorChat
            opening={opening}
            directorLabel={DIRECTOR_LABEL}
            directorRole="scouting"
            userAvatarInitials={avatarInitials}
            userAvatarSrc={avatarSrc}
            onUserMessage={handleUserMessage}
            onCommit={handleCommit}
            placeholder="Ask the Scouting Director…"
          />
        ) : (
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 11,
            letterSpacing: "0.18em",
            color: "#8C7E6A",
            fontWeight: 700,
            textTransform: "uppercase",
          }}>
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
