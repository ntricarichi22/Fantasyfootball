"use client";
import { useState, type CSSProperties } from "react";
import {
  ArrowDown,
  ArrowUp,
  Play,
  RotateCcw,
  Search,
  Star,
  UserRound,
} from "lucide-react";
import { useDemo } from "./DemoState";
import { Crest, Tabs } from "./UI";
import { previewPicks } from "./pickAssets";
import { teams } from "./model";
import s from "./Prototype.module.css";

// Mirrors scouting/big-board/BigBoard's tier rails, rank/name poster cards,
// tier-colored portrait blocks, stars, and position filtering. Fixtures only.
const tierColors = ["#F5C230", "#3366CC", "#E8503A", "#2F7D4F"];
const names = [
  "Malik Carter",
  "Evan Brooks",
  "Noah Reed",
  "Roman Price",
  "Darius Williams",
  "Miles Grant",
  "Isaiah Cole",
  "Caleb Morris",
  "Jayden Fields",
  "Micah Stone",
  "Cameron Hayes",
  "Elijah Ward",
  "Jalen Pierce",
  "Owen Bennett",
  "Theo Marshall",
  "Devin Ross",
  "Ashton Bell",
  "Nolan James",
  "Tyler Rhodes",
  "Andre West",
  "Drew Collins",
  "Marcus Lane",
  "Zion Palmer",
  "Reece Ford",
  "Jaxon Ellis",
  "Dante Hall",
  "Logan Cross",
  "Trey Wilson",
  "Kobe Davis",
  "Ethan Wells",
  "Riley Scott",
  "Jordan Hayes",
  "Bryce Griffin",
  "Luca Martin",
  "Austin King",
  "Avery Fox",
  "Jace Hill",
  "Dylan Reed",
  "Amir Green",
  "Cole Walker",
];
const prospects = names.map((name, i) => ({
  id: "rookie-" + i,
  name,
  position: ["WR", "RB", "QB", "TE", "WR", "RB"][i % 6],
  school: [
    "Coastal State",
    "Western State",
    "Mountain Tech",
    "Central University",
    "Southern State",
    "Eastern State",
  ][i % 6],
  age: 21 + (i % 3),
  tier: Math.floor(i / 10),
  rank: i + 1,
}));
type Prospect = (typeof prospects)[number];
const seats = [teams[1], teams[2], teams[0], ...teams.slice(3)];

