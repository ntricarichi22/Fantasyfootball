"use client";
import { useState, type DragEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Check,
  LockKeyhole,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useDemo } from "./DemoState";
import { lineupSlots, subLimit, demoLeague, type Slot } from "./leagueFixture";
import {
  eligible,
  isLocked,
  replacements,
  sampleInjuries,
  samplePlays,
  subs,
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
  compact = false,
  rank,
  onMove,
  onDrag,
  selected = false,
}: {
  player: Player;
  compact?: boolean;
  rank?: number;
  onMove: (id: string) => void;
  onDrag: (id: string) => void;
  selected?: boolean;
}) {
  const demo = useDemo(),
    locked = isLocked(player, demo.now),
    bench = subs(demo.players),
    index = bench.findIndex((p) => p.id === player.id);
  const injury = sampleInjuries.some(
    (i) => i.playerId === player.id && i.occurred <= demo.now,
  );
  return (
    <div
      className={[
        s.footballPlayer,
        compact ? s.compactPlayer : "",
        selected ? s.playerSelected : "",
        locked ? s.locked : "",
      ].join(" ")}
      draggable={!locked}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/player", player.id);
        onDrag(player.id);
      }}
      onDragEnd={() => onDrag("")}
      data-player-id={player.id}
    >
      {rank !== undefined && (
        <span className={s.subNumber}>{String(rank).padStart(2, "0")}</span>
      )}
      <button
        className={s.playerIdentity}
        onClick={() => demo.openPlayer(player.id)}
        aria-label={"Open " + player.name + " player card"}
      >
        <Portrait id={player.id} name={player.name} />
        <span>
          <strong>{player.name}</strong>
          <small>
            <b>{player.position}</b> {player.team} <i>·</i> {player.opponent}
            {!compact && (
              <>
                <i>·</i>
                {player.game}
              </>
            )}
          </small>
        </span>
      </button>
      {(injury || player.condition) && (
        <span className={s.condition}>{injury ? "OUT" : player.condition}</span>
      )}
      <span className={s.projection}>
        {player.points.toFixed(1)}
        <small>PROJ</small>
      </span>
      {rank !== undefined && !locked && (
        <span className={s.rankButtons}>
          <button
            aria-label={"Move " + player.name + " up"}
            disabled={index <= 0 || isLocked(bench[index - 1], demo.now)}
            onClick={() => demo.reorder(player.id, bench[index - 1].id)}
          >
            <ArrowUp size={12} />
          </button>
          <button
            aria-label={"Move " + player.name + " down"}
            disabled={
              index >= bench.length - 1 || isLocked(bench[index + 1], demo.now)
            }
            onClick={() => demo.reorder(player.id, bench[index + 1].id)}
          >
            <ArrowDown size={12} />
          </button>
        </span>
      )}
      {locked ? (
        <LockKeyhole
          className={s.lockIcon}
          size={13}
          aria-label="Locked at kickoff"
        />
      ) : (
        <button
          className={s.iconButton}
          onClick={() => onMove(player.id)}
          aria-label={"Move " + player.name}
        >
          <MoreHorizontal size={17} />
        </button>
      )}
    </div>
  );
}
export function Lineup() {
  const demo = useDemo();
  const [moving, setMoving] = useState("");
  const [dragging, setDragging] = useState("");
  const [mobileSection, setMobileSection] = useState("Starters");
  const [irPage, setIrPage] = useState(0);
  const bench = subs(demo.players),
    ir = demo.players.filter((p) => p.group === "IR"),
    ps = demo.players.filter((p) => p.group === "Practice Squad");
  const active = demo.players.find((p) => p.id === (dragging || moving));
  const plans = replacements(demo.players, sampleInjuries, demo.now);
  function move(destination: string) {
    if (active && demo.move(active.id, destination)) {
      setMoving("");
      setDragging("");
    }
  }
  function drop(e: DragEvent, destination: string) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/player");
    if (id) demo.move(id, destination);
    setDragging("");
  }
  function subDrop(e: DragEvent, p: Player) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/player");
    const incoming = demo.players.find((x) => x.id === id);
    if (incoming?.group === "Subs") demo.reorder(id, p.id);
    else if (incoming?.slot) demo.move(p.id, incoming.slot);
    else if (incoming) demo.move(id, "Subs");
    setDragging("");
  }
  const playerView = (p: Player, compact = false, rank?: number) => (
    <FootballPlayer
      key={p.id}
      player={p}
      compact={compact}
      rank={rank}
      onMove={setMoving}
      onDrag={setDragging}
      selected={moving === p.id}
    />
  );
  function slotState(slot: Slot) {
    const current = demo.players.find(
      (p) => p.slot === slot.id && p.group === "Starters",
    );
    return (
      active &&
      !isLocked(active, demo.now) &&
      eligible(active, slot) &&
      (!current || !isLocked(current, demo.now))
    );
  }
  return (
    <div className={s.lineupView}>
      <div className={s.workspaceTools}>
        <span className={s.subtle}>
          <span className={s.liveDot} />
          Drag to move · Each player locks at kickoff
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
      <div className={s.lineupGrid}>
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
          <p className={s.columnHint}>Make every starting spot count.</p>
          {lineupSlots.map((slot) => {
            const p = demo.players.find(
              (x) => x.group === "Starters" && x.slot === slot.id,
            );
            return (
              <div
                key={slot.id}
                className={[
                  s.starterSlot,
                  slotState(slot) ? s.eligibleTarget : "",
                ].join(" ")}
                onDragOver={(e) => {
                  if (slotState(slot)) e.preventDefault();
                }}
                onDrop={(e) => drop(e, slot.id)}
              >
                <span className={s.slotLabel}>{slot.label}</span>
                {p ? (
                  playerView(p)
                ) : (
                  <button
                    className={s.emptyStarting}
                    onClick={() => {
                      setMobileSection("Subs");
                      demo.notify(
                        "Select a Sub and use Move, or drag a player into this slot.",
                      );
                    }}
                  >
                    + Add starter
                  </button>
                )}
                {active && slotState(slot) && (
                  <span className={s.swapDelta}>
                    {active.points - (p?.points ?? 0) >= 0 ? "+" : ""}
                    {(active.points - (p?.points ?? 0)).toFixed(1)} PROJ
                  </span>
                )}
              </div>
            );
          })}
        </section>
        <section
          className={s.lineupColumn}
          data-mobile-visible={mobileSection === "Subs"}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (e.target === e.currentTarget) drop(e, "Subs");
          }}
        >
          <SectionLabel title="Subs">
            <span>
              {bench.length}/{subLimit}
            </span>
          </SectionLabel>
          <div className={s.columnHint}>
            <span>Ranked replacement priority</span>
            <button
              onClick={demo.autoRank}
              title="Re-rank unlocked Subs by projections"
              aria-label="Rank Subs by projections"
            >
              Rank by projections
            </button>
          </div>
          {bench.map((p) => (
            <div
              key={p.id}
              className={s.subDrop}
              onDragOver={(e) => {
                if (!isLocked(p, demo.now)) e.preventDefault();
              }}
              onDrop={(e) => subDrop(e, p)}
            >
              {playerView(p, true, p.rank)}
            </div>
          ))}
        </section>
        <section
          className={s.reserveColumn}
          data-mobile-visible={mobileSection === "Reserves"}
        >
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, "IR")}
          >
            <SectionLabel title="IR">
              <span>{ir.length} · No limit</span>
            </SectionLabel>
            {ir
              .slice(irPage * 7, irPage * 7 + 7)
              .map((p) => playerView(p, true))}
            {ir.length > 7 && (
              <div className={s.pagination}>
                <button
                  disabled={irPage === 0}
                  onClick={() => setIrPage(irPage - 1)}
                >
                  Previous
                </button>
                <button
                  disabled={(irPage + 1) * 7 >= ir.length}
                  onClick={() => setIrPage(irPage + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => drop(e, "Practice Squad")}
          >
            <SectionLabel title="Practice Squad">
              <span>
                {ps.length}/{demoLeague.practiceSquadLimit}
              </span>
            </SectionLabel>
            {ps.map((p) => playerView(p, true))}
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
                {plan.provisional
                  ? "Projected replacement"
                  : "Locked assignment"}{" "}
                · {plan.injury.clock}
              </small>
            </span>
          ))}
        </div>
      )}
      {moving && active && (
        <div
          className={s.moveSheet}
          role="dialog"
          aria-label={"Move " + active.name}
        >
          <header>
            <div>
              <small>MOVE PLAYER</small>
              <h3>{active.name}</h3>
            </div>
            <button
              aria-label="Close move controls"
              onClick={() => setMoving("")}
            >
              <X size={19} />
            </button>
          </header>
          <div className={s.moveChoices}>
            {lineupSlots
              .filter((slot) => eligible(active, slot))
              .map((slot) => (
                <button
                  key={slot.id}
                  disabled={!slotState(slot)}
                  onClick={() => move(slot.id)}
                >
                  {slot.label}
                  <small>
                    {demo.players.find((p) => p.slot === slot.id)?.name ??
                      "Open slot"}
                  </small>
                </button>
              ))}
            {["Subs", "IR", "Practice Squad"]
              .filter((g) => g !== active.group)
              .map((group) => (
                <button key={group} onClick={() => move(group)}>
                  {group}
                </button>
              ))}
          </div>
          {active.group === "Starters" && (
            <>
              <p>Swap with an eligible, unlocked Sub</p>
              <div className={s.moveChoices}>
                {bench
                  .filter(
                    (p) =>
                      !isLocked(p, demo.now) &&
                      eligible(
                        p,
                        lineupSlots.find((slot) => slot.id === active.slot)!,
                      ),
                  )
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        if (demo.move(p.id, active.slot!)) setMoving("");
                      }}
                    >
                      {p.name}
                      <small>{p.points} projected</small>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
export function Matchup({ onLineup }: { onLineup: () => void }) {
  const demo = useDemo();
  const [showScoring, setShowScoring] = useState(false);
  const plans = replacements(demo.players, sampleInjuries, demo.now);
  const final = demo.now >= 72;
  const score = (p: Player) => {
    const sub = plans.find((x) => x.starter.id === p.id);
    return final
      ? sub
        ? sub.injury.starterPoints + (sub.points ?? 0)
        : samplePlays(p).reduce((n, x) => n + x.points, 0)
      : p.points;
  };
  const total = demo.players
    .filter((p) => p.group === "Starters")
    .reduce((n, p) => n + score(p), 0);
  const opponentNames = [
    "Lamar Jackson",
    "Jared Goff",
    "Jonathan Taylor",
    "CeeDee Lamb",
    "A.J. Brown",
    "Kyren Williams",
    "DeVonta Smith",
    "Sam LaPorta",
    "George Kittle",
  ];
  const opponentPoints = [24, 20, 17, 19.7, 15.1, 14, 10.1, 9.2, 10.3];
  const opponent = opponentPoints.reduce((a, b) => a + b, 0);
  return (
    <div className={s.matchupView}>
      <div className={s.workspaceTools}>
        <span className={s.subtle}>
          WEEK 4 · {final ? "ILLUSTRATIVE FINAL" : "PROJECTED POINTS"}
        </span>
        <ScenarioControl />
      </div>
      <div className={s.scoreHero}>
        <Crest
          crest={demo.identity.crest}
          name={demo.identity.name}
          size={66}
        />
        <div>
          <small>3–0 · YOUR TEAM</small>
          <h3>{demo.identity.name}</h3>
        </div>
        <strong>{total.toFixed(1)}</strong>
        <span>VS</span>
        <strong>{opponent.toFixed(1)}</strong>
        <div>
          <small>2–1 · OPPONENT</small>
          <h3>Wingmen</h3>
        </div>
        <Crest crest="wingmen" name="Wingmen" size={66} />
      </div>
      <div className={s.scoreBar} aria-label="Share of combined team points">
        <span style={{ width: (total / (total + opponent)) * 100 + "%" }} />
      </div>
      <div className={s.matchupCaption}>
        <span>TEAM POINTS COMPARISON</span>
        <button onClick={onLineup}>
          Edit lineup
          <ArrowRight size={13} />
        </button>
      </div>
      <div className={s.matchupLineups}>
        {lineupSlots.map((slot, i) => {
          const p = demo.players.find(
              (x) => x.group === "Starters" && x.slot === slot.id,
            ),
            plan = plans.find((x) => x.starter.id === p?.id);
          return (
            <div className={s.matchupRow} key={slot.id}>
              <button onClick={() => (p ? demo.openPlayer(p.id) : onLineup())}>
                {p && <Portrait id={p.id} name={p.name} />}
                <span>
                  <strong>{p?.name ?? "Open starting spot"}</strong>
                  <small>
                    {plan
                      ? "SUB: " + (plan.backup?.name ?? "Uncovered")
                      : (p?.team ?? "") + " · " + (p?.opponent ?? "")}
                  </small>
                </span>
              </button>
              <b>{p ? score(p).toFixed(1) : "—"}</b>
              <span className={s.matchupSlot}>{slot.label}</span>
              <b>{opponentPoints[i % opponentPoints.length].toFixed(1)}</b>
              <span className={s.opponentName}>
                {opponentNames[i % opponentNames.length]}
              </span>
            </div>
          );
        })}
      </div>
      {plans.length > 0 && (
        <div className={s.scoringDetails}>
          <button
            onClick={() => setShowScoring(!showScoring)}
            aria-expanded={showScoring}
          >
            <Check size={15} />
            {plans.length} injury substitutions ·{" "}
            {showScoring ? "Hide" : "View"} scoring breakdown
          </button>
          {showScoring &&
            plans.map((p) => (
              <p key={p.starter.id}>
                <b>
                  {p.starter.name}: {p.injury.starterPoints.toFixed(1)}
                </b>{" "}
                through {p.injury.clock} +{" "}
                <b>{p.points === null ? "pending" : p.points.toFixed(1)}</b>{" "}
                from {p.backup?.name ?? "no eligible sub"} after that game-clock
                cutoff.{" "}
                {p.provisional
                  ? "Projected assignment; unlocked Subs can still change."
                  : "Assignment locked."}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
