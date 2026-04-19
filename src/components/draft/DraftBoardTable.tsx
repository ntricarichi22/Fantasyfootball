import type { AvailablePlayer } from "../../lib/draft/types";
import { DraftBoardRow } from "./DraftBoardRow";

type Props = {
  availablePlayers: AvailablePlayer[];
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  onClockRosterId: string;
  isDraftPaused: boolean;
  isCommissionerSelected: boolean;
  selectedTeam: string;
  onPlayerSelect: (player: AvailablePlayer) => void;
};

export function DraftBoardTable({
  availablePlayers,
  searchTerm,
  onSearchTermChange,
  onClockRosterId,
  isDraftPaused,
  isCommissionerSelected,
  selectedTeam,
  onPlayerSelect,
}: Props) {
  const selectDisabled =
    isDraftPaused ||
    !onClockRosterId ||
    (!isCommissionerSelected && selectedTeam !== onClockRosterId);

  return (
    <div className="flex-1 flex flex-col gap-4 overflow-hidden">
      <div className="cfc-card flex-1 w-full p-4 flex flex-col overflow-hidden">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between mb-3">
          <div>
            <div className="cfc-section" style={{ marginBottom: 6 }}>
              <span className="cfc-section-tag cfc-section-tag-blue">Available</span>
            </div>
            <h3 className="font-headline text-2xl text-[var(--cfc-ink)]">Available Players</h3>
            <p className="text-xs" style={{ color: "var(--cfc-muted)" }}>
              Eligible QB / RB / WR / TE not currently rostered.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="cfc-input"
              style={{ width: 220 }}
              placeholder="Search by name"
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
            />
            {!onClockRosterId ? (
              <span className="cfc-chip cfc-chip-yellow">
                Start the draft to enable selections
              </span>
            ) : null}
            {isDraftPaused ? (
              <span className="cfc-chip cfc-chip-yellow">Draft is paused</span>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-hidden cfc-card-flat" style={{ boxShadow: "none" }}>
          <div className="h-full overflow-y-auto">
            <table className="cfc-table">
              <thead>
                <tr>
                  <th>Player Name</th>
                  <th>Position</th>
                  <th>Team</th>
                  <th>Age</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {availablePlayers.length ? (
                  availablePlayers.map((player) => (
                    <DraftBoardRow
                      key={player.id}
                      player={player}
                      selectDisabled={selectDisabled}
                      onSelect={onPlayerSelect}
                    />
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ textAlign: "center", padding: "24px 12px", color: "var(--cfc-muted)" }}
                    >
                      No available players match the filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
