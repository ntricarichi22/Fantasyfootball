import type { DragEvent, KeyboardEvent } from "react";

import { DRAFT_ORDER_UNAVAILABLE_MESSAGE, type DraftPick } from "../../lib/picks";
import { DROPPABLE_BORDER_CLASS } from "../../lib/draft/constants";
import { playerLabel, toId } from "../../lib/draft/helpers";
import type { DraftedPlayer, SleeperPlayer, Team } from "../../lib/draft/types";

type VisibleLineupSlot = { slot: string; index: number };

type Props = {
  teams: Team[];
  selectedTeam: string;
  statusMessage: string;
  errorMessage: string;
  visibleLineupSlots: VisibleLineupSlot[];
  resolvedLineup: string[];
  playerDictionary: Record<string, SleeperPlayer>;
  draggedBenchPlayer: string;
  benchPlayers: string[];
  draftOrderAvailable: boolean | null;
  activeRosterDraftPicks: DraftPick[] | undefined;
  draftedPlayersForTeam: DraftedPlayer[];
  slotSelections: Record<string, string>;
  draftPickText: (pick: DraftPick) => string;
  onSlotSelectionChange: (playerId: string, value: string) => void;
  onMoveDraftedPlayerToSlot: (player: DraftedPlayer, slotIndex: number) => void;
  onSlotDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onSlotDrop: (event: DragEvent<HTMLDivElement>, slotIndex: number) => void;
  onSlotKeyDown: (event: KeyboardEvent<HTMLDivElement>, slotIndex: number) => void;
  onBenchDragStart: (event: DragEvent<HTMLElement>, playerId: string) => void;
  onBenchDragEnd: () => void;
  onBenchKeyDown: (event: KeyboardEvent<HTMLElement>, playerId: string) => void;
};

