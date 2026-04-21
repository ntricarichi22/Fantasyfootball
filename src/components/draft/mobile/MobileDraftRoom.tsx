"use client";

import { useEffect, useState } from "react";

import { toggleChimeMuted, useChimeMuted } from "../../../lib/chime";
import type {
  AvailablePlayer,
  DraftLogEntry,
  RookieProspect,
  RookieProspectMap,
  SleeperPlayer,
} from "../../../lib/draft/types";
import { normalizeName } from "@/lib/normalize";
import type { NflTeamContextMap, ScoutingGradeSet } from "../../../lib/draft/scouting";
import type { TeamProfile, PositionKey } from "../../../lib/trade/profile";
import type { StarterAsset } from "../../../lib/trade/starterLevel";
import { AssistantGmPanel, type LeagueDraftContext } from "../AssistantGmPanel";
import { LineupCard } from "../LineupCard";
import { TeamNeedsCard } from "../TeamNeedsCard";

import { MobileBottomSheet } from "./MobileBottomSheet";
import { MobileClockBar } from "./MobileClockBar";
import { MobileDraftBoard } from "./MobileDraftBoard";
import { MobileFlipCardModal } from "./MobileFlipCardModal";
import { MobileHamburgerMenu } from "./MobileHamburgerMenu";
import { MobileTabBar, type MobileTab } from "./MobileTabBar";
import { MobileTicker } from "./MobileTicker";
import { MobileTopBar } from "./MobileTopBar";

type VisibleLineupSlot = { slot: string; index: number };

type Props = {
  // Routing
  onNavigate: (href: string) => void;
  currentPath?: string;

  // Draft board
  availablePlayers: AvailablePlayer[];
  isUserOnClock: boolean;
  isDraftPaused: boolean;
  onPlayerDraft: (player: AvailablePlayer) => void;

  // Player card lookup
  playerDictionary: Record<string, SleeperPlayer>;
  rookieProspects: RookieProspectMap;
  nflTeamContext: NflTeamContextMap;
  precomputedScoutingGrades: Map<string, ScoutingGradeSet>;

  // Roster panel
  visibleLineupSlots: VisibleLineupSlot[];
  resolvedLineup: string[];
  benchPlayers: string[];
  ownerProfile: TeamProfile | null;
  starterAssets: StarterAsset[];
  hasEmptyStarterSlot: Record<PositionKey, boolean>;
  teamCount: number;

  // Assistant GM panel
  assistantTeamName: string;
  draftLog: DraftLogEntry[];
  onClockTeamName: string;
  currentRound: number;
  currentPickNumber: number;
  leagueContext: LeagueDraftContext | null;
};

const NAV_ITEMS = [
  { href: "/draft", label: "Draft Room" },
  { href: "/team-hq", label: "Team HQ" },
  { href: "/trades", label: "Trade Center" },
  { href: "/historian", label: "Historian" },
];

/**
 * Mobile draft room — orchestrator for the from-scratch ≤768px layout.
 *
 * Owns local state for: hamburger menu open/closed, currently-open bottom
 * sheet (tab bar selection), and the player card flip modal. Reuses
 * existing data props passed in from `src/app/page.tsx` so the desktop
 * codepath is unchanged.
 *
 * Sets `document.body.dataset.mobileDraft = "true"` while mounted so the
 * AppShell's desktop chrome stays hidden via CSS rules in `globals.css`.
 */
