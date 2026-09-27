"use client";
import { useState } from "react";
import { ArrowLeft, Check, ChevronRight, Plus, Trophy } from "lucide-react";
import { useDemo } from "./DemoState";
import { initialRules, teams } from "./model";
import { demoLeague, lineupSlots } from "./leagueFixture";
import { Crest, Empty, EventRow, SectionLabel, Tabs } from "./UI";
import s from "./Prototype.module.css";
export function Rules({ task }: { task: string }) {
  const { notify } = useDemo();
  const [proposalOpen, setProposalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [vote, setVote] = useState("");
  const [proposals, setProposals] = useState<
    { title: string; reason: string }[]
  >([]);
  const rule = initialRules.find((r) => r.id === task) ?? initialRules[0];
  return (
    <div className={s.rulesGrid}>
      <section className={s.ruleContent}>
        <span className={s.eyebrow}>CFC CONSTITUTION · SAMPLE</span>
        <h3>{rule.title}</h3>
        <p>{rule.text}</p>
        <button
          className={s.secondary}
          onClick={() => setProposalOpen(!proposalOpen)}
        >
          <Plus size={16} />
          Propose a rule change
        </button>
        {proposalOpen && (
          <form
            className={s.proposalForm}
            onSubmit={(e) => {
              e.preventDefault();
              setProposals((old) => [...old, { title, reason }]);
              setTitle("");
              setReason("");
              setProposalOpen(false);
              notify("Proposal saved in this local preview.");
            }}
          >
            <label className={s.field}>
              Proposal title
              <input
                required
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className={s.field}>
              The change and your reasoning
              <textarea
                rows={3}
                required
                maxLength={600}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className={s.primary}>Save proposal</button>
          </form>
        )}
      </section>
      <aside className={s.proposal}>
        <span className={s.eyebrow}>ON THE TABLE</span>
        <h3>
          One more place
          <br />
          to develop talent.
        </h3>
        <p>
          Increase the Practice Squad from {demoLeague.practiceSquadLimit} to{" "}
          {demoLeague.practiceSquadLimit + 1} spots next season.
        </p>
        <div className={s.voteBar}>
          <span
            style={{ width: ((5 + (vote === "For" ? 1 : 0)) / 12) * 100 + "%" }}
          />
        </div>
        <p>
          {5 + (vote === "For" ? 1 : 0)} for ·{" "}
          {3 + (vote === "Against" ? 1 : 0)} against · {vote ? 3 : 4} yet to
          vote
        </p>
        <div className={s.buttonRow}>
          {["For", "Against"].map((v) => (
            <button
              key={v}
              className={vote === v ? s.primary : s.secondary}
              aria-pressed={vote === v}
              onClick={() => setVote(v)}
            >
              {vote === v && <Check size={14} />}Vote {v.toLowerCase()}
            </button>
          ))}
        </div>
        {proposals.map((p, i) => (
          <EventRow
            key={i}
            title={p.title}
            detail={p.reason}
            tag="YOUR PROPOSAL"
          />
        ))}
      </aside>
    </div>
  );
}
export function Meetings({ task }: { task: string }) {
  const [attending, setAttending] = useState(false);
  const past = task !== "upcoming";
  return (
    <>
      <div className={s.meetingHero}>
        <div>
          <small>{past ? "MAY" : "OCT"}</small>
          <strong>{past ? "12" : "06"}</strong>
        </div>
        <section>
          <span className={s.eyebrow}>
            {past ? "MEETING ARCHIVE" : "NEXT OWNERS MEETING"}
          </span>
          <h3>
            {past ? "2026 offseason meeting" : "Midseason league check-in"}
          </h3>
          <p>
            {past
              ? "May 12, 2026 · Meeting minutes"
              : "Tuesday · 7 PM ET · League video call"}
          </p>
        </section>
      </div>
      <SectionLabel title={past ? "Decisions & minutes" : "On the agenda"}>
        <span>{past ? "Approved" : "3 topics"}</span>
      </SectionLabel>
      {(past
        ? [
            "Retained half-PPR scoring for the coming season.",
            "Confirmed the rookie draft calendar and pick order.",
            "Kept the annual waiver salary cap at $100.",
          ]
        : [
            "Practice Squad expansion proposal",
            "Trade deadline and roster compliance",
            "Planning next year's rookie draft",
          ]
      ).map((topic, i) => (
        <div className={s.agendaRow} key={topic}>
          <b>0{i + 1}</b>
          <strong>{topic}</strong>
          <small>{past ? "RECORDED" : i === 0 ? "20 MIN" : "10 MIN"}</small>
        </div>
      ))}
      {!past && (
        <button
          className={attending ? s.secondary : s.primary}
          aria-pressed={attending}
          onClick={() => setAttending(!attending)}
        >
          {attending ? (
            <>
              <Check size={16} />
              You&apos;re attending
            </>
          ) : (
            "Mark attending"
          )}
        </button>
      )}
      <p className={s.microcopy}>
        Illustrative meeting. Your response stays in this preview.
      </p>
    </>
  );
}
export function Identity() {
  const demo = useDemo();
  const [city, setCity] = useState(demo.identity.city);
  const [name, setName] = useState(demo.identity.name);
  const [crest, setCrest] = useState(demo.identity.crest);
  return (
    <div className={s.identityGrid}>
      <div className={s.identityPreview}>
        <span className={s.eyebrow}>YOUR FRANCHISE</span>
        <Crest crest={crest} name={name} size={145} />
        <h3>
          {city}
          <br />
          {name}
        </h3>
        <small>EST. 2026 · CFC</small>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!city.trim() || !name.trim()) return;
          demo.setIdentity({ city: city.trim(), name: name.trim(), crest });
          demo.notify("Franchise identity updated across the preview.");
        }}
      >
        <SectionLabel title="Make it yours" />
        <label className={s.field}>
          Home city / location
          <input
            value={city}
            required
            maxLength={24}
            onChange={(e) => setCity(e.target.value)}
          />
        </label>
        <label className={s.field}>
          Team name
          <input
            value={name}
            required
            maxLength={28}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className={s.crestPicker}>
          <legend>Team crest</legend>
          {["founders", "wingmen", "destroyers", "browns"].map((c) => (
            <button
              type="button"
              key={c}
              aria-label={"Use " + c + " crest"}
              aria-pressed={crest === c}
              onClick={() => setCrest(c)}
            >
              <Crest crest={c} name={c} size={45} />
              {crest === c && <Check size={12} />}
            </button>
          ))}
        </fieldset>
        <button className={s.primary}>
          Save team identity
          <Check size={16} />
        </button>
      </form>
    </div>
  );
}
export function Standings() {
  const { identity } = useDemo();
  const [view, setView] = useState("Divisions");
  const seeded = teams.slice(0, demoLeague.playoffs.teams);
  function renderTeam(index: number) {
    const t = seeded[index];
    return (
      <span className={s.bracketTeam}>
        <b>{index + 1}</b>
        <Crest
          crest={index === 0 ? identity.crest : t.crest}
          name={t.name}
          size={26}
        />
        {index === 0 ? identity.name : t.name}
      </span>
    );
  }
  return (
    <>
      <Tabs
        label="Standings view"
        options={["Divisions", "Playoff Picture"]}
        value={view}
        onChange={setView}
      />
      {view === "Divisions" ? (
        <div className={s.divisions}>
          {["East", "West"].map((division) => (
            <section key={division}>
              <SectionLabel title={division + " Division"}>
                <span>WEEK 4</span>
              </SectionLabel>
              <table className={s.standings}>
                <caption className={s.srOnly}>
                  {division} division standings
                </caption>
                <thead>
                  <tr>
                    <th>TEAM</th>
                    <th>W–L</th>
                    <th>PF</th>
                  </tr>
                </thead>
                <tbody>
                  {teams
                    .filter((t) => t.division === division)
                    .map((t, i) => (
                      <tr
                        key={t.name}
                        className={t.name === "Founders" ? s.yourTeam : ""}
                      >
                        <th>
                          <span>{i + 1}</span>
                          <Crest
                            crest={
                              t.name === "Founders" ? identity.crest : t.crest
                            }
                            name={t.name}
                            size={32}
                          />
                          <strong>
                            {t.name === "Founders" ? identity.name : t.name}
                          </strong>
                        </th>
                        <td>{t.record}</td>
                        <td>{t.points.toFixed(1)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className={s.workspaceTools}>
            <span className={s.subtle}>IF THE SEASON ENDED TODAY</span>
            <span>Top {demoLeague.playoffs.byes} seeds receive byes</span>
          </div>
          <div className={s.bracket}>
            <section>
              <h3>
                WILD CARD<small>WEEK {demoLeague.playoffs.startWeek}</small>
              </h3>
              <div className={s.bracketGame}>
                {renderTeam(3)}
                {renderTeam(4)}
              </div>
              <div className={s.bracketGame}>
                {renderTeam(2)}
                {renderTeam(5)}
              </div>
            </section>
            <section>
              <h3>
                SEMIFINALS
                <small>WEEK {demoLeague.playoffs.startWeek + 1}</small>
              </h3>
              <div className={s.bracketGame}>
                {renderTeam(0)}
                <span className={s.bracketPlaceholder}>Winner · 4 vs 5</span>
                <small>FIRST-ROUND BYE</small>
              </div>
              <div className={s.bracketGame}>
                {renderTeam(1)}
                <span className={s.bracketPlaceholder}>Winner · 3 vs 6</span>
                <small>FIRST-ROUND BYE</small>
              </div>
            </section>
            <section className={s.finalRound}>
              <h3>
                CHAMPIONSHIP
                <small>WEEK {demoLeague.playoffs.startWeek + 2}</small>
              </h3>
              <Trophy size={49} />
              <div className={s.bracketGame}>
                <span className={s.bracketPlaceholder}>Semifinal winner</span>
                <span className={s.bracketPlaceholder}>Semifinal winner</span>
              </div>
            </section>
          </div>
          <p className={s.microcopy}>
            Illustrative six-team bracket. Fixed bracket shown; final seeding
            follows league settings.
          </p>
        </>
      )}
    </>
  );
}
const pairs = [
  [0, 2],
  [1, 3],
  [4, 5],
  [6, 7],
  [8, 9],
  [10, 11],
];
export function Scores() {
  const { identity } = useDemo();
  const [week, setWeek] = useState("4");
  const [game, setGame] = useState<number | null>(null);
  const getName = (n: number) => (n === 0 ? identity.name : teams[n].name);
  const playerNames = [
    "Quarterback",
    "Superflex",
    "Running back",
    "Receiver",
    "Receiver",
    "Flex",
    "Flex",
    "Pass catcher",
    "Pass catcher",
  ];
  const point = (i: number, side: number, row: number) =>
    Number((23.4 - row * 1.45 + i * 0.6 + side * 0.9).toFixed(1));
  const score = (i: number, side: number) =>
    lineupSlots.reduce((sum, _, row) => sum + point(i, side, row), 0);
  return (
    <>
      <div className={s.weekChips} role="group" aria-label="Schedule week">
        {Array.from({ length: 17 }, (_, i) => String(i + 1)).map((w) => (
          <button
            key={w}
            aria-pressed={week === w}
            onClick={() => {
              setWeek(w);
              setGame(null);
            }}
          >
            <small>WK</small>
            {w}
            {w === "4" && <i className={s.liveDot} />}
          </button>
        ))}
      </div>
      {game === null ? (
        <div className={s.games}>
          {pairs.map((pair, i) => (
            <button className={s.game} key={i} onClick={() => setGame(i)}>
              <span className={s.gameStatus}>
                {Number(week) < 4
                  ? "FINAL"
                  : Number(week) === 4
                    ? "THIS WEEK"
                    : "SCHEDULED"}
                <ChevronRight size={15} />
              </span>
              {pair.map((n, side) => (
                <span className={s.gameTeam} key={n}>
                  <Crest
                    crest={n === 0 ? identity.crest : teams[n].crest}
                    name={teams[n].name}
                    size={40}
                  />
                  <span>
                    <strong>{getName(n)}</strong>
                    <small>{teams[n].record}</small>
                  </span>
                  <b>{Number(week) > 4 ? "—" : score(i, side).toFixed(1)}</b>
                </span>
              ))}
              <span className={s.gameLine}>
                {Number(week) < 4
                  ? "View box score"
                  : getName(pair[1]) +
                    " −" +
                    Math.abs(score(i, 1) - score(i, 0)).toFixed(1) +
                    " · Projected line"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <button className={s.textButton} onClick={() => setGame(null)}>
            <ArrowLeft size={15} />
            All Week {week} games
          </button>
          <div className={s.boxScoreHero}>
            {pairs[game].map((n, side) => (
              <div key={n}>
                <Crest
                  crest={n === 0 ? identity.crest : teams[n].crest}
                  name={teams[n].name}
                  size={50}
                />
                <h3>
                  {getName(n)} <small>{teams[n].record}</small>
                </h3>
                <strong>{score(game, side).toFixed(1)}</strong>
              </div>
            ))}
          </div>
          <SectionLabel
            title={Number(week) < 4 ? "Box score" : "Matchup projections"}
          >
            <span>All starting slots</span>
          </SectionLabel>
          <div className={s.boxRows}>
            {lineupSlots.map((slot, i) => (
              <div key={slot.id}>
                <span>{playerNames[i] ?? slot.label}</span>
                <b>{point(game, 0, i).toFixed(1)}</b>
                <small>{slot.label}</small>
                <b>{point(game, 1, i).toFixed(1)}</b>
                <span>{playerNames[i] ?? slot.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
export function LeagueActivity() {
  const { transactions, identity } = useDemo();
  const [tab, setTab] = useState("All");
  const events = transactions.filter(
    (t) =>
      ["Accepted", "Successful"].includes(t.status) &&
      (tab === "All" || t.type === (tab === "Trades" ? "Trade" : "Waiver")),
  );
  return (
    <>
      <Tabs
        label="League activity filter"
        options={["All", "Trades", "Waivers"]}
        value={tab}
        onChange={setTab}
      />
      {events.map((t) => (
        <EventRow
          key={t.id}
          title={t.title}
          detail={t.detail}
          tag={identity.name + " · " + t.date}
        />
      ))}
      {tab !== "Waivers" && (
        <EventRow
          title="Browns acquired a 2027 1st"
          detail="A completed player-for-pick trade with the Destroyers."
          tag="BROWNS ↔ DESTROYERS · YESTERDAY"
        />
      )}
      {!events.length && tab === "Waivers" && (
        <Empty
          title="No completed claims"
          text="Pending claims stay private until they process."
        />
      )}
    </>
  );
}
export function LeagueHistory() {
  const [year, setYear] = useState("2025");
  const winner =
    year === "2025" ? "Browns" : year === "2024" ? "Founders" : "Wingmen";
  return (
    <>
      <Tabs
        label="League archive season"
        options={["2025", "2024", "2023"]}
        value={year}
        onChange={setYear}
      />
      <div className={s.historyGrid}>
        <div className={s.champion}>
          <span className={s.eyebrow}>{year} LEAGUE CHAMPIONS</span>
          <Crest crest={winner.toLowerCase()} name={winner} size={105} />
          <Trophy size={29} />
          <h3>{winner}</h3>
          <p>A season for the history books.</p>
        </div>
        <section>
          <SectionLabel title="The season in numbers" />
          {[
            ["12–2", "Regular season record"],
            ["142.8", "Championship score"],
            ["+18.4", "Winning margin"],
          ].map(([value, label]) => (
            <div className={s.historyStat} key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
          <details className={s.rule}>
            <summary>
              Championship recap
              <Plus size={15} />
            </summary>
            <p>
              A deep roster and a strong final-week performance sealed this
              illustrative championship run.
            </p>
          </details>
          <details className={s.rule}>
            <summary>
              Season milestones
              <Plus size={15} />
            </summary>
            <p>
              Highest weekly score: 168.2. Closest matchup: 0.4 points.
              Completed trades: 28. All sample records.
            </p>
          </details>
        </section>
      </div>
    </>
  );
}
