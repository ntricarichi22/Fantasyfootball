"use client";

// The Pro Personnel OFFICE door (org-chart "ENTER →") — the EXACT same chat
// chassis as the Scouting office and the Build-a-Trade door. The only thing a
// door changes is the opening message: walking in cold gets the welcome (or
// welcome-back) + whatever he wants you to know; "Build a Trade" preloads the
// storyline read instead (see trade-door/TradeDoor.tsx).
//
// POVs here are hand-set placeholders until the personnel intel composer ships
// (the office/opening endpoint), mirroring how the Scouting office launched.

import { useCallback, useEffect, useState } from "react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import {
  DirectorChat,
  type Message,
  type ActionItem,
  type POV,
} from "@/shared/director-chat";

const DIRECTOR_LABEL = "PERSONNEL DIRECTOR";
const VISITED_KEY = "cfc_personnel_office_visited";

const FIRST_TIME_WELCOME = "Boss — good to finally sit down.";

const FIRST_TIME_PITCH =
  "I run our trade market. I'm on the phones with the other eleven owners every day — who's buying, who's selling, who's getting desperate. When you want to make a move, I've usually already made the calls. Bottom line: if it involves a trade, it runs through me.";

const TRANSITION_3_POVS = "Few things on my mind already:";
const TRANSITION_1_POV = "One thing on my mind already, boss:";
const CLOSING_WITH_POVS = "Tap one, or tell me what's on your mind.";
const CLOSING_1_POV_TAIL = "Otherwise the phones are quiet. What do you want to look at?";
const CLOSING_EMPTY_FIRST_TIME = "Phones are quiet right now — what's on your mind?";

const RETURNING_WELCOME_3 = "Welcome back, boss. Couple things to flag:";
const RETURNING_WELCOME_1 = "Welcome back, boss. One thing on my mind:";
const RETURNING_WELCOME_0 = "Welcome back, boss. Quiet day on the phones. Anything you want to dig into?";

const SAMPLE_POVS: POV[] = [
  {
    id: "pov-inbound-interest",
    number: 1,
    text: "Two teams have called about our RB room this week. Nothing formal yet, but there's real interest if we want to listen.",
    anchor: "Who's calling about our backs?",
  },
  {
    id: "pov-market-heat",
    number: 2,
    text: "The QB market is hot right now — superflex desperation is setting in around the league. If we ever wanted to cash a quarterback, this is the window.",
    anchor: "Talk to me about the QB market.",
  },
  {
    id: "pov-build-a-trade",
    number: 3,
    text: "I've got the board mapped — storylines, targets, and real packages behind each one. Say the word and I'll walk you through it.",
    anchor: "Walk me through the board.",
  },
];

type Opening = Extract<Message, { kind: "director_opening" }>;
type Response = Extract<Message, { kind: "director_response" }>;

function buildFirstTimeOpening(povs: POV[]): Opening {
  if (povs.length === 0) {
    return {
      kind: "director_opening",
      directorRole: "personnel",
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
      directorRole: "personnel",
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
    directorRole: "personnel",
    directorLabel: DIRECTOR_LABEL,
    welcome: FIRST_TIME_WELCOME,
    pitch: FIRST_TIME_PITCH,
    transition: TRANSITION_3_POVS,
    povs: povs.slice(0, 3),
    closing: CLOSING_WITH_POVS,
  };
}

function buildReturningOpening(povs: POV[]): Opening {
  if (povs.length === 0) {
    return {
      kind: "director_opening",
      directorRole: "personnel",
      directorLabel: DIRECTOR_LABEL,
      welcome: RETURNING_WELCOME_0,
      povs: [],
      closing: "",
    };
  }
  if (povs.length === 1) {
    return {
      kind: "director_opening",
      directorRole: "personnel",
      directorLabel: DIRECTOR_LABEL,
      welcome: RETURNING_WELCOME_1,
      povs,
      closing: CLOSING_1_POV_TAIL,
    };
  }
  return {
    kind: "director_opening",
    directorRole: "personnel",
    directorLabel: DIRECTOR_LABEL,
    welcome: RETURNING_WELCOME_3,
    povs: povs.slice(0, 3),
    closing: CLOSING_WITH_POVS,
  };
}

export function PersonnelOffice() {
  const stored = readStoredTeam();
  const rosterId = stored.rosterId ?? "";
  const avatarInitials = "NT";

  const [opening, setOpening] = useState<Opening | null>(null);

  useEffect(() => {
    // Deferred a tick so the opening isn't set synchronously inside the effect
    // body (react-hooks/set-state-in-effect).
    const t = setTimeout(() => {
      const isFirstTime = !localStorage.getItem(VISITED_KEY);
      setOpening(isFirstTime ? buildFirstTimeOpening(SAMPLE_POVS) : buildReturningOpening(SAMPLE_POVS));
      if (isFirstTime) localStorage.setItem(VISITED_KEY, "1");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const handleUserMessage = useCallback(async (text: string): Promise<Response | null> => {
    // The board walkthrough hands off to the Build-a-Trade door — that room is
    // this same chat preloaded with the storyline read.
    if (text === "Walk me through the board.") {
      window.location.href = "/pro-personnel/trade-builder";
      return null;
    }
    try {
      const r = await fetch("/api/pro-personnel/office/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster_id: rosterId, message: text }),
      });
      if (r.ok) {
        const j = await r.json();
        return {
          kind: "director_response",
          directorRole: "personnel",
          directorLabel: DIRECTOR_LABEL,
          prose: j.prose ?? [],
          action: j.action,
        };
      }
    } catch {}
    return {
      kind: "director_response",
      directorRole: "personnel",
      directorLabel: DIRECTOR_LABEL,
      prose: [
        "I hear you. Full conversations come online once my intel desk ships — for now, the live board is the place to work: tap below and I'll walk you through the deals I've already lined up.",
      ],
      action: {
        type: "deep_link",
        items: [
          { id: "__board__", label: "Walk me through the board", kind: "navigate", href: "/pro-personnel/trade-builder" },
          { id: "__shop__", label: "Shop my guys", kind: "navigate", href: "/pro-personnel/trade-studio" },
        ],
      },
    };
  }, [rosterId]);

  const handleCommit = useCallback(async (item: ActionItem): Promise<boolean> => {
    if (!item.commit) return false;
    try {
      const r = await fetch(item.commit.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.commit.body ?? {}),
      });
      return r.ok;
    } catch {
      return false;
    }
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#F5F0E6" }}>
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
          Personnel Director
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {opening ? (
          <DirectorChat
            opening={opening}
            directorLabel={DIRECTOR_LABEL}
            directorRole="personnel"
            userAvatarInitials={avatarInitials}
            onUserMessage={handleUserMessage}
            onCommit={handleCommit}
            placeholder="Ask the Personnel Director…"
          />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 11, letterSpacing: "0.18em", color: "#8C7E6A", fontWeight: 700, textTransform: "uppercase" }}>
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