export function RosterDisplay({
  teams,
  selectedTeam,
  statusMessage,
  errorMessage,
  visibleLineupSlots,
  resolvedLineup,
  playerDictionary,
  draggedBenchPlayer,
  benchPlayers,
  draftOrderAvailable,
  activeRosterDraftPicks,
  draftedPlayersForTeam,
  slotSelections,
  draftPickText,
  onSlotSelectionChange,
  onMoveDraftedPlayerToSlot,
  onSlotDragOver,
  onSlotDrop,
  onSlotKeyDown,
  onBenchDragStart,
  onBenchDragEnd,
  onBenchKeyDown,
}: Props) {
  return (
    <div className="cfc-card w-1/4 min-w-[260px] flex flex-col overflow-hidden p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-headline text-xl text-[var(--cfc-ink)] truncate">
          {teams.find((t) => toId(t.id) === selectedTeam)?.name || selectedTeam}
        </h2>
        {statusMessage && (
          <span className="cfc-chip cfc-chip-blue" style={{ fontSize: 9 }}>
            {statusMessage}
          </span>
        )}
      </div>
      <div className="mt-3 mb-3">
        <label
          className="block mb-1 text-[10px] font-bold uppercase tracking-[0.08em]"
          style={{ color: "var(--cfc-muted)" }}
          htmlFor="team-switcher"
        >
          View another team
        </label>
        <select
          id="team-switcher"
          className="cfc-select"
          value={selectedTeam}
          disabled
          aria-label="Team selection is locked. Use Leave Draft Room to switch teams."
          aria-describedby="team-switcher-helper"
        >
          <option value="">— Choose Team —</option>
          {teams.map((team) => (
            <option key={team.id} value={toId(team.id)}>
              {team.name}
            </option>
          ))}
        </select>
        <p
          id="team-switcher-helper"
          className="mt-1 text-[10px]"
          style={{ color: "var(--cfc-muted)" }}
        >
          Leave the draft room to switch teams.
        </p>
      </div>
      {errorMessage && (
        <p className="cfc-toast cfc-toast-error mb-3" style={{ display: "block" }}>
          {errorMessage}
        </p>
      )}

      <div className="flex-1 overflow-y-auto space-y-5 pr-1">
        <div>
          <div className="cfc-section">
            <span className="cfc-section-tag">Starting Lineup</span>
            <span className="cfc-section-line" />
          </div>
          <div className="space-y-2">
            {visibleLineupSlots.length ? (
              visibleLineupSlots.map(({ slot }, idx) => {
                const playerId = resolvedLineup[idx];
                const { name, meta } = playerLabel(playerId, playerDictionary);
                const droppableClasses = draggedBenchPlayer ? DROPPABLE_BORDER_CLASS : "";
                const slotAriaLabel = draggedBenchPlayer
                  ? `Starting slot ${slot}${playerId ? `: ${name}` : ": Empty"}. Drop a bench player here.`
                  : `Starting slot ${slot}${playerId ? `: ${name}` : ": Empty"}.`;
                const slotMeta = playerId
                  ? meta || "Sleeper player"
                  : draggedBenchPlayer
                    ? "Drag or press Enter with a bench player to place here"
                    : "No player assigned";
                return (
                  <div
                    key={`${slot}-${idx}`}
                    tabIndex={0}
                    className={`cfc-player-card flex items-center justify-between px-3 py-2 ${droppableClasses}`}
                    aria-label={slotAriaLabel}
                    onDragOver={(e) => onSlotDragOver(e)}
                    onDrop={(e) => onSlotDrop(e, idx)}
                    onKeyDown={(e) => onSlotKeyDown(e, idx)}
                  >
                    <span className="cfc-pos cfc-pos-flex" style={{ fontSize: 10 }}>
                      {slot}
                    </span>
                    <div className="text-right min-w-0">
                      <div className="text-sm font-semibold text-[var(--cfc-ink)] truncate">
                        {playerId ? name : "Empty"}
                      </div>
                      <div className="text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                        {slotMeta}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>
                Roster positions unavailable.
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="cfc-section">
            <span
              className="cfc-section-tag"
              style={{ background: "var(--cfc-muted)", color: "#fff" }}
            >
              Bench
            </span>
            <span className="cfc-section-line" />
          </div>
          {benchPlayers.length ? (
            <div className="space-y-2">
              {benchPlayers.map((playerId) => {
                const { name, meta } = playerLabel(playerId, playerDictionary);
                return (
                  <div key={playerId} className="cfc-player-card-bench px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--cfc-ink)] truncate">
                          {name}
                        </div>
                        <div className="text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                          {meta || "Bench"}
                        </div>
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        className="cfc-chip cfc-chip-interactive"
                        draggable
                        aria-label={`Drag ${name} to a starting slot`}
                        onDragStart={(e) => onBenchDragStart(e, playerId)}
                        onDragEnd={onBenchDragEnd}
                        onKeyDown={(e) => onBenchKeyDown(e, playerId)}
                      >
                        Drag
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>
              No bench players.
            </p>
          )}
        </div>

        <div>
          <div className="cfc-section">
            <span className="cfc-section-tag cfc-section-tag-blue">Draft Picks</span>
            <span className="cfc-section-line" />
          </div>
          {draftOrderAvailable === false ? (
            <p
              className="mb-2 text-xs cfc-toast cfc-toast-warning"
              style={{ display: "block" }}
            >
              {DRAFT_ORDER_UNAVAILABLE_MESSAGE}
            </p>
          ) : null}
          {activeRosterDraftPicks?.length ? (
            <ul className="space-y-2">
              {activeRosterDraftPicks.map((pick, idx) => (
                <li
                  key={`${pick.season}-${pick.round}-${idx}`}
                  className="cfc-player-card px-3 py-2 text-sm cfc-mono text-[var(--cfc-ink)]"
                >
                  {draftPickText(pick)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>
              No draft picks found.
            </p>
          )}
        </div>

        <div>
          <div className="cfc-section">
            <span className="cfc-section-tag cfc-section-tag-yellow">Drafted Players</span>
            <span className="cfc-section-line" />
          </div>
          {draftedPlayersForTeam.length ? (
            <div className="space-y-3">
              {draftedPlayersForTeam.map((player) => (
                <div
                  key={`${player.id}-${player.name}`}
                  className="cfc-player-card px-3 py-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--cfc-ink)] truncate">
                        {player.name}
                      </div>
                      <div className="text-[10px]" style={{ color: "var(--cfc-muted)" }}>
                        {[player.positions.join("/"), player.team]
                          .filter(Boolean)
                          .join(" • ") || "Drafted player"}
                      </div>
                    </div>
                  </div>

                  {visibleLineupSlots.length ? (
                    <div className="flex items-center gap-2">
                      <select
                        className="cfc-select"
                        style={{ flex: 1, fontSize: 12, padding: "5px 8px" }}
                        value={slotSelections[player.id] || ""}
                        onChange={(e) => onSlotSelectionChange(player.id, e.target.value)}
                      >
                        <option value="">Move to slot…</option>
                        {visibleLineupSlots.map(({ slot }, idx) => (
                          <option key={`${slot}-${idx}`} value={String(idx)}>
                            {slot}
                          </option>
                        ))}
                      </select>
                      <button
                        className="cfc-btn cfc-btn-primary cfc-btn-sm"
                        disabled={!slotSelections[player.id]}
                        onClick={() => {
                          const selectionValue = slotSelections[player.id];
                          if (!selectionValue) return;
                          const slotIndex = Number(selectionValue);
                          if (
                            !Number.isNaN(slotIndex) &&
                            slotIndex >= 0 &&
                            slotIndex < visibleLineupSlots.length
                          ) {
                            onMoveDraftedPlayerToSlot(player, slotIndex);
                          }
                        }}
                      >
                        Move
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--cfc-muted)" }}>
              Drafted players will appear here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
