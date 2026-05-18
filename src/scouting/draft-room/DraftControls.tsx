import type { DraftClockStatus } from "@/scouting/draft-room/draftState";

type Props = {
  isCommissionerSelected: boolean;
  isDraftPaused: boolean;
  draftStatus: DraftClockStatus;
  clockActionPending: boolean;
  teamsCount: number;
  selectedTeam: string;
  onStartDraft: () => void;
  onPauseDraft: () => void;
  onResumeDraft: () => void;
  onLeaveDraftRoom: () => void;
};

export function DraftControls({
  isCommissionerSelected,
  isDraftPaused,
  draftStatus,
  clockActionPending,
  teamsCount,
  selectedTeam,
  onStartDraft,
  onPauseDraft,
  onResumeDraft,
  onLeaveDraftRoom,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {isCommissionerSelected ? (
        <>
          <button
            className="cfc-btn cfc-btn-accent"
            onClick={onStartDraft}
            disabled={
              teamsCount === 0 ||
              draftStatus !== "not_started" ||
              clockActionPending
            }
          >
            Start Draft
          </button>
          <button
            className="cfc-btn cfc-btn-primary"
            onClick={isDraftPaused ? onResumeDraft : onPauseDraft}
            disabled={clockActionPending || draftStatus === "not_started"}
          >
            {isDraftPaused ? "Resume Draft" : "Pause Draft"}
          </button>
        </>
      ) : null}
      <button
        className="cfc-btn cfc-btn-danger"
        onClick={onLeaveDraftRoom}
        disabled={!selectedTeam}
      >
        Leave Draft Room
      </button>
      {isDraftPaused ? (
        <span className="cfc-chip cfc-chip-yellow" style={{ fontSize: 11 }}>
          Draft is paused
        </span>
      ) : null}
    </div>
  );
}