export function Draft({ task }: { task: string }) {
  const demo = useDemo();
  const [board, setBoard] = useState(prospects);
  const [stars, setStars] = useState<string[]>([]);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [starOnly, setStarOnly] = useState(false);
  const [drag, setDrag] = useState("");
  const [tab, setTab] = useState("Big Board");
  const [drafted, setDrafted] = useState<string[]>([]);
  const [round, setRound] = useState(1);
  const [poolTab, setPoolTab] = useState("Player Pool");
  const [mockFilter, setMockFilter] = useState("All");
  const [mockQuery, setMockQuery] = useState("");
  const selected = board.find((p) => p.id === drag);
  function move(id: string, target: string, tier?: number) {
    const next = [...board],
      a = next.findIndex((p) => p.id === id),
      b = next.findIndex((p) => p.id === target);
    if (a < 0 || b < 0) return;
    const item = { ...next[a], tier: tier ?? next[b].tier };
    next.splice(a, 1);
    next.splice(b, 0, item);
    setBoard(next);
    setDrag("");
  }
  const matching = (p: Prospect, f: string, q: string) =>
    (f === "All" ||
      p.position === f ||
      (f === "PCs" && ["WR", "TE"].includes(p.position))) &&
    p.name.toLowerCase().includes(q.toLowerCase());
  const filtered = board.filter(
    (p) => matching(p, filter, query) && (!starOnly || stars.includes(p.id)),
  );
  const yourTurn = drafted.length < 36 && drafted.length % 12 === 2;
  const complete = drafted.length === 36;
  const available = board.filter((p) => !drafted.includes(p.id));
  const mine = drafted
    .filter((_, i) => i % 12 === 2)
    .map((id) => board.find((p) => p.id === id)!);
  function advance(toUs: boolean) {
    const next = [...drafted];
    do {
      if (next.length >= 36 || next.length % 12 === 2) break;
      const pick = board.find((p) => !next.includes(p.id));
      if (pick) next.push(pick.id);
      else break;
    } while (toUs);
    setDrafted(next);
    setRound(Math.min(3, Math.floor(next.length / 12) + 1));
  }
  function select(p: Prospect) {
    if (!yourTurn || drafted.includes(p.id)) return;
    setDrafted([...drafted, p.id]);
  }
  if (task !== "board")
    return (
      <div className={s.mockRoom}>
        <div className={s.mockCommand}>
          <div>
            <small>2027 ROOKIE DRAFT · SAMPLE CLASS</small>
            <h3>
              {complete
                ? "DRAFT COMPLETE"
                : yourTurn
                  ? "YOU ARE ON THE CLOCK"
                  : seats[drafted.length % 12]?.name.toUpperCase() +
                    " ON THE CLOCK"}
            </h3>
          </div>
          <div>
            <button
              className={s.secondary}
              onClick={() => {
                setDrafted([]);
                setRound(1);
              }}
            >
              <RotateCcw size={15} /> Restart
            </button>
            <button
              className={s.primary}
              disabled={yourTurn || complete}
              onClick={() => advance(true)}
            >
              <Play size={15} /> Sim to my pick
            </button>
          </div>
        </div>
        <div className={s.draftPickStrip} aria-label="Draft order">
          {Array.from({ length: 12 }, (_, i) => {
            const index = (round - 1) * 12 + i;
            const team = seats[i];
            const p = board.find((p) => p.id === drafted[index]);
            return (
              <div
                key={index}
                data-current={drafted.length === index}
                data-owned={i === 2}
              >
                <b>
                  {round}.{String(i + 1).padStart(2, "0")}
                </b>
                <Crest name={team.name} crest={team.crest} size={27} />
                <span>{i === 2 ? demo.identity.name : team.name}</span>
                <small>
                  {p?.name ??
                    (drafted.length === index ? "ON THE CLOCK" : "UPCOMING")}
                </small>
              </div>
            );
          })}
        </div>
        <section className={s.mockBoard}>
          <header>
            <strong>MOCK DRAFT</strong>
            <Tabs
              label="Mock draft round"
              options={["Round 1", "Round 2", "Round 3"]}
              value={"Round " + round}
              onChange={(r) => setRound(Number(r.slice(-1)))}
            />
            <small>{drafted.length} / 36 PICKS</small>
          </header>
          <div className={s.mockBoardSlots}>
            {Array.from({ length: 12 }, (_, i) => {
              const index = (round - 1) * 12 + i,
                p = board.find((p) => p.id === drafted[index]);
              return (
                <div key={i} data-current={drafted.length === index}>
                  <b>
                    {round}.{String(i + 1).padStart(2, "0")}
                  </b>
                  <span>{p?.name ?? seats[i].name}</span>
                  <small>{p?.position ?? "—"}</small>
                </div>
              );
            })}
          </div>
        </section>
        <div className={s.mockWarRoom}>
          <section className={s.mockPool}>
            <Tabs
              label="Mock draft panel"
              options={["Player Pool", "Your Roster"]}
              value={poolTab}
              onChange={setPoolTab}
            />
            {poolTab === "Player Pool" ? (
              <>
                <div className={s.mockPoolTools}>
                  <label>
                    <Search size={15} />
                    <input
                      aria-label="Search draft prospects"
                      placeholder="Search players"
                      value={mockQuery}
                      onChange={(e) => setMockQuery(e.target.value)}
                    />
                  </label>
                  <Tabs
                    label="Mock draft position"
                    options={["All", "QB", "RB", "PCs"]}
                    value={mockFilter}
                    onChange={setMockFilter}
                  />
                </div>
                <div className={s.mockPoolScroll}>
                  <div className={s.mockPlayerHead}>
                    <span>PLAYER</span>
                    <span>AGE</span>
                    <span>OUR RANK</span>
                    <span>PROJ. ROLE</span>
                    <span>SELECT</span>
                  </div>
                  {available
                    .filter((p) => matching(p, mockFilter, mockQuery))
                    .map((p) => (
                      <div key={p.id} className={s.mockPlayerRow}>
                        <span>
                          <b>{p.name}</b>
                          <small>
                            {p.position} · {p.school}
                          </small>
                        </span>
                        <span>{p.age}</span>
                        <b>#{board.indexOf(p) + 1}</b>
                        <small>
                          {p.tier === 0
                            ? "STARTER"
                            : p.tier === 1
                              ? "ROTATION"
                              : "DEVELOP"}
                        </small>
                        <button disabled={!yourTurn} onClick={() => select(p)}>
                          Draft
                        </button>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <div className={s.mockPoolScroll}>
                <h4>YOUR DRAFT CLASS</h4>
                {mine.length ? (
                  mine.map((p) => (
                    <div className={s.mockPlayerRow} key={p.id}>
                      <span>
                        <b>{p.name}</b>
                        <small>
                          {p.position} · {p.school}
                        </small>
                      </span>
                      <b>#{board.indexOf(p) + 1}</b>
                    </div>
                  ))
                ) : (
                  <p>Your selections will appear here.</p>
                )}
                <h4>CURRENT ROSTER</h4>
                {demo.players
                  .filter((p) => p.group === "Starters")
                  .map((p) => (
                    <div className={s.mockRosterRow} key={p.id}>
                      <span>{p.position}</span>
                      <b>{p.name}</b>
                    </div>
                  ))}
              </div>
            )}
          </section>
          <aside className={s.mockDirector}>
            <small>SCOUTING DIRECTOR</small>
            <h3>
              {complete
                ? "Your class is in."
                : yourTurn
                  ? "Make your selection."
                  : "Read the board."}
            </h3>
            <p>
              {yourTurn
                ? "Your highest-ranked available prospect:"
                : "Advance to your next pick to see who is still available."}
            </p>
            {yourTurn && available[0] && (
              <>
                <strong>{available[0].name}</strong>
                <span>
                  {available[0].position} · #{board.indexOf(available[0]) + 1}{" "}
                  on your board
                </span>
                <button
                  className={s.primary}
                  onClick={() => select(available[0])}
                >
                  Draft {available[0].name}
                </button>
              </>
            )}
            <div>
              <b>{mine.length}</b>
              <span>YOUR SELECTIONS</span>
            </div>
            <small>Illustrative draft order and scouting assessments.</small>
          </aside>
        </div>
      </div>
    );
  return (
    <div className={s.bigBoardRoom}>
      <Tabs
        label="Draft board view"
        options={["Big Board", "Your Draft Picks"]}
        value={tab}
        onChange={setTab}
      />
      {tab === "Your Draft Picks" ? (
        <div className={s.pickGrid}>
          {previewPicks().map((p) => (
            <div key={p.id} className={s.pickCard}>
              <span>{p.season}</span>
              <strong>ROUND {p.round}</strong>
              <small>{p.meta}</small>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className={s.boardToolbar}>
            <label>
              <Search size={16} />
              <input
                aria-label="Search big board"
                placeholder="Find a prospect"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Tabs
              label="Big board position"
              options={["All", "QB", "RB", "WR", "TE"]}
              value={filter}
              onChange={setFilter}
            />
            <button
              className={s.secondary}
              aria-pressed={starOnly}
              onClick={() => setStarOnly(!starOnly)}
            >
              <Star size={15} fill={starOnly ? "currentColor" : "none"} /> My
              guys ({stars.length})
            </button>
          </div>
          <div className={s.boardTierNav}>
            {tierColors.map((color, i) => (
              <button
                key={i}
                style={{ "--tier": color } as CSSProperties}
                onClick={() =>
                  document
                    .getElementById("preview-tier-" + i)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                TIER {i + 1}
              </button>
            ))}
            <span>
              {selected
                ? "Placing " + selected.name + " · choose a card or tier"
                : "Drag to rank · click a card, then a destination to move"}
            </span>
          </div>
          <div className={s.boardCanvas}>
            {tierColors.map((color, t) => (
              <section
                key={t}
                id={"preview-tier-" + t}
                style={{ "--tier": color } as CSSProperties}
              >
                <header className={s.tierRail}>
                  <b>TIER {t + 1}</b>
                  <span>
                    {
                      [
                        "Cornerstones",
                        "Building blocks",
                        "Upside swings",
                        "Development",
                      ][t]
                    }
                  </span>
                  <small>
                    {board.filter((p) => p.tier === t).length} PLAYERS
                  </small>
                  {drag && (
                    <button
                      onClick={() => {
                        setBoard((old) =>
                          old.map((p) =>
                            p.id === drag ? { ...p, tier: t } : p,
                          ),
                        );
                        setDrag("");
                      }}
                    >
                      Move here
                    </button>
                  )}
                </header>
                <div className={s.posterGrid}>
                  {filtered
                    .filter((p) => p.tier === t)
                    .map((p) => (
                      <article
                        className={s.posterCard}
                        key={p.id}
                        draggable
                        onDragStart={() => setDrag(p.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          move(drag, p.id, t);
                        }}
                        onDragEnd={() => setDrag("")}
                        data-selected={drag === p.id}
                      >
                        <header>
                          <b>{board.indexOf(p) + 1}</b>
                          <button
                            aria-label={"Mark " + p.name + " as my guy"}
                            aria-pressed={stars.includes(p.id)}
                            onClick={() =>
                              setStars((old) =>
                                old.includes(p.id)
                                  ? old.filter((id) => id !== p.id)
                                  : [...old, p.id],
                              )
                            }
                          >
                            <Star
                              size={17}
                              fill={
                                stars.includes(p.id) ? "currentColor" : "none"
                              }
                            />
                          </button>
                          <span>{p.position}</span>
                        </header>
                        <button
                          className={s.posterBody}
                          aria-label={"Move " + p.name}
                          onClick={() =>
                            drag && drag !== p.id
                              ? move(drag, p.id, t)
                              : setDrag(drag === p.id ? "" : p.id)
                          }
                        >
                          <strong>{p.name}</strong>
                          <small>
                            {p.position} · {p.school} · {p.age}
                          </small>
                          <span className={s.posterPhoto}>
                            <UserRound strokeWidth={1} size={115} />
                            <b>{p.position}</b>
                          </span>
                        </button>
                        <footer>
                          <small>CONSENSUS #{p.rank}</small>
                          <button
                            aria-label={"Move " + p.name + " up"}
                            disabled={board.indexOf(p) === 0}
                            onClick={() =>
                              move(p.id, board[board.indexOf(p) - 1].id)
                            }
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            aria-label={"Move " + p.name + " down"}
                            disabled={board.indexOf(p) === board.length - 1}
                            onClick={() =>
                              move(p.id, board[board.indexOf(p) + 1].id)
                            }
                          >
                            <ArrowDown size={14} />
                          </button>
                        </footer>
                      </article>
                    ))}
                </div>
              </section>
            ))}
            {!filtered.length && <p>No prospects match these filters.</p>}
          </div>
        </>
      )}
    </div>
  );
}