export function MobileDraftRoom(props: Props) {
  const {
    onNavigate,
    currentPath,
    availablePlayers,
    isUserOnClock,
    isDraftPaused,
    onPlayerDraft,
    playerDictionary,
    rookieProspects,
    nflTeamContext,
    precomputedScoutingGrades,
    visibleLineupSlots,
    resolvedLineup,
    benchPlayers,
    ownerProfile,
    starterAssets,
    hasEmptyStarterSlot,
    teamCount,
    assistantTeamName,
    draftLog,
    onClockTeamName,
    currentRound,
    currentPickNumber,
    leagueContext,
  } = props;

  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MobileTab | null>(null);
  const [scoutingPlayer, setScoutingPlayer] = useState<AvailablePlayer | null>(null);

  // While the mobile draft room is mounted, hide the AppShell desktop chrome.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.body.dataset.mobileDraft;
    document.body.dataset.mobileDraft = "true";
    return () => {
      if (previous === undefined) {
        delete document.body.dataset.mobileDraft;
      } else {
        document.body.dataset.mobileDraft = previous;
      }
    };
  }, []);

  // Mute is module-scoped state; this hook re-renders the toggle when changed.
  const muted = useChimeMuted();

  const handleSelectTab = (tab: MobileTab) => {
    setActiveTab((prev) => (prev === tab ? null : tab));
  };
  const closeSheet = () => setActiveTab(null);

  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    active:
      currentPath === item.href ||
      (currentPath?.startsWith(`${item.href}/`) ?? false),
  }));

  // Resolve the rookie-prospect row + sleeper player for the open card.
  const cardProspect: RookieProspect | null = scoutingPlayer
    ? rookieProspects[normalizeName(scoutingPlayer.name)] ?? null
    : null;
  const cardSleeperPlayer = scoutingPlayer
    ? playerDictionary[scoutingPlayer.id]
    : undefined;
  const cardGrades = scoutingPlayer
    ? precomputedScoutingGrades.get(scoutingPlayer.id) ?? null
    : null;

  return (
    <>
      <div className="cfc-mobile-root" role="application" aria-label="Mobile draft room">
        <MobileTopBar
          onOpenMenu={() => setMenuOpen(true)}
          onTradePress={() => onNavigate("/trades")}
        />

        <MobileClockBar />

        <MobileDraftBoard
          availablePlayers={availablePlayers}
          isUserOnClock={isUserOnClock}
          isDraftPaused={isDraftPaused}
          onPlayerSelect={(player) => setScoutingPlayer(player)}
          onDraftPlayer={(player) => {
            onPlayerDraft(player);
          }}
        />

        <MobileTabBar activeTab={activeTab} onSelectTab={handleSelectTab} />

        <MobileTicker />
      </div>

      {/* Bottom sheet — single sheet that swaps content based on tab. */}
      <MobileBottomSheet
        open={activeTab !== null}
        title={
          activeTab === "roster"
            ? "My Roster"
            : activeTab === "assistant"
              ? "Asst. GM"
              : activeTab === "trade"
                ? "Trade"
                : ""
        }
        onClose={closeSheet}
      >
        {activeTab === "roster" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <TeamNeedsCard
              ownerProfile={ownerProfile}
              starterAssets={starterAssets}
              hasEmptyStarterSlot={hasEmptyStarterSlot}
              teamCount={teamCount}
            />
            <LineupCard
              visibleLineupSlots={visibleLineupSlots}
              resolvedLineup={resolvedLineup}
              benchPlayers={benchPlayers}
              playerDictionary={playerDictionary}
            />
          </div>
        ) : null}

        {activeTab === "assistant" ? (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <AssistantGmPanel
              teamName={assistantTeamName}
              ownerProfile={ownerProfile}
              availablePlayers={availablePlayers}
              draftLog={draftLog}
              onClockTeamName={onClockTeamName}
              currentRound={currentRound}
              currentPickNumber={currentPickNumber}
              isOnClock={isUserOnClock}
              isDraftPaused={isDraftPaused}
              onDraftPlayer={(player) => {
                onPlayerDraft(player);
                closeSheet();
              }}
              leagueContext={leagueContext}
            />
          </div>
        ) : null}

        {activeTab === "trade" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "#1A1A1A" }}>
              Open the full Trade Center to browse offers, build a trade, or shop a pick.
            </p>
            <button
              type="button"
              className="cfc-btn cfc-btn-accent"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                onNavigate("/trades");
                closeSheet();
              }}
            >
              Open Trade Center
            </button>
          </div>
        ) : null}
      </MobileBottomSheet>

      <MobileHamburgerMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        navItems={navItems}
        onNavigate={onNavigate}
        muted={muted}
        onToggleMute={() => {
          toggleChimeMuted();
        }}
      />

      {scoutingPlayer ? (
        <MobileFlipCardModal
          player={scoutingPlayer}
          sleeperPlayer={cardSleeperPlayer}
          rookieProspect={cardProspect}
          precomputedGrades={cardGrades}
          contextMap={nflTeamContext}
          canDraft={isUserOnClock && !isDraftPaused}
          onDraft={(p) => {
            onPlayerDraft(p);
            setScoutingPlayer(null);
          }}
          onClose={() => setScoutingPlayer(null)}
        />
      ) : null}
    </>
  );
}
