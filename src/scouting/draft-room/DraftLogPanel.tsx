import type { DraftLogEntry } from "@/scouting/draft-room/types";
import { PositionBadge } from "./PositionBadge";

type Props = {
  draftLog: DraftLogEntry[];
  isCommissionerSelected: boolean;
  onUndoPick: (entry: DraftLogEntry) => void;
};

export function DraftLogPanel({ draftLog, isCommissionerSelected, onUndoPick }: Props) {
  return (
    <div className="w-1/4 min-w-[260px] flex flex-col">
      <div className="cfc-card flex-1 p-4 flex flex-col overflow-hidden">
        <div className="cfc-section">
          <span className="cfc-section-tag cfc-section-tag-ink">Draft Log</span>
          <span className="cfc-section-line" />
        </div>
        {draftLog.length ? (
          <div className="mt-1 flex-1 overflow-y-auto pr-1">
            {draftLog.map((entry) => {
              const positionLabel = (entry.positions || []).join("/");
              const firstPos = (entry.positions || [])[0]?.toUpperCase() || "";
              return (
                <div
                  key={entry.pickIndex}
                  className="group flex items-center gap-2 px-1 py-2 text-sm border-b"
                  style={{ borderColor: "var(--cfc-muted-border)" }}
                >
                  <span
                    className="cfc-mono w-12 shrink-0 text-xs font-bold"
                    style={{ color: "var(--cfc-muted)" }}
                  >
                    {entry.pickNumber}
                  </span>
                  <span className="text-xs font-semibold text-[var(--cfc-ink)] truncate w-20 shrink-0">
                    {entry.teamName}
                  </span>
                  <span className="flex-1 truncate text-[var(--cfc-ink)]">
                    {entry.playerName}
                  </span>
                  <PositionBadge
                    position={firstPos}
                    label={positionLabel || "—"}
                    style={{ fontSize: 9 }}
                  />
                  {isCommissionerSelected ? (
                    <button
                      type="button"
                      className="ml-1 shrink-0 px-2 text-xs opacity-0 transition group-hover:opacity-100"
                      style={{ color: "var(--cfc-red)", fontWeight: 700 }}
                      aria-label={`Undo pick ${entry.pickNumber}`}
                      onClick={() => onUndoPick(entry)}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--cfc-muted)" }}>
            No picks have been made yet.
          </p>
        )}
      </div>
    </div>
  );
}
