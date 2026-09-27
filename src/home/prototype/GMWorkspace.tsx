"use client";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowLeftRight,
  Check,
  ChevronRight,
  Clock3,
  GripVertical,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import { useDemo } from "./DemoState";
import { demoLeague } from "./leagueFixture";
import { slotEligibility } from "@/shared/team-profiles/strength";
import { freeAgents, type Availability } from "./model";
import {
  Empty,
  EventRow,
  Portrait,
  SectionLabel,
  Tabs,
  Pagination,
} from "./UI";
import s from "./Prototype.module.css";
const pickAssets = [
  "2027 · Round 1",
  "2027 · Round 2",
  "2027 · Round 3",
  "2028 · Round 1",
  "2028 · Round 2",
  "2028 · Round 3",
];
const followUps = {
  Thin: [
    {
      id: "difference_maker",
      label: "Land a difference-maker",
      text: "A clear upgrade to our starters.",
    },
    {
      id: "insurance",
      label: "Get insurance",
      text: "Reliable cover when a starter goes down.",
    },
    {
      id: "young",
      label: "Find young building blocks",
      text: "Upside we can grow with.",
    },
  ],
  Deep: [
    {
      id: "consolidate",
      label: "Consolidate our depth",
      text: "Turn multiple assets into one upgrade.",
    },
    {
      id: "fill_need",
      label: "Fill a different need",
      text: "Use the surplus to strengthen another room.",
    },
  ],
};
export function Strategy() {
  const demo = useDemo();
  const [room, setRoom] = useState("QB");
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(0);
  const list = demo.players.filter((p) =>
    room === "Pass Catchers"
      ? ["WR", "TE"].includes(p.position)
      : p.position === room,
  );
  const pageSize = selected ? 4 : 6;
  const assetCount = room === "Draft Picks" ? pickAssets.length : list.length;
  const picks = room === "Draft Picks",
    need = demo.needs[room],
    current = demo.players.find((p) => p.id === selected);
  const settings = picks
    ? (demo.pickSettings[selected] ?? { availability: "Listening", asking: "" })
    : current;
  const options =
    need.stance === "Set"
      ? []
      : picks && need.stance === "Thin"
        ? [
            {
              id: "premium",
              label: "Premium picks",
              text: "Target first-round capital.",
            },
            {
              id: "day2",
              label: "Day-2 capital",
              text: "Build depth with second and third rounders.",
            },
            {
              id: "future",
              label: "Future picks",
              text: "Invest beyond the upcoming draft.",
            },
          ]
        : followUps[need.stance as "Thin" | "Deep"];
  function updateSettings(field: "availability" | "asking", value: string) {
    if (picks)
      demo.setPickSettings((old) => ({
        ...old,
        [selected]: {
          availability: settings?.availability ?? "Listening",
          asking: settings?.asking ?? "",
          [field]: value,
        },
      }));
    else if (current)
      demo.editPlayer(
        current.id,
        field === "availability"
          ? { availability: value as Availability }
          : { asking: value },
      );
  }
  return (
    <>
      <Tabs
        label="Position room"
        options={["QB", "RB", "Pass Catchers", "Draft Picks"]}
        value={room}
        onChange={(r) => {
          setRoom(r);
          setSelected("");
          setPage(0);
        }}
      />
      <div className={s.strategyGrid}>
        <section>
          <SectionLabel title={picks ? "Your draft capital" : "In the room"}>
            <span>{picks ? pickAssets.length : list.length} assets</span>
          </SectionLabel>
          <div className={s.strategyPlayers}>
            {picks
              ? pickAssets
                  .slice(page * pageSize, page * pageSize + pageSize)
                  .map((pick, i) => (
                    <button
                      className={[
                        s.assetRow,
                        selected === pick ? s.assetSelected : "",
                      ].join(" ")}
                      key={pick}
                      onClick={() => {
                        setSelected(pick);
                        setPage(Math.floor(pickAssets.indexOf(pick) / 4));
                      }}
                    >
                      <span className={s.pickToken}>
                        {((page * pageSize + i) % 3) + 1}
                      </span>
                      <span>
                        <strong>{pick}</strong>
                        <small>
                          {demo.pickSettings[pick]?.availability ?? "Listening"}{" "}
                          · Original pick
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))
              : list
                  .slice(page * pageSize, page * pageSize + pageSize)
                  .map((p) => (
                    <button
                      className={[
                        s.assetRow,
                        selected === p.id ? s.assetSelected : "",
                      ].join(" ")}
                      key={p.id}
                      onClick={() => {
                        setSelected(p.id);
                        setPage(
                          Math.floor(list.findIndex((x) => x.id === p.id) / 4),
                        );
                      }}
                    >
                      <Portrait id={p.id} name={p.name} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {p.position} · {p.team} · {p.group}
                        </small>
                      </span>
                      <span
                        className={s.assetAvailability}
                        data-status={p.availability}
                      >
                        {p.availability}
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
          </div>
          {assetCount > pageSize && (
            <div className={s.pagination}>
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {page + 1} / {Math.ceil(assetCount / pageSize)}
              </span>
              <button
                disabled={(page + 1) * pageSize >= assetCount}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
          {selected && settings ? (
            <div className={s.inlineEditor}>
              <SectionLabel title={current?.name ?? selected}>
                <button
                  className={s.iconButton}
                  aria-label="Close asset settings"
                  onClick={() => {
                    setSelected("");
                    setPage(0);
                  }}
                >
                  <X size={15} />
                </button>
              </SectionLabel>
              <div className={s.formGrid}>
                <label className={s.field}>
                  Availability
                  <select
                    value={settings.availability}
                    onChange={(e) =>
                      updateSettings("availability", e.target.value)
                    }
                  >
                    {["Untouchable", "Core piece", "Listening", "Moveable"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      ),
                    )}
                  </select>
                </label>
                <label className={s.field}>
                  Your asking price
                  <input
                    value={settings.asking}
                    placeholder="Players, picks, or a combination"
                    onChange={(e) => updateSettings("asking", e.target.value)}
                  />
                </label>
              </div>
              <small className={s.subtle}>Saved as you edit.</small>
            </div>
          ) : (
            <p className={s.microcopy}>
              Select an asset to set its availability and your asking price.
            </p>
          )}
        </section>
        <aside className={s.needsPanel}>
          <span className={s.eyebrow}>YOUR ASSESSMENT</span>
          <h3>
            HOW DOES
            <br />
            THIS ROOM LOOK?
          </h3>
          <p>Tell your personnel department where to focus.</p>
          <div className={s.stanceChoices}>
            {["Thin", "Set", "Deep"].map((stance, i) => (
              <button
                key={stance}
                aria-pressed={need.stance === stance}
                onClick={() =>
                  demo.setNeeds((old) => ({
                    ...old,
                    [room]: { stance, goals: [] },
                  }))
                }
              >
                <span>{"▰".repeat(i + 1)}</span>
                <strong>{stance}</strong>
                <small>
                  {["Looking to add", "Happy here", "Open to moving"][i]}
                </small>
              </button>
            ))}
          </div>
          {options.length > 0 ? (
            <>
              <SectionLabel
                title={
                  need.stance === "Thin"
                    ? "What are you looking for?"
                    : "How would you use the surplus?"
                }
              />
              {options.map((option) => (
                <button
                  className={s.needOption}
                  key={option.id}
                  aria-pressed={need.goals.includes(option.id)}
                  onClick={() =>
                    demo.setNeeds((old) => ({
                      ...old,
                      [room]: {
                        ...need,
                        goals: need.goals.includes(option.id)
                          ? need.goals.filter((x) => x !== option.id)
                          : [...need.goals, option.id],
                      },
                    }))
                  }
                >
                  <span className={s.checkBox}>
                    {need.goals.includes(option.id) && <Check size={14} />}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.text}</small>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <div className={s.setRoom}>
              <Check size={25} />
              <strong>Hold your ground.</strong>
              <p>Your staff can focus on the other rooms.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
export function Trades({ task }: { task: string }) {
  const demo = useDemo();
  const [mode, setMode] = useState("Build it myself");
  const [partner, setPartner] = useState("Wingmen");
  const [outgoing, setOutgoing] = useState("cook");
  const [incoming, setIncoming] = useState("2027 1st-round pick");
  const [note, setNote] = useState("");
  const [prompt, setPrompt] = useState("");
  const [suggestion, setSuggestion] = useState(false);
  const [shop, setShop] = useState<string[]>([]);
  const [shopPage, setShopPage] = useState(0);
  const [offers, setOffers] = useState(false);
  function save() {
    demo.addTransaction({
      title: "Offer to the " + partner,
      detail:
        (demo.players.find((p) => p.id === outgoing)?.name ?? outgoing) +
        " for " +
        incoming,
      type: "Trade",
      status: "Pending",
      note: note.trim(),
    });
    demo.notify("Offer saved in Active Negotiations. This is a local sample.");
  }
  return (
    <>
      <div hidden={task !== "build"}>
        <Tabs
          label="Build trade method"
          options={["Build it myself", "Describe the deal"]}
          value={mode}
          onChange={setMode}
        />
        {mode === "Describe the deal" && (
          <div className={s.directorPrompt}>
            <span className={s.eyebrow}>DIRECTOR OF PRO PERSONNEL</span>
            <label className={s.field}>
              What move do you have in mind?
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Find me a young receiver for a future pick…"
              />
            </label>
            <button
              className={s.secondary}
              disabled={!prompt.trim()}
              onClick={() => setSuggestion(true)}
            >
              Preview example proposal
            </button>
            {suggestion && (
              <p className={s.subtle}>
                Scripted example: shop a veteran for future capital. Edit the
                offer below. No AI request was sent.
              </p>
            )}
          </div>
        )}
        <label className={s.field}>
          Trade partner
          <select value={partner} onChange={(e) => setPartner(e.target.value)}>
            {["Wingmen", "Browns", "Destroyers"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <div className={s.tradeSides}>
          <section>
            <span className={s.eyebrow}>YOU SEND</span>
            <h3>{demo.identity.name}</h3>
            <label className={s.field}>
              Your player or pick
              <select
                value={outgoing}
                onChange={(e) => setOutgoing(e.target.value)}
              >
                {demo.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.position}
                  </option>
                ))}
                {pickAssets.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            {demo.players.find((p) => p.id === outgoing) && (
              <div className={s.tradePlayer}>
                <Portrait id={outgoing} name="Your selected player" />
                <strong>
                  {demo.players.find((p) => p.id === outgoing)?.name}
                </strong>
              </div>
            )}
          </section>
          <ArrowLeftRight className={s.tradeSwap} />
          <section>
            <span className={s.eyebrow}>YOU RECEIVE</span>
            <h3>{partner}</h3>
            <label className={s.field}>
              Player or pick
              <select
                value={incoming}
                onChange={(e) => setIncoming(e.target.value)}
              >
                {[
                  "2027 1st-round pick",
                  "2027 2nd + 2028 2nd",
                  "DeVonta Smith",
                  "Sam LaPorta",
                ].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <div className={s.tradePlayer}>
              <span className={s.pickToken}>↗</span>
              <strong>{incoming}</strong>
            </div>
          </section>
        </div>
        <label className={s.field}>
          Offer note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context for the other GM"
          />
        </label>
        <button className={s.primary} onClick={save}>
          Save offer
          <ArrowLeftRight size={16} />
        </button>
      </div>
      <div hidden={task !== "shop"}>
        <div className={s.workspaceTools}>
          <span className={s.subtle}>Choose the players you want to shop.</span>
          <b>{shop.length} selected</b>
        </div>
        <div className={s.shopGrid}>
          {demo.players.slice(shopPage * 9, shopPage * 9 + 9).map((p) => (
            <button
              className={s.shopPlayer}
              key={p.id}
              aria-pressed={shop.includes(p.id)}
              onClick={() => {
                setShop((old) =>
                  old.includes(p.id)
                    ? old.filter((x) => x !== p.id)
                    : [...old, p.id],
                );
                setOffers(false);
              }}
            >
              <Portrait id={p.id} name={p.name} />
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.position} · {p.team}
                </small>
              </span>
              <span className={s.checkBox}>
                {shop.includes(p.id) && <Check size={13} />}
              </span>
            </button>
          ))}
        </div>
        <Pagination
          page={shopPage}
          total={demo.players.length}
          size={9}
          onChange={setShopPage}
        />
        <button
          className={s.primary}
          disabled={!shop.length}
          onClick={() => setOffers(true)}
        >
          Preview trade offers
          <ArrowLeftRight size={16} />
        </button>
        {offers && (
          <div className={s.offerResult}>
            <span className={s.eyebrow}>
              ILLUSTRATIVE RETURN · NO CALLS MADE
            </span>
            <h3>Wingmen offer a 2027 1st</h3>
            <p>
              For{" "}
              {shop
                .map((id) => demo.players.find((p) => p.id === id)?.name)
                .join(" + ")}
              .
            </p>
            <button
              className={s.secondary}
              onClick={() => {
                demo.addTransaction({
                  title: "Discussion with the Wingmen",
                  detail:
                    shop
                      .map((id) => demo.players.find((p) => p.id === id)?.name)
                      .join(" + ") + " for a 2027 1st",
                  type: "Trade",
                  status: "Pending",
                });
                demo.notify("Added to Active Negotiations.");
              }}
            >
              Save negotiation
            </button>
          </div>
        )}
      </div>
      <div hidden={task !== "negotiations"}>
        {demo.transactions
          .filter((t) => t.type === "Trade" && t.status === "Pending")
          .map((t) => (
            <EventRow
              key={t.id}
              title={t.title}
              detail={t.detail}
              tag="AWAITING A DECISION"
            >
              {t.note && <p className={s.offerNote}>{t.note}</p>}
              <div className={s.buttonRow}>
                {["Accepted", "Rejected", "Withdrawn"].map((status) => (
                  <button
                    className={status === "Accepted" ? s.primary : s.secondary}
                    key={status}
                    onClick={() => {
                      demo.setTransactions((old) =>
                        old.map((x) =>
                          x.id === t.id
                            ? {
                                ...x,
                                status: status as
                                  | "Accepted"
                                  | "Rejected"
                                  | "Withdrawn",
                              }
                            : x,
                        ),
                      );
                      demo.notify("Sample offer " + status.toLowerCase() + ".");
                    }}
                  >
                    {status === "Accepted"
                      ? "Accept"
                      : status === "Rejected"
                        ? "Decline"
                        : "Withdraw"}
                  </button>
                ))}
              </div>
            </EventRow>
          ))}
        {!demo.transactions.some(
          (t) => t.type === "Trade" && t.status === "Pending",
        ) && (
          <Empty
            title="No open negotiations"
            text="Build an offer or shop your guys to start a conversation."
          />
        )}
      </div>
    </>
  );
}
const prospects = [
  {
    name: "Malik Carter",
    position: "WR",
    school: "Coastal State",
    tier: "Blue chip",
  },
  {
    name: "Evan Brooks",
    position: "RB",
    school: "Western State",
    tier: "Blue chip",
  },
  {
    name: "Noah Reed",
    position: "QB",
    school: "Mountain Tech",
    tier: "Round one",
  },
  {
    name: "Roman Price",
    position: "TE",
    school: "Central University",
    tier: "Round one",
  },
  {
    name: "Darius Williams",
    position: "WR",
    school: "Southern State",
    tier: "Round two",
  },
  {
    name: "Miles Grant",
    position: "RB",
    school: "Eastern State",
    tier: "Round two",
  },
];
export function Draft({ task }: { task: string }) {
  const [board, setBoard] = useState(prospects);
  const [drag, setDrag] = useState("");
  const [stars, setStars] = useState<string[]>([]);
  const [tab, setTab] = useState("Big Board");
  const [picks, setPicks] = useState<string[]>([]);
  function reorder(from: string, to: string) {
    const copy = [...board],
      start = copy.findIndex((p) => p.name === from),
      end = copy.findIndex((p) => p.name === to);
    if (start < 0 || end < 0) return;
    copy.splice(end, 0, ...copy.splice(start, 1));
    setBoard(copy);
  }
  return (
    <>
      {task === "board" ? (
        <>
          <Tabs
            label="Draft board view"
            options={["Big Board", "Your Draft Picks"]}
            value={tab}
            onChange={setTab}
          />
          {tab === "Your Draft Picks" ? (
            <div className={s.pickGrid}>
              {pickAssets.map((p, i) => (
                <div key={p} className={s.pickCard}>
                  <span>{p.split(" · ")[0]}</span>
                  <strong>ROUND {(i % 3) + 1}</strong>
                  <small>Virginia Founders · Original pick</small>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className={s.workspaceTools}>
                <span className={s.subtle}>
                  Drag to rank your board. Fictional rookie class.
                </span>
                <span>{stars.length} watchlisted</span>
              </div>
              <div className={s.prospectGrid}>
                {board.map((p, i) => (
                  <article
                    className={s.prospect}
                    key={p.name}
                    draggable
                    onDragStart={() => setDrag(p.name)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => reorder(drag, p.name)}
                  >
                    <span className={s.prospectRank}>0{i + 1}</span>
                    <button
                      className={s.watchStar}
                      aria-label={"Watch " + p.name}
                      aria-pressed={stars.includes(p.name)}
                      onClick={() =>
                        setStars((old) =>
                          old.includes(p.name)
                            ? old.filter((x) => x !== p.name)
                            : [...old, p.name],
                        )
                      }
                    >
                      <Star
                        size={19}
                        fill={stars.includes(p.name) ? "currentColor" : "none"}
                      />
                    </button>
                    <div className={s.prospectArt}>
                      <span>{p.position}</span>
                    </div>
                    <small>{p.tier}</small>
                    <h3>{p.name}</h3>
                    <p>{p.school}</p>
                    <div className={s.rankButtons}>
                      <button
                        disabled={i === 0}
                        aria-label={"Move " + p.name + " up"}
                        onClick={() => reorder(p.name, board[i - 1].name)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        disabled={i === board.length - 1}
                        aria-label={"Move " + p.name + " down"}
                        onClick={() => reorder(p.name, board[i + 1].name)}
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className={s.workspaceTools}>
            <span className={s.subtle}>MOCK DRAFT · YOUR PICKS</span>
            <strong>
              {picks.length} / {board.length}
            </strong>
          </div>
          <div className={s.mockDraftGrid}>
            <section>
              {board
                .filter((p) => !picks.includes(p.name))
                .map((p) => (
                  <button
                    key={p.name}
                    className={s.assetRow}
                    onClick={() => setPicks([...picks, p.name])}
                  >
                    <span className={s.position}>{p.position}</span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.school}</small>
                    </span>
                    <Plus size={17} />
                  </button>
                ))}
            </section>
            <section>
              <SectionLabel title="Your draft class" />
              {picks.map((name, i) => (
                <EventRow
                  key={name}
                  title={name}
                  detail={"Pick " + (i + 1) + " · sample selection"}
                />
              ))}
              <button className={s.secondary} onClick={() => setPicks([])}>
                Restart mock
              </button>
            </section>
          </div>
        </>
      )}
    </>
  );
}
export function Waivers() {
  const demo = useDemo();
  const [position, setPosition] = useState("All");
  const [query, setQuery] = useState("");
  const [waiverPage, setWaiverPage] = useState(0);
  const [selected, setSelected] = useState("");
  const [bid, setBid] = useState(5);
  const [drop, setDrop] = useState("");
  const [drag, setDrag] = useState("");
  const [remaining, setRemaining] = useState(2 * 86400 + 13 * 3600 + 45 * 60);
  useEffect(() => {
    const timer = setInterval(
      () => setRemaining((x) => Math.max(0, x - 60)),
      60000,
    );
    return () => clearInterval(timer);
  }, []);
  const codes: Record<string, string> = {
    "S-FLEX": "SUPER_FLEX",
    PC: "REC_FLEX",
  };
  const valid = slotEligibility(codes[position] ?? position);
  const list = freeAgents.filter(
    (p) =>
      (position === "All" ||
        (position === "Rookie" && p.rookie) ||
        valid?.includes(p.position as "QB" | "RB" | "WR" | "TE")) &&
      p.name.toLowerCase().includes(query.toLowerCase()),
  );
  const waiverSize = demo.claims.length > 1 ? 3 : demo.claims.length ? 4 : 5;
  const activePage = Math.min(
    waiverPage,
    Math.max(0, Math.ceil(list.length / waiverSize) - 1),
  );
  const candidate = freeAgents.find((p) => p.id === selected);
  const count = [
    Math.floor(remaining / 86400),
    Math.floor(remaining / 3600) % 24,
    Math.floor(remaining / 60) % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(" : ");
  function reorder(a: string, b: string) {
    const copy = [...demo.claims],
      i = copy.findIndex((c) => c.id === a),
      j = copy.findIndex((c) => c.id === b);
    if (i < 0 || j < 0) return;
    copy.splice(j, 0, ...copy.splice(i, 1));
    demo.setClaims(copy);
  }
  return (
    <>
      <div className={s.capSummary}>
        <div>
          <small>SALARY CAP REMAINING</small>
          <strong>
            ${demoLeague.salaryCapRemaining}{" "}
            <span>/ ${demoLeague.salaryCap}</span>
          </strong>
        </div>
        <div>
          <small>WEDNESDAY · 8 PM ET</small>
          <strong>{count}</strong>
          <span className={s.microcopy}>
            <Clock3 size={12} />
            DAYS : HOURS : MINUTES · SAMPLE
          </span>
        </div>
      </div>
      {demo.claims.length > 0 && (
        <div className={s.claimLedger}>
          <SectionLabel title="Pending claims">
            <span>{demo.claims.length} claims</span>
          </SectionLabel>
          {demo.claims.map((claim, i) => (
            <div
              className={s.claimRow}
              key={claim.id}
              draggable
              onDragStart={() => setDrag(claim.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => reorder(drag, claim.id)}
            >
              <GripVertical size={15} />
              <b>{i + 1}</b>
              <span>
                <strong>{claim.name}</strong>
                <small>
                  Pending · Drop{" "}
                  {demo.players.find((p) => p.id === claim.drop)?.name ??
                    "none"}
                </small>
              </span>
              <label>
                $
                <input
                  aria-label={"Edit bid for " + claim.name}
                  type="number"
                  min={0}
                  max={demoLeague.salaryCapRemaining}
                  value={claim.bid}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (
                      Number.isFinite(n) &&
                      n >= 0 &&
                      n <= demoLeague.salaryCapRemaining
                    )
                      demo.setClaims((old) =>
                        old.map((c) =>
                          c.id === claim.id ? { ...c, bid: n } : c,
                        ),
                      );
                  }}
                />
              </label>
              <button
                className={s.iconButton}
                disabled={i === 0}
                aria-label={"Raise claim priority for " + claim.name}
                onClick={() => reorder(claim.id, demo.claims[i - 1].id)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className={s.dangerButton}
                aria-label={"Cancel claim for " + claim.name}
                onClick={() => demo.cancelClaim(claim.id)}
              >
                <X size={17} />
              </button>
            </div>
          ))}
        </div>
      )}
      <Tabs
        label="Waiver eligibility"
        options={[
          "All",
          "QB",
          "RB",
          "WR",
          "TE",
          "S-FLEX",
          "FLEX",
          "PC",
          "Rookie",
        ]}
        value={position}
        onChange={(value) => {
          setPosition(value);
          setWaiverPage(0);
        }}
      />
      <label className={s.search}>
        <Search size={16} />
        <input
          aria-label="Search available players"
          placeholder="Find your next difference-maker"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setWaiverPage(0);
          }}
        />
      </label>
      <div className={s.freeAgents}>
        {list
          .slice(activePage * waiverSize, activePage * waiverSize + waiverSize)
          .map((p, i) => {
            const claim = demo.claims.find((c) => c.playerId === p.id);
            return (
              <button
                className={[s.freeAgent, claim ? s.assetSelected : ""].join(
                  " ",
                )}
                key={p.id}
                onClick={() => {
                  setSelected(p.id);
                  setBid(claim?.bid ?? 5);
                  setDrop(claim?.drop ?? "");
                }}
              >
                <b>{activePage * waiverSize + i + 1}</b>
                <Portrait id={p.id} name={p.name} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.position} · {p.team} · Age {p.age}
                    {claim && <em>{"Claim placed · $" + claim.bid}</em>}
                  </small>
                </span>
                <span className={s.freeAgentStat}>
                  <b>#{p.seasonRank}</b>
                  <small>POS RANK</small>
                </span>
                <span className={s.freeAgentStat}>
                  <b>{p.average}</b>
                  <small>AVG</small>
                </span>
                <span className={s.projection}>
                  {p.points.toFixed(1)}
                  <small>PROJ</small>
                </span>
                <Plus size={16} />
              </button>
            );
          })}
      </div>
      <Pagination
        page={activePage}
        total={list.length}
        size={waiverSize}
        onChange={setWaiverPage}
      />
      {!list.length && (
        <Empty
          title="No matching players"
          text="Try another name or eligibility filter."
        />
      )}
      {candidate && (
        <div
          className={s.claimPopover}
          role="dialog"
          aria-label={"Claim " + candidate.name}
        >
          <header>
            <h3>{candidate.name}</h3>
            <button
              aria-label="Close waiver claim"
              onClick={() => setSelected("")}
            >
              <X size={18} />
            </button>
          </header>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                !Number.isFinite(bid) ||
                bid < 0 ||
                bid > demoLeague.salaryCapRemaining
              )
                return;
              const existing = demo.claims.find(
                (c) => c.playerId === candidate.id,
              );
              if (existing)
                demo.setClaims((old) =>
                  old.map((c) =>
                    c.id === existing.id ? { ...c, bid, drop } : c,
                  ),
                );
              else
                demo.setClaims((old) => [
                  ...old,
                  {
                    id: "claim-" + candidate.id,
                    playerId: candidate.id,
                    name: candidate.name,
                    bid,
                    drop,
                  },
                ]);
              setSelected("");
              demo.notify(
                "Claim saved. Salary cap is spent only if a claim succeeds.",
              );
            }}
          >
            <label className={s.field}>
              Salary cap bid
              <input
                type="number"
                required
                min={0}
                max={demoLeague.salaryCapRemaining}
                value={bid}
                onChange={(e) => setBid(e.target.valueAsNumber)}
              />
            </label>
            <label className={s.field}>
              Conditional drop
              <select value={drop} onChange={(e) => setDrop(e.target.value)}>
                <option value="">No drop selected</option>
                {demo.players
                  .filter((p) => p.group === "Subs")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <button className={s.primary}>
              Save claim
              <Check size={15} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
export function Transactions() {
  const { transactions } = useDemo();
  const [tab, setTab] = useState("All");
  const list = transactions.filter(
    (t) =>
      t.status !== "Pending" &&
      (tab === "All" || t.type === (tab === "Trades" ? "Trade" : "Waiver")),
  );
  return (
    <>
      <Tabs
        label="Transaction history"
        options={["All", "Trades", "Waivers"]}
        value={tab}
        onChange={setTab}
      />
      {list.map((t) => (
        <EventRow
          key={t.id}
          title={t.title}
          detail={t.detail}
          tag={t.date + " · " + t.status.toUpperCase()}
        />
      ))}
      {!list.length && (
        <Empty
          title="No completed moves"
          text="Active negotiations and claims remain in Trades and Waivers."
        />
      )}
    </>
  );
}
