"use client";
import { useState } from "react";
import {
  ArrowRight,
  LockKeyhole,
  GripVertical,
  HeartPulse,
  Trophy,
  X,
} from "lucide-react";
import { useDemo } from "./DemoState";
import { lineupSlots, subLimit, demoLeague } from "./leagueFixture";
import {
  isLocked,
  movePlayer,
  replacements,
  sampleInjuries,
  sampleGame,
  sampleWinProbability,
} from "./coaching";
import type { Player } from "./model";
import { Crest, Portrait, SectionLabel, Tabs } from "./UI";
import s from "./Prototype.module.css";
function PlayerCondition({ condition }: { condition?: string }) {
  return condition ? (
    <span className={s.medicalChip} aria-label={"Injury status: " + condition}>
      <HeartPulse size={11} />
      {condition}
    </span>
  ) : null;
}
export function ScenarioControl() {
  const demo = useDemo();
  return (
    <label className={s.scenario}>
      SAMPLE GAME STATE
      <select
        aria-label="Sample game state"
        value={demo.now}
        onChange={(e) => demo.scenario(Number(e.target.value))}
      >
        <option value={-1}>Pregame · unlocked</option>
        <option value={2}>Thursday · injury</option>
        <option value={41}>Sunday · early kickoff</option>
        <option value={50}>Sunday night · injury</option>
        <option value={72}>Final · locked bench</option>
      </select>
    </label>
  );
}
function FootballPlayer({
  player,
  selected,
  onSelect,
  onDrag,
}: {
  player: Player;
  selected: boolean;
  onSelect: () => void;
  onDrag: (id: string) => void;
}) {
  const demo = useDemo(),
    locked = isLocked(player, demo.now);
  const injured = sampleInjuries.some(
    (i) => i.playerId === player.id && i.occurred <= demo.now,
  );
  return (
    <button
      className={[
        s.footballPlayer,
        selected ? s.playerSelected : "",
        locked ? s.locked : "",
      ].join(" ")}
      draggable={!locked}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/player", player.id);
        onDrag(player.id);
      }}
      onDragEnd={() => onDrag("")}
      onClick={onSelect}
      data-player-id={player.id}
      aria-pressed={selected}
      aria-label={
        "Select " + player.name + (locked ? ", locked at kickoff" : " to move")
      }
    >
      <span className={s.playerIdentity}>
        <Portrait id={player.id} name={player.name} />
        <span>
          <strong className={s.playerNameLine}>
            {player.name}
            <PlayerCondition condition={injured ? "OUT" : player.condition} />
          </strong>
          <small>
            <b>{player.position}</b> {player.team} · {player.game}{" "}
            {player.opponent.replace("vs ", "vs. ")}
          </small>
        </span>
      </span>
      <span className={s.projection}>
        {player.points.toFixed(1)}
        <small>PROJ</small>
      </span>
      <span className={s.moveIndicator}>
        {locked ? <LockKeyhole size={13} /> : <GripVertical size={13} />}
      </span>
    </button>
  );
}
export function Lineup() {
  const demo = useDemo();
  const [moving, setMoving] = useState("");
  const [dragging, setDragging] = useState("");
  const [mobileSection, setMobileSection] = useState("Starters");
  const active = demo.players.find((p) => p.id === (dragging || moving));
  const ir = demo.players.filter((p) => p.group === "IR"),
    ps = demo.players.filter((p) => p.group === "Practice Squad");
  const legal = (destination: string) =>
    !!active &&
    !movePlayer(demo.players, active.id, destination, demo.now).error &&
    !(destination === active.slot || destination === "SUB:" + active.rank);
  function select(p: Player, destination?: string) {
    if (active && active.id !== p.id && destination) {
      if (legal(destination)) {
        demo.move(active.id, destination);
        setMoving("");
        setDragging("");
      } else
        demo.notify(
          "That destination is locked or ineligible. Choose a highlighted slot.",
        );
      return;
    }
    if (isLocked(p, demo.now)) {
      demo.notify(p.name + " is locked at kickoff (" + p.game + ").");
      return;
    }
    setMoving(moving === p.id ? "" : p.id);
  }
  function target(destination: string) {
    return {
      className: legal(destination) ? s.eligibleTarget : "",
      onDragOver: (e: React.DragEvent) => {
        if (legal(destination)) e.preventDefault();
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.dataTransfer.getData("text/player");
        if (id) demo.move(id, destination);
        setDragging("");
        setMoving("");
      },
    };
  }
  function empty(destination: string, label: string) {
    return (
      <button
        className={s.emptyRosterSlot}
        onClick={() => {
          if (active && legal(destination)) {
            demo.move(active.id, destination);
            setMoving("");
          } else
            demo.notify(
              "Select a player first, then choose a highlighted slot.",
            );
        }}
      >
        {label}
        <small>
          {active && legal(destination) ? "Move here" : "Open spot"}
        </small>
      </button>
    );
  }
  const card = (p: Player, destination?: string) => (
    <FootballPlayer
      key={p.id}
      player={p}
      selected={p.id === moving}
      onDrag={setDragging}
      onSelect={() => select(p, destination)}
    />
  );
  return (
    <div className={s.lineupView}>
      <div className={s.workspaceTools}>
        <span className={s.lineupInstruction}>
          {active ? (
            <>
              <b>{active.name}</b> · Choose a highlighted slot{" "}
              <button
                aria-label="Cancel player move"
                onClick={() => setMoving("")}
              >
                <X size={14} />
              </button>
            </>
          ) : (
            "Click or drag a player to move · Locks at kickoff"
          )}
        </span>
        <ScenarioControl />
      </div>
      <div className={s.mobileSections}>
        <Tabs
          label="Lineup section"
          options={["Starters", "Subs", "Reserves"]}
          value={mobileSection}
          onChange={setMobileSection}
        />
      </div>
      <div
        className={s.lineupGrid}
        style={
          {
            "--roster-count": lineupSlots.length,
            "--reserve-count": demoLeague.practiceSquadLimit,
          } as React.CSSProperties
        }
      >
        <section
          className={s.lineupColumn}
          data-roster-group="starters"
          data-mobile-visible={mobileSection === "Starters"}
        >
          <SectionLabel title="Starters">
            <span>
              {demo.players.filter((p) => p.group === "Starters").length}/
              {lineupSlots.length}
            </span>
          </SectionLabel>
          {lineupSlots.map((slot) => {
            const p = demo.players.find(
              (p) => p.slot === slot.id && p.group === "Starters",
            );
            const props = target(slot.id);
            return (
              <div
                key={slot.id}
                {...props}
                className={s.starterSlot + " " + props.className}
              >
                <span className={s.slotLabel}>{slot.label}</span>
                {p ? card(p, slot.id) : empty(slot.id, "+ Add starter")}
              </div>
            );
          })}
        </section>
        <section
          className={s.lineupColumn}
          data-roster-group="subs"
          data-mobile-visible={mobileSection === "Subs"}
        >
          <SectionLabel title="Subs">
            <button className={s.rankReset} onClick={demo.autoRank}>
              Rank by projections
            </button>
            <span>
              {demo.players.filter((p) => p.group === "Subs").length}/{subLimit}
            </span>
          </SectionLabel>
          {Array.from({ length: subLimit }, (_, i) => {
            const p = demo.players.find(
              (p) => p.group === "Subs" && p.rank === i + 1,
            );
            const destination = "SUB:" + (i + 1),
              props = target(destination);
            return (
              <div
                key={i}
                {...props}
                className={s.subDrop + " " + props.className}
              >
                <span className={s.subNumber}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                {p ? card(p, destination) : empty(destination, "+ Add Sub")}
              </div>
            );
          })}
        </section>
        <section
          className={s.reserveColumn}
          data-mobile-visible={mobileSection === "Reserves"}
        >
          <div className={s.irSection}>
            <SectionLabel title="IR">
              <span>{ir.length} · No limit</span>
            </SectionLabel>
            <div className={s.irPlayers}>
              {ir.map((p) => card(p))}
              {!ir.length && (
                <span className={s.irEmpty}>No players on IR</span>
              )}
              {active && active.group !== "IR" && legal("IR") && (
                <div {...target("IR")}>{empty("IR", "+ Move to IR")}</div>
              )}
            </div>
          </div>
          <div className={s.practiceSection}>
            <SectionLabel title="Practice Squad">
              <span>
                {ps.length}/{demoLeague.practiceSquadLimit}
              </span>
            </SectionLabel>
            {Array.from({ length: demoLeague.practiceSquadLimit }, (_, i) => (
              <div key={i} {...(!ps[i] ? target("Practice Squad") : {})}>
                {ps[i]
                  ? card(ps[i])
                  : empty("Practice Squad", "+ Add prospect")}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
const opposingPlayers: Player[] = [
  ["Lamar Jackson", "QB", "BAL", 24],
  ["Jared Goff", "QB", "DET", 20],
  ["Jonathan Taylor", "RB", "IND", 17],
  ["CeeDee Lamb", "WR", "DAL", 19.7],
  ["A.J. Brown", "WR", "PHI", 15.1],
  ["Kyren Williams", "RB", "LAR", 14],
  ["DeVonta Smith", "WR", "PHI", 10.1],
  ["Sam LaPorta", "TE", "DET", 9.2],
  ["George Kittle", "TE", "SF", 10.3],
].map(([name, position, team, points], i) => ({
  id: "opponent-" + i,
  name: String(name),
  position: String(position),
  team: String(team),
  points: Number(points),
  opponent: ["vs BUF", "@ GB", "vs PIT"][i % 3],
  game: i % 3 === 0 ? "SUN 1:00" : i % 3 === 1 ? "SUN 4:05" : "MON 8:15",
  kickoff: i % 3 === 0 ? 40 : i % 3 === 1 ? 44 : 68,
  age: 27,
  bye: 8,
  group: "Starters",
  availability: "Listening",
  asking: "",
}));
function MatchIdentity({
  p,
  now,
  injured = false,
}: {
  p: Player;
  now: number;
  injured?: boolean;
}) {
  const game = sampleGame(p, now);
  const opponent = p.opponent.replace("vs ", "vs. ");
  const context = !game.started
    ? `${p.game} · ${opponent}`
    : game.final
      ? `FINAL · ${opponent}`
      : `${opponent} · ${game.label.replace(" · ", " ")}`;
  return (
    <span className={s.matchIdentity}>
      <span className={s.matchName}>
        <strong className={s.playerNameLine}>
          {p.name}
          <PlayerCondition condition={injured ? "OUT" : p.condition} />
        </strong>
        <small>
          {p.position} · {p.team}
        </small>
      </span>
      <span className={s.matchGame} data-live={game.started && !game.final}>
        {context}
      </span>
    </span>
  );
}
function MatchScore({
  actual,
  live,
  baseline,
  final,
  label,
  expanded,
  onToggle,
}: {
  actual: number;
  live: number;
  baseline: number;
  final: boolean;
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const delta = Math.round((actual - baseline) * 10) / 10;
  return (
    <span className={s.matchScore}>
      <strong>{actual.toFixed(1)}</strong>
      {final ? (
        <button
          className={s.scoreComparison}
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`Show pregame comparison for ${label}`}
        >
          <b data-direction={delta > 0 ? "up" : delta < 0 ? "down" : "even"}>
            {delta > 0 ? "+" : delta < 0 ? "−" : ""}
            {Math.abs(delta).toFixed(1)}
          </b>{" "}
          vs. pregame
        </button>
      ) : (
        <small>
          Proj. <b>{live.toFixed(1)}</b>
        </small>
      )}
      {final && expanded && (
        <span className={s.scoreBaseline} role="status">
          Pregame {baseline.toFixed(1)} → Final {actual.toFixed(1)}
        </span>
      )}
    </span>
  );
}
export function Matchup({ onLineup }: { onLineup: () => void }) {
  const demo = useDemo();
  const [showScoring, setShowScoring] = useState(false);
  const [expandedScore, setExpandedScore] = useState("");
  const plans = replacements(demo.players, sampleInjuries, demo.now);
  function score(p: Player) {
    const game = sampleGame(p, demo.now);
    const plan = plans.find((x) => x.starter.id === p.id);
    if (!plan) return game;
    const backup = plan.backup
      ? sampleGame(plan.backup, demo.now, plan.injury.cutoff)
      : { points: 0, remaining: 0, final: true };
    return {
      points: plan.injury.starterPoints + backup.points,
      remaining: backup.remaining,
      final:
        game.final && backup.final && (!plan.provisional || demo.now >= 72),
    };
  }
  const starters = demo.players.filter((p) => p.group === "Starters");
  const total = starters.reduce(
    (n, p) => ({
      points: n.points + score(p).points,
      remaining: n.remaining + score(p).remaining,
    }),
    { points: 0, remaining: 0 },
  );
  const opponent = opposingPlayers.reduce(
    (n, p) => {
      const g = sampleGame(p, demo.now);
      return {
        points: n.points + g.points,
        remaining: n.remaining + g.remaining,
      };
    },
    { points: 0, remaining: 0 },
  );
  const weekFinal = demo.now >= 72;
  const probability = sampleWinProbability(
    total.points,
    total.remaining,
    opponent.points,
    opponent.remaining,
  );
  const won = total.points > opponent.points;
  const tied = total.points === opponent.points;
  return (
    <div className={s.matchupView}>
      <div className={s.scoreHero}>
        <Crest
          crest={demo.identity.crest}
          name={demo.identity.name}
          size={58}
        />
        <div className={s.matchTeamTitle}>
          <h3>
            {demo.identity.name} <small>(3–0)</small>
          </h3>
          {!weekFinal && (
            <button className={s.editLineupButton} onClick={onLineup}>
              Edit lineup <ArrowRight size={13} />
            </button>
          )}
        </div>
        <strong data-winner={weekFinal && won}>
          {total.points.toFixed(1)}
          {!weekFinal && (
            <small>{(total.points + total.remaining).toFixed(1)} PROJ</small>
          )}
        </strong>
        <span>VS</span>
        <strong data-winner={weekFinal && !won && !tied}>
          {opponent.points.toFixed(1)}
          {!weekFinal && (
            <small>
              {(opponent.points + opponent.remaining).toFixed(1)} PROJ
            </small>
          )}
        </strong>
        <div>
          <h3>
            Wingmen <small>(2–1)</small>
          </h3>
        </div>
        <Crest crest="wingmen" name="Wingmen" size={58} />
      </div>
      {weekFinal ? (
        <div
          className={s.matchResult}
          data-result={tied ? "tie" : won ? "win" : "loss"}
          role="status"
        >
          <Trophy size={23} />
          <strong>
            {tied
              ? "MATCHUP TIED"
              : `${won ? demo.identity.name : "Wingmen"} WIN`}
          </strong>
          <span>
            FINAL
            {!tied &&
              ` · ${Math.abs(total.points - opponent.points).toFixed(1)} point margin`}
          </span>
        </div>
      ) : (
        <div
          className={s.probabilityTrack}
          aria-label={`Sample win probability: ${probability} percent`}
        >
          <span
            className={s.probabilityFill}
            style={{ width: probability + "%" }}
          />
          <span
            className={s.probabilityMarker}
            style={{ left: probability + "%" }}
            data-edge={probability > 72}
          >
            <b>{probability}%</b> Win Probability
          </span>
        </div>
      )}
      <div className={s.matchupLineups}>
        {lineupSlots.map((slot, i) => {
          const p = starters.find((p) => p.slot === slot.id);
          const plan = plans.find((x) => x.starter.id === p?.id);
          const other = opposingPlayers[i % opposingPlayers.length];
          const otherScore = sampleGame(other, demo.now);
          const ownScore = p ? score(p) : null;
          return (
            <div
              className={s.matchupRow}
              key={slot.id}
              data-substitution={!!plan}
            >
              <div className={s.matchHalf}>
                <div className={s.matchMain}>
                  {plan && p ? (
                    <div className={s.injuryPair}>
                      <button
                        className={s.injuryPlayer}
                        onClick={() => demo.openPlayer(p.id)}
                      >
                        <Portrait id={p.id} name={p.name} />
                        <span>
                          <strong className={s.playerNameLine}>
                            {p.name}
                            <PlayerCondition condition="OUT" />
                          </strong>
                          <small>
                            {p.position} · {p.team} ·{" "}
                            {plan.injury.starterPoints.toFixed(1)} counted
                          </small>
                        </span>
                      </button>
                      <ArrowRight size={14} />
                      {plan.backup ? (
                        <button
                          className={s.injuryPlayer}
                          onClick={() => demo.openPlayer(plan.backup!.id)}
                        >
                          <Portrait
                            id={plan.backup.id}
                            name={plan.backup.name}
                          />
                          <span>
                            <strong>{plan.backup.name}</strong>
                            <small>
                              {plan.backup.position} · {plan.backup.team}
                            </small>
                          </span>
                          <span className={s.backupClock}>
                            {sampleGame(plan.backup, demo.now).label.replace(
                              " · ",
                              " ",
                            )}
                          </span>
                        </button>
                      ) : (
                        <span className={s.noSub}>No eligible Sub</span>
                      )}
                    </div>
                  ) : (
                    <button
                      className={s.matchPlayer}
                      onClick={() =>
                        p ? demo.openPlayer(p.id) : !weekFinal && onLineup()
                      }
                      disabled={!p && weekFinal}
                    >
                      {p ? (
                        <>
                          <Portrait id={p.id} name={p.name} />
                          <MatchIdentity p={p} now={demo.now} />
                        </>
                      ) : (
                        <strong>Open starting spot</strong>
                      )}
                    </button>
                  )}
                  {p && ownScore ? (
                    <MatchScore
                      actual={ownScore.points}
                      live={ownScore.points + ownScore.remaining}
                      baseline={p.points}
                      final={ownScore.final}
                      expanded={expandedScore === p.id}
                      onToggle={() =>
                        setExpandedScore(expandedScore === p.id ? "" : p.id)
                      }
                      label={p.name + (plan ? " and substitution" : "")}
                    />
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>
              <span className={s.matchupSlot}>{slot.label}</span>
              <div className={[s.matchHalf, s.opponentHalf].join(" ")}>
                <div className={s.matchMain}>
                  <div className={s.matchPlayer}>
                    <Portrait id={other.id} name={other.name} />
                    <MatchIdentity p={other} now={demo.now} />
                  </div>
                  <MatchScore
                    actual={otherScore.points}
                    live={otherScore.points + otherScore.remaining}
                    baseline={other.points}
                    final={otherScore.final}
                    expanded={expandedScore === other.id}
                    onToggle={() =>
                      setExpandedScore(
                        expandedScore === other.id ? "" : other.id,
                      )
                    }
                    label={other.name}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className={s.matchupFooter}>
        {plans.length > 0 ? (
          <button
            onClick={() => setShowScoring(!showScoring)}
            aria-expanded={showScoring}
          >
            {plans.length} injury substitutions ·{" "}
            {showScoring ? "Hide" : "View"} breakdown
          </button>
        ) : (
          <span />
        )}
        <ScenarioControl />
      </div>
      {showScoring && (
        <div className={s.scoreExplanation}>
          <button
            className={s.closeScoreExplanation}
            aria-label="Close scoring breakdown"
            onClick={() => setShowScoring(false)}
          >
            <X size={16} />
          </button>
          {plans.map((p) => (
            <p key={p.starter.id}>
              <b>
                {p.starter.name}: {p.injury.starterPoints.toFixed(1)}
              </b>{" "}
              through {p.injury.clock} +{" "}
              <b>
                {p.backup
                  ? sampleGame(
                      p.backup,
                      demo.now,
                      p.injury.cutoff,
                    ).points.toFixed(1)
                  : "0.0"}
              </b>{" "}
              counted from {p.backup?.name ?? "no Sub"} after the same
              game-clock cutoff.{" "}
              {p.provisional ? "Assignment remains provisional." : ""} The row’s
              score includes both players; its pregame baseline is the original
              starter’s projection.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
