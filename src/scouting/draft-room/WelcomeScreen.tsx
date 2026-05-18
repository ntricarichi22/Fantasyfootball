import { ACTIVE_TEAM_TIMEOUT_MINUTES } from "@/infrastructure/identity/activeTeams";
import { toId } from "@/scouting/draft-room/helpers";
import type { Team } from "@/scouting/draft-room/types";

type Props = {
  errorMessage: string;
  teamSelectionInput: string;
  availableTeams: Team[];
  claimingTeam: boolean;
  onTeamSelectionChange: (value: string) => void;
  onEnterDraftRoom: () => void;
};

export function WelcomeScreen({
  errorMessage,
  teamSelectionInput,
  availableTeams,
  claimingTeam,
  onTeamSelectionChange,
  onEnterDraftRoom,
}: Props) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-3xl">
        {/* Hero badge */}
        <div className="cfc-section">
          <span className="cfc-section-tag">Live · 2026</span>
          <span className="cfc-section-line" />
          <span
            className="cfc-chip cfc-chip-blue"
            style={{ display: "inline-flex" }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#fff",
                marginRight: 6,
              }}
            />
            12 teams connected
          </span>
        </div>

        {/* Big hero card */}
        <div
          className="cfc-card mb-6"
          style={{ padding: "32px 28px", background: "var(--cfc-card)" }}
        >
          <p
            className="font-headline uppercase"
            style={{
              fontSize: 16,
              letterSpacing: "0.32em",
              color: "var(--cfc-muted)",
              marginBottom: 8,
            }}
          >
            Welcome to the
          </p>
          <h1
            className="font-headline"
            style={{
              fontSize: "clamp(64px, 11vw, 120px)",
              lineHeight: 0.95,
              letterSpacing: "-0.02em",
              color: "var(--cfc-ink)",
              margin: 0,
            }}
          >
            <span className="cfc-mono" style={{ color: "var(--cfc-red)", fontWeight: 800 }}>2026</span>{" "}
            <span style={{ color: "var(--cfc-ink)" }}>CFC</span>{" "}
            <span style={{ color: "var(--cfc-blue)" }}>DRAFT</span>
          </h1>
          <p
            className="font-headline uppercase"
            style={{
              fontSize: 14,
              letterSpacing: "0.28em",
              color: "var(--cfc-ink)",
              marginTop: 12,
            }}
          >
            One round. No mercy.
          </p>
        </div>

        {/* Team select panel */}
        <div className="cfc-card" style={{ padding: 22 }}>
          <div className="cfc-section">
            <span className="cfc-section-tag cfc-section-tag-blue">Choose your squad</span>
            <span className="cfc-section-line" />
          </div>

          {errorMessage && (
            <p
              className="cfc-toast cfc-toast-error mb-3"
              style={{ display: "block" }}
            >
              {errorMessage}
            </p>
          )}

          <div className="space-y-3">
            <select
              className="cfc-select"
              style={{ fontSize: 15, fontWeight: 600 }}
              value={teamSelectionInput}
              onChange={(e) => onTeamSelectionChange(e.target.value)}
            >
              <option value="">— Choose Team —</option>
              {availableTeams.map((team) => (
                <option key={team.id} value={toId(team.id)}>
                  {team.name}
                </option>
              ))}
            </select>

            <button
              className="cfc-btn cfc-btn-accent w-full"
              style={{ fontSize: 15, padding: "12px 16px", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}
              onClick={onEnterDraftRoom}
              disabled={!teamSelectionInput || claimingTeam}
            >
              {claimingTeam ? "Joining…" : "Enter at Your Own Peril"}
            </button>
          </div>

          <p className="mt-4 text-xs" style={{ color: "var(--cfc-muted)" }}>
            Teams are hidden while in use and for {ACTIVE_TEAM_TIMEOUT_MINUTES}{" "}
            {ACTIVE_TEAM_TIMEOUT_MINUTES === 1 ? "minute" : "minutes"} after their last activity.
          </p>
        </div>
      </div>
    </div>
  );
}
