"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  GripVertical,
  Plus,
  Search,
  X,
} from "lucide-react";
import { PickCrest } from "./PickCrest";
import { previewPicks, assetDisplayName } from "./pickAssets";
import {
  priceText,
  defaultPrice,
  priceDollars,
  formatDollars,
  type PickPrice,
} from "./playerMetrics";
import { PlayerBadges, PriceControls } from "./PlayerDossier";
export { Draft } from "./DraftWorkspace";
export { Trades } from "./TradeWorkspace";
import { TransactionHistory } from "./TransactionHistory";
import { useDemo } from "./DemoState";
import { demoLeague } from "./leagueFixture";
import { slotEligibility } from "@/shared/team-profiles/strength";
import { freeAgents, type Availability } from "./model";
import { Empty, Portrait, SectionLabel, Tabs } from "./UI";
import s from "./Prototype.module.css";
const capital = previewPicks();
const pickAssets = capital.map((p) => p.name);
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
  const [pickPrices, setPickPrices] = useState<Record<string, PickPrice>>({});
  const pickDialog = useRef<HTMLDialogElement>(null);
  const list = demo.players.filter((p) =>
    room === "Pass Catchers"
      ? ["WR", "TE"].includes(p.position)
      : p.position === room,
  );
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
  useEffect(() => {
    if (selected && picks) pickDialog.current?.showModal();
    else pickDialog.current?.close();
  }, [selected, picks]);
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
        options={[
          "Quarterbacks",
          "Running Backs",
          "Pass Catchers",
          "Draft Picks",
        ]}
        value={
          room === "QB"
            ? "Quarterbacks"
            : room === "RB"
              ? "Running Backs"
              : room
        }
        onChange={(r) => {
          setRoom(
            r === "Quarterbacks" ? "QB" : r === "Running Backs" ? "RB" : r,
          );
          setSelected("");
        }}
      />
      <div className={s.strategyGrid}>
        <section>
          <SectionLabel title={picks ? "Your draft capital" : "In the room"}>
            <span>{picks ? pickAssets.length : list.length} assets</span>
          </SectionLabel>
          <div className={s.strategyPlayers}>
            {picks
              ? pickAssets.map((pick) => (
                  <button
                    className={[
                      s.assetRow,
                      selected === pick ? s.assetSelected : "",
                    ].join(" ")}
                    key={pick}
                    onClick={() => {
                      setSelected(pick);
                    }}
                  >
                    <PickCrest asset={capital.find((p) => p.name === pick)!} />
                    <span>
                      <strong>
                        {assetDisplayName(
                          capital.find((p) => p.name === pick)!,
                        )}
                      </strong>
                      <small>
                        {demo.pickSettings[pick]?.availability ?? "Listening"}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))
              : list.map((p) => (
                  <button
                    className={[s.assetRow, s.strategyAsset].join(" ")}
                    key={p.id}
                    onClick={() => {
                      demo.openPlayer(p.id);
                    }}
                  >
                    <Portrait id={p.id} name={p.name} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.position} · {p.team}
                      </small>
                    </span>
                    <PlayerBadges player={p} />
                    <span className={s.assetValuation}>
                      <strong>
                        {formatDollars(
                          priceDollars(
                            demo.playerPrices[p.id] ?? defaultPrice(p),
                          ),
                        )}
                      </strong>
                      <small>{p.availability}</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
          </div>

          <dialog
            aria-label="Draft pick settings"
            ref={pickDialog}
            className={s.dialog}
            onCancel={() => setSelected("")}
            onClose={() => setSelected("")}
          >
            {selected && settings && picks && (
              <>
                <header>
                  <span>YOUR DRAFT CAPITAL</span>
                  <button
                    aria-label="Close pick settings"
                    onClick={() => setSelected("")}
                  >
                    <X size={18} />
                  </button>
                </header>
                <h2 className={s.pickModalTitle}>
                  {assetDisplayName(capital.find((p) => p.name === selected)!)}
                </h2>
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
                <div className={s.priceHeading}>
                  <strong>Your asking price</strong>
                  <span>
                    {priceText(
                      pickPrices[selected] ?? {
                        firsts: 1,
                        seconds: 0,
                        thirds: 0,
                      },
                    )}
                  </span>
                </div>
                <PriceControls
                  value={
                    pickPrices[selected] ?? { firsts: 1, seconds: 0, thirds: 0 }
                  }
                  onChange={(next) => {
                    setPickPrices((old) => ({ ...old, [selected]: next }));
                    updateSettings("asking", priceText(next));
                  }}
                />
              </>
            )}
          </dialog>
        </section>
        <aside className={s.needsPanel}>
          <h3>HOW DOES THIS ROOM LOOK?</h3>

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
            <div className={s.needOptions}>
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
            </div>
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

export function Waivers() {
  const demo = useDemo();
  const [position, setPosition] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [bid, setBid] = useState(5);
  const [drop, setDrop] = useState("");
  const [drag, setDrag] = useState("");
  const codes: Record<string, string> = {
    QBs: "QB",
    RBs: "RB",
    WRs: "WR",
    TEs: "TE",
    "S-FLEX": "SUPER_FLEX",
    PCs: "REC_FLEX",
  };
  const valid = slotEligibility(codes[position] ?? position);
  const list = freeAgents.filter(
    (p) =>
      (position === "All" ||
        (position === "Rookies" && p.rookie) ||
        valid?.includes(p.position as "QB" | "RB" | "WR" | "TE")) &&
      p.name.toLowerCase().includes(query.toLowerCase()),
  );
  const candidate = freeAgents.find((p) => p.id === selected);
  function reorder(a: string, b: string) {
    const copy = [...demo.claims],
      i = copy.findIndex((c) => c.id === a),
      j = copy.findIndex((c) => c.id === b);
    if (i < 0 || j < 0) return;
    copy.splice(j, 0, ...copy.splice(i, 1));
    demo.setClaims(copy);
  }
  return (
    <div className={s.waiverLayout} data-has-claims={true}>
      <section className={s.waiverPool}>
        <Tabs
          label="Waiver eligibility"
          options={[
            "All",
            "QBs",
            "RBs",
            "WRs",
            "TEs",
            "S-FLEX",
            "FLEX",
            "PCs",
            "Rookies",
          ]}
          value={position}
          onChange={(value) => {
            setPosition(value);
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
            }}
          />
        </label>
        <div className={s.freeAgents}>
          {list.map((p, i) => {
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
                <b>{i + 1}</b>
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
        {!list.length && (
          <Empty
            title="No matching players"
            text="Try another name or eligibility filter."
          />
        )}
      </section>
      <aside className={s.claimLedger}>
        <SectionLabel title="Pending claims">
          <span>{demo.claims.length} claims</span>
        </SectionLabel>
        <div className={s.claimRows}>
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
                  Drop{" "}
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
      </aside>
    </div>
  );
}
export function Transactions() {
  const { transactions } = useDemo();
  const [tab, setTab] = useState("All");
  const list = transactions
    .filter(
      (t) =>
        t.status !== "Pending" &&
        (tab === "All" ||
          (tab === "Adds / Drops"
            ? ["Waiver", "Add", "Drop"].includes(t.type)
            : t.type === "Trade")),
    )
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  return (
    <>
      <Tabs
        label="Transaction history"
        options={["All", "Trades", "Adds / Drops"]}
        value={tab}
        onChange={setTab}
      />
      <TransactionHistory list={list} />
      {!list.length && (
        <Empty
          title="No completed moves"
          text="Active negotiations and claims remain in Trades and Waivers."
        />
      )}
    </>
  );
}
