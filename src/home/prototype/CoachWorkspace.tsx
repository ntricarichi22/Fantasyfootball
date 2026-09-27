"use client";
import { useState } from "react";
import { ArrowRight, LockKeyhole, GripVertical, X } from "lucide-react";
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
  rank,
  selected,
  onSelect,
  onDrag,
}: {
  player: Player;
  rank?: number;
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
      {rank !== undefined && (
        <span className={s.subNumber}>{String(rank).padStart(2, "0")}</span>
      )}
      <span className={s.playerIdentity}>
        <Portrait id={player.id} name={player.name} />
        <span>
          <strong>{player.name}</strong>
          <small>
            <b>{player.position}</b> {player.team} · {player.game}{" "}
            {player.opponent.replace("vs ", "vs. ")}
          </small>
        </span>
      </span>
      {(injured || player.condition) && (
        <span className={s.condition}>
          {injured ? "OUT" : player.condition}
        </span>
      )}
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
  const plans = replacements(demo.players, sampleInjuries, demo.now);
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
  const card = (p: Player, destination?: string, rank?: number) => (
    <FootballPlayer
      key={p.id}
      player={p}
      rank={rank}
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
        style={{ "--roster-count": lineupSlots.length } as React.CSSProperties}
      >
        <section
          className={s.lineupColumn}
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
                {p
                  ? card(p, destination, i + 1)
                  : empty(
                      destination,
                      String(i + 1).padStart(2, "0") + " · Add Sub",
                    )}
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
      {plans.length > 0 && (
        <div className={s.substitutionStrip}>
          {plans.map((plan) => (
            <span key={plan.starter.id}>
              <b>{plan.starter.name.split(" ").at(-1)}</b>
              <ArrowRight size={13} />
              {plan.backup?.name ?? "No eligible Sub"}
              <small>
                {plan.provisional ? "Provisional" : "Locked"} ·{" "}
                {plan.injury.clock}
              </small>
            </span>
          ))}
        </div>
      )}
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
function MatchIdentity({ p, now }: { p: Player; now: number }) {
  const game = sampleGame(p, now);
  const stat =
    p.position === "QB"
      ? game.final
        ? "286 pass yds · 2 TD"
        : "124 pass yds · 1 TD"
      : p.position === "RB"
        ? game.final
          ? "84 rush yds · 3 rec"
          : "32 rush yds · 1 rec"
        : game.final
          ? "6 rec · 81 yds"
          : "2 rec · 24 yds";
  return (
    <span className={s.matchIdentity}>
      <span className={s.matchName}>
        <strong>{p.name}</strong>
        <small>
          {p.position} · {p.team}
        </small>
      </span>
      <span className={s.matchGame}>
        <b data-live={game.started && !game.final}>
          {game.label} {p.opponent.replace("vs ", "vs. ")}
        </b>
        {game.started && <small>{stat}</small>}
      </span>
    </span>
  );
}
function ScoreMeter({
  actual,
  live,
  baseline,
  reference,
}: {
  actual: number;
  live: number;
  baseline: number;
  reference: string;
}) {
  const ratio = baseline > 0 ? actual / baseline : 0;
  return (
    <span
      className={s.scoreMeter}
      title={
        "Pregame projection: " +
        baseline.toFixed(1) +
        " · " +
        Math.round(ratio * 100) +
        "% reached"
      }
    >
      <span className={s.scoreNumbers}>
        <span>
          <b>{actual.toFixed(1)}</b>
          <small>ACTUAL</small>
        </span>
        <i>/</i>
        <span>
          <b>{(reference === "Pregame" ? baseline : live).toFixed(1)}</b>
          <small>{reference === "Pregame" ? "PRE PROJ" : "LIVE PROJ"}</small>
        </span>
      </span>
      <span className={s.scoreProgress}>
        <i
          style={{ width: Math.min(100, Math.max(0, ratio * 100)) + "%" }}
          data-exceeded={ratio > 1}
        />
      </span>
    </span>
  );
}
export function Matchup({ onLineup }: { onLineup: () => void }) {
  const demo = useDemo(),
    [showScoring, setShowScoring] = useState(false);
  const [projectionReference, setProjectionReference] = useState("Live");
  const plans = replacements(demo.players, sampleInjuries, demo.now);
  function score(p: Player) {
    const plan = plans.find((x) => x.starter.id === p.id);
    if (!plan) return sampleGame(p, demo.now);
    const backup = plan.backup
      ? sampleGame(plan.backup, demo.now, plan.injury.cutoff)
      : { points: 0, remaining: 0 };
    return {
      points: plan.injury.starterPoints + backup.points,
      remaining: backup.remaining,
    };
  }
  const total = demo.players
    .filter((p) => p.group === "Starters")
    .reduce(
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
  const probability = sampleWinProbability(
    total.points,
    total.remaining,
    opponent.points,
    opponent.remaining,
  );
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
          <button className={s.editLineupButton} onClick={onLineup}>
            Edit lineup <ArrowRight size={13} />
          </button>
        </div>
        <strong>
          {total.points.toFixed(1)}
          <small>{(total.points + total.remaining).toFixed(1)} PROJ</small>
        </strong>
        <span>VS</span>
        <strong>
          {opponent.points.toFixed(1)}
          <small>
            {(opponent.points + opponent.remaining).toFixed(1)} PROJ
          </small>
        </strong>
        <div>
          <h3>
            Wingmen <small>(2–1)</small>
          </h3>
        </div>
        <Crest crest="wingmen" name="Wingmen" size={58} />
      </div>
      <div
        className={s.probabilityTrack}
        aria-label={"Sample win probability: " + probability + " percent"}
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
      <div className={s.matchupLineups}>
        {lineupSlots.map((slot, i) => {
          const p = demo.players.find(
              (p) => p.group === "Starters" && p.slot === slot.id,
            ),
            plan = plans.find((x) => x.starter.id === p?.id),
            other = opposingPlayers[i % opposingPlayers.length];
          return (
            <div className={s.matchupRow} key={slot.id}>
              <button
                className={s.matchPlayer}
                onClick={() => (p ? demo.openPlayer(p.id) : onLineup())}
              >
                {plan ? (
                  <span className={s.subPair}>
                    <span>
                      <strong>{p?.name}</strong>
                      <small>
                        <b className={s.condition}>INJURED</b>{" "}
                        {plan.injury.starterPoints.toFixed(1)} pts ·{" "}
                        {plan.injury.clock}
                      </small>
                    </span>
                    <span className={s.subArrow}>
                      <small>SUB</small>
                      <ArrowRight size={21} />
                    </span>
                    <span>
                      <strong>{plan.backup?.name ?? "Uncovered"}</strong>
                      <small>
                        {plan.backup
                          ? sampleGame(
                              plan.backup,
                              demo.now,
                              plan.injury.cutoff,
                            ).points.toFixed(1) + " pts"
                          : "No eligible Sub"}{" "}
                        · {plan.provisional ? "Provisional" : "Locked"}
                      </small>
                    </span>
                  </span>
                ) : p ? (
                  <>
                    <Portrait id={p.id} name={p.name} />
                    <MatchIdentity p={p} now={demo.now} />
                  </>
                ) : (
                  <strong>Open starting spot</strong>
                )}
              </button>
              {p ? (
                <ScoreMeter
                  reference={projectionReference}
                  actual={score(p).points}
                  live={score(p).points + score(p).remaining}
                  baseline={p.points}
                />
              ) : (
                <span>—</span>
              )}
              <span className={s.matchupSlot}>{slot.label}</span>
              <ScoreMeter
                reference={projectionReference}
                actual={sampleGame(other, demo.now).points}
                live={
                  sampleGame(other, demo.now).points +
                  sampleGame(other, demo.now).remaining
                }
                baseline={other.points}
              />
              <MatchIdentity p={other} now={demo.now} />
            </div>
          );
        })}
      </div>
      <div className={s.matchupFooter}>
        <div className={s.projectionChoice}>
          <span>Compare actual /</span>
          <Tabs
            label="Projection reference"
            options={["Live", "Pregame"]}
            value={projectionReference}
            onChange={setProjectionReference}
          />
          <small>Bar tracks pregame target</small>
        </div>
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
              {p.provisional ? "Assignment remains provisional." : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
