import type { AvailablePlayer } from "../../lib/draft/types";
import { PositionBadge } from "./PositionBadge";

type Props = {
  player: AvailablePlayer;
  selectDisabled: boolean;
  onSelect: (player: AvailablePlayer) => void;
};

export function DraftBoardRow({ player, selectDisabled, onSelect }: Props) {
  return (
    <tr>
      <td>
        <div className="font-semibold text-[var(--cfc-ink)]">{player.name}</div>
      </td>
      <td>
        <PositionBadge position={player.position} />
      </td>
      <td className="cfc-mono" style={{ color: "var(--cfc-ink)" }}>{player.team}</td>
      <td className="cfc-mono" style={{ color: "var(--cfc-muted)" }}>{player.ageLabel}</td>
      <td style={{ textAlign: "right" }}>
        <button
          className="cfc-btn cfc-btn-primary cfc-btn-sm"
          disabled={selectDisabled}
          onClick={() => onSelect(player)}
        >
          Select
        </button>
      </td>
    </tr>
  );
}
