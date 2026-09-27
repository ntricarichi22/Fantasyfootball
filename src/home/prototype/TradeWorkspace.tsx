"use client";
import { useState } from "react";
import {
  ArrowLeftRight,
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";
import { useDemo } from "./DemoState";
import { Crest, Portrait, Tabs, Pagination, Empty } from "./UI";
import { previewPicks } from "./pickAssets";
import { teams, type Transaction } from "./model";
import s from "./Prototype.module.css";
type Asset = {
  id: string;
  name: string;
  meta: string;
  position: string;
  portrait?: string;
};
const picks = previewPicks;
const partnerPlayers: Record<string, string[][]> = {
  Wingmen: [
    ["Lamar Jackson", "QB", "BAL"],
    ["Jared Goff", "QB", "DET"],
    ["Jonathan Taylor", "RB", "IND"],
    ["CeeDee Lamb", "WR", "DAL"],
    ["A.J. Brown", "WR", "PHI"],
    ["Kyren Williams", "RB", "LAR"],
    ["DeVonta Smith", "WR", "PHI"],
    ["Sam LaPorta", "TE", "DET"],
    ["George Kittle", "TE", "SF"],
  ],
  Browns: [
    ["Joe Burrow", "QB", "CIN"],
    ["Baker Mayfield", "QB", "TB"],
    ["Jahmyr Gibbs", "RB", "DET"],
    ["Drake London", "WR", "ATL"],
    ["Nico Collins", "WR", "HOU"],
    ["Brock Bowers", "TE", "LV"],
    ["Chase Brown", "RB", "CIN"],
  ],
  Destroyers: [
    ["Jalen Hurts", "QB", "PHI"],
    ["Justin Herbert", "QB", "LAC"],
    ["Saquon Barkley", "RB", "PHI"],
    ["Ja’Marr Chase", "WR", "CIN"],
    ["Puka Nacua", "WR", "LAR"],
    ["Ladd McConkey", "WR", "LAC"],
    ["Tucker Kraft", "TE", "GB"],
  ],
};
const rosterFor = (team: string): Asset[] => [
  ...(partnerPlayers[team] ?? []).map(([name, position, nfl], i) => ({
    id: team + "-" + i,
    name,
    position,
    meta: position + " · " + nfl,
  })),
  ...picks(team),
];
function TeamName({ name, crest }: { name: string; crest?: string }) {
  return (
    <span className={s.teamLabel}>
      <Crest
        name={name}
        crest={crest ?? teams.find((t) => t.name === name)?.crest}
        size={32}
      />
      <strong>{name}</strong>
    </span>
  );
}
export function TransactionLedger({
  list,
  actions,
}: {
  list: Transaction[];
  actions?: boolean;
}) {
  const demo = useDemo();
  return (
    <div className={s.transactionLedger}>
      <div className={s.ledgerHeader}>
        <span>TRANSACTION / ROSTER EFFECT</span>
        <span>STATUS</span>
        <span>AMOUNT</span>
        <span>DATE</span>
      </div>
      {list.map((t) => {
        const status =
          t.type === "Waiver"
            ? ((
                {
                  Successful: "Won",
                  Lost: "Outbid",
                  Withdrawn: "Cancelled",
                } as Record<string, string>
              )[t.status] ?? t.status)
            : t.status === "Rejected"
              ? "Declined"
              : t.status;
        const success = ["Accepted", "Successful"].includes(t.status);
        const team = teams.find((team) => t.title.includes(team.name));
        return (
          <article className={s.ledgerRow} key={t.id}>
            <div className={s.ledgerDescription}>
              {team ? (
                <Crest name={team.name} crest={team.crest} size={30} />
              ) : (
                <ArrowLeftRight size={20} />
              )}
              <div>
                <strong>{t.title}</strong>
                <small>{t.detail}</small>
                {t.note && <p>{t.note}</p>}
                {!success && t.status !== "Pending" && (
                  <em>
                    No roster change{t.type === "Waiver" ? " · $0 spent" : ""}
                  </em>
                )}
              </div>
            </div>
            <span
              className={s.transactionStatus}
              data-result={
                success
                  ? "success"
                  : t.status === "Pending"
                    ? "pending"
                    : "closed"
              }
            >
              {status}
            </span>
            <span className={s.ledgerAmount}>
              {t.bid !== undefined ? "$" + t.bid : "—"}
              {t.bid !== undefined && (
                <small>{success ? "SPENT" : "BID"}</small>
              )}
            </span>
            <time>{t.date}</time>
            {actions && (
              <div className={s.ledgerActions}>
                {(["Accepted", "Rejected", "Withdrawn"] as const).map(
                  (status) => (
                    <button
                      key={status}
                      onClick={() =>
                        demo.setTransactions((old) =>
                          old.map((x) =>
                            x.id === t.id ? { ...x, status } : x,
                          ),
                        )
                      }
                    >
                      {status === "Accepted"
                        ? "Accept"
                        : status === "Rejected"
                          ? "Decline"
                          : "Withdraw"}
                    </button>
                  ),
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
export function Trades({ task }: { task: string }) {
  const demo = useDemo();
  const [mode, setMode] = useState("Build it myself");
  const [partner, setPartner] = useState("");
  const [partnerPicker, setPartnerPicker] = useState(false);
  const [browse, setBrowse] = useState("Your roster");
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [send, setSend] = useState<string[]>([]);
  const [receive, setReceive] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitted, setSubmitted] = useState("");
  const shop = demo.shopSelection,
    setShop = demo.setShopSelection;
  const [shopPage, setShopPage] = useState(0);
  const offers = demo.shopOffers,
    setOffers = demo.setShopOffers;
  const [offerIndex, setOfferIndex] = useState(0);
  const [saved, setSaved] = useState<string[]>([]);
  const own: Asset[] = [
    ...demo.players.map((p) => ({
      id: p.id,
      name: p.name,
      meta: p.position + " · " + p.team,
      position: p.position,
      portrait: p.id,
    })),
    ...picks("own"),
  ];
  const other = rosterFor(partner);
  const items = browse === "Your roster" ? own : other;
  const selection = browse === "Your roster" ? send : receive;
  const visible = items.filter(
    (a) =>
      (filter === "All" ||
        a.position === filter ||
        (filter === "PCs" && ["WR", "TE"].includes(a.position))) &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );
  const names = (ids: string[], source: Asset[]) =>
    ids
      .map((id) => {
        const asset = source.find((a) => a.id === id);
        return asset
          ? asset.name + (asset.position === "Picks" ? " " + asset.meta : "")
          : id;
      })
      .join(" + ");
  function toggle(id: string) {
    const update = browse === "Your roster" ? setSend : setReceive;
    update((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  }
  function saveOffer(title: string, detail: string, key: string) {
    demo.addTransaction({
      title,
      detail,
      type: "Trade",
      status: "Pending",
      note: note.trim(),
    });
    setSaved((old) => [...old, key]);
    demo.notify("Trade proposed · local sample only");
  }
  function choosePartner(name: string) {
    setPartner(name);
    setReceive([]);
    setBrowse("Their roster");
    setPartnerPicker(false);
    setSearch("");
    setFilter("All");
  }
  function renderDealSide(ids: string[], source: Asset[], outgoing: boolean) {
    return (
      <div className={s.dealAssets}>
        {ids.length ? (
          ids.map((id) => {
            const a = source.find((a) => a.id === id);
            return a ? (
              <div key={id}>
                {a.portrait ? (
                  <Portrait id={a.portrait} name={a.name} />
                ) : (
                  <span className={s.assetToken}>
                    {a.position === "Picks" ? "RD" : a.position}
                  </span>
                )}
                <span>
                  <strong>{a.name}</strong>
                  <small>{a.meta}</small>
                </span>
                <button
                  aria-label={"Remove " + a.name}
                  onClick={() =>
                    outgoing
                      ? setSend(send.filter((x) => x !== id))
                      : setReceive(receive.filter((x) => x !== id))
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ) : null;
          })
        ) : (
          <button
            className={s.addToDeal}
            onClick={() => {
              if (!outgoing && !partner) setPartnerPicker(true);
              else {
                setBrowse(outgoing ? "Your roster" : "Their roster");
                setFilter("All");
                setSearch("");
              }
            }}
          >
            <Plus size={22} />
            <span>
              {outgoing ? "Add from your roster" : "Add from their roster"}
            </span>
          </button>
        )}
      </div>
    );
  }
  function carousel(shopping: boolean) {
    const team = ["Wingmen", "Browns", "Destroyers"][offerIndex];
    const offerKey =
      (shopping ? "shop:" + shop.join(",") : "chat:" + submitted) +
      ":" +
      offerIndex;
    const offered = shopping ? names(shop, own) : "James Cook";
    const returns = [
      "2027 Rd 1 (own pick) + 2028 Rd 2 (own pick)",
      "Drake London",
      "2027 Rd 1 (own pick) + 2027 Rd 3 (own pick)",
    ][offerIndex];
    return (
      <div className={s.offerCarousel} aria-label="Sample trade offers">
        <div className={s.offerCarouselTop}>
          <span>SAMPLE OFFER {offerIndex + 1} / 3</span>
          <div>
            <button
              aria-label="Previous offer"
              onClick={() => setOfferIndex((offerIndex + 2) % 3)}
            >
              <ArrowLeft size={18} />
            </button>
            <button
              aria-label="Next offer"
              onClick={() => setOfferIndex((offerIndex + 1) % 3)}
            >
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
        <div className={s.offerTeams}>
          <section>
            <TeamName name={demo.identity.name} crest={demo.identity.crest} />
            <small>YOU SEND</small>
            <h3>{offered}</h3>
          </section>
          <ArrowLeftRight size={28} />
          <section>
            <TeamName name={team} />
            <small>YOU RECEIVE</small>
            <h3>{returns}</h3>
          </section>
        </div>
        <div className={s.offerFooter}>
          <p>Illustrative proposal · review format and flow</p>
          <button
            className={s.primary}
            disabled={saved.includes(offerKey)}
            onClick={() =>
              saveOffer(
                "Discussion with the " + team,
                offered + " for " + returns,
                offerKey,
              )
            }
          >
            {saved.includes(offerKey) ? "Proposed" : "Propose trade"}
            <Check size={16} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.tradeWorkspace}>
      <div hidden={task !== "build"} className={s.buildWorkspace}>
        <Tabs
          label="Build trade method"
          options={["Build it myself", "Describe the deal"]}
          value={mode}
          onChange={setMode}
        />
        {mode === "Build it myself" ? (
          <div className={s.tradeBuilderGrid}>
            <section className={s.dealBoard}>
              <div className={s.dealColumns}>
                <section>
                  <header>
                    <small>YOU SEND</small>
                    <TeamName
                      name={demo.identity.name}
                      crest={demo.identity.crest}
                    />
                  </header>
                  {renderDealSide(send, own, true)}
                </section>
                <section>
                  <header>
                    <small>YOU RECEIVE</small>
                    <button
                      className={s.partnerButton}
                      onClick={() => setPartnerPicker(!partnerPicker)}
                      aria-expanded={partnerPicker}
                    >
                      {partner ? (
                        <TeamName name={partner} />
                      ) : (
                        <>
                          <Plus size={20} />
                          Select your trade partner
                        </>
                      )}
                    </button>
                    {partnerPicker && (
                      <div className={s.partnerPicker}>
                        {Object.keys(partnerPlayers).map((name) => (
                          <button
                            key={name}
                            onClick={() => choosePartner(name)}
                          >
                            <TeamName name={name} />
                            <ArrowRight size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </header>
                  {renderDealSide(receive, other, false)}
                </section>
              </div>
              <footer className={s.dealFooter}>
                <label className={s.field}>
                  Offer note
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add context for the other GM"
                  />
                </label>
                <button
                  className={s.primary}
                  disabled={!partner || !send.length || !receive.length}
                  onClick={() =>
                    saveOffer(
                      "Offer to the " + partner,
                      names(send, own) + " for " + names(receive, other),
                      "manual",
                    )
                  }
                >
                  Save offer
                  <Send size={16} />
                </button>
              </footer>
            </section>
            <section
              className={s.rosterBrowser}
              aria-label="Trade roster browser"
            >
              <Tabs
                label="Browse team"
                options={["Your roster", "Their roster"]}
                value={browse}
                onChange={(v) => {
                  setBrowse(v);
                  setSearch("");
                }}
              />
              <div className={s.rosterSearch}>
                <Search size={16} />
                <input
                  aria-label="Search trade assets"
                  placeholder="Search players or draft picks"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Tabs
                label="Asset type"
                options={["All", "QB", "RB", "PCs", "Picks"]}
                value={filter}
                onChange={setFilter}
              />
              <div className={s.tradeAssetList}>
                {browse === "Their roster" && !partner ? (
                  <button
                    className={s.addToDeal}
                    onClick={() => setPartnerPicker(true)}
                  >
                    Select a trade partner to browse their roster
                  </button>
                ) : (
                  visible.map((a) => (
                    <button
                      key={a.id}
                      className={s.tradeAssetRow}
                      aria-pressed={selection.includes(a.id)}
                      onClick={() => toggle(a.id)}
                    >
                      {a.portrait ? (
                        <Portrait id={a.portrait} name={a.name} />
                      ) : (
                        <span className={s.assetToken}>
                          {a.position === "Picks" ? "RD" : a.position}
                        </span>
                      )}
                      <span>
                        <strong>{a.name}</strong>
                        <small>{a.meta}</small>
                      </span>
                      <span className={s.checkBox}>
                        {selection.includes(a.id) ? (
                          <Check size={14} />
                        ) : (
                          <Plus size={14} />
                        )}
                      </span>
                    </button>
                  ))
                )}
                {!visible.length && (browse === "Your roster" || partner) && (
                  <p className={s.subtle}>No matching assets</p>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className={s.chatTrade}>
            {submitted && (
              <div className={s.chatBubble}>
                <span>YOU</span>
                <p>{submitted}</p>
              </div>
            )}
            <form
              className={s.chatComposer}
              onSubmit={(e) => {
                e.preventDefault();
                if (prompt.trim()) {
                  setSubmitted(prompt.trim());
                  setPrompt("");
                  setOfferIndex(0);
                }
              }}
            >
              <p id="trade-prompt-help" className={s.tradePromptHelp}>
                Name a player or pick, or describe your goal: a young receiver,
                more draft picks, or help at a position.
              </p>
              <label htmlFor="trade-prompt">
                What move do you have in mind?
              </label>
              <div>
                <input
                  id="trade-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Shop James Cook, move my 2027 1st, or find a young receiver…"
                  aria-describedby="trade-prompt-help"
                />
                <button
                  className={s.primary}
                  disabled={!prompt.trim()}
                  aria-label="Preview offers"
                >
                  <Send size={18} />
                </button>
              </div>
              <small>
                Sample conversation · scripted proposals for design review
              </small>
            </form>
            {submitted && carousel(false)}
          </div>
        )}
      </div>
      <div hidden={task !== "shop"} className={s.shopWorkspace}>
        {offers ? (
          <>{carousel(true)}</>
        ) : (
          <>
            <div className={s.workspaceTools}>
              <span>Choose the players and picks you want to shop.</span>
              <b>{shop.length} selected</b>
            </div>
            <div className={s.shopGrid}>
              {own.slice(shopPage * 9, shopPage * 9 + 9).map((p) => (
                <button
                  className={s.shopPlayer}
                  key={p.id}
                  aria-pressed={shop.includes(p.id)}
                  onClick={() =>
                    setShop((old) =>
                      old.includes(p.id)
                        ? old.filter((x) => x !== p.id)
                        : [...old, p.id],
                    )
                  }
                >
                  {p.portrait ? (
                    <Portrait id={p.portrait} name={p.name} />
                  ) : (
                    <span className={s.assetToken}>RD</span>
                  )}
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.meta}</small>
                  </span>
                  <span className={s.checkBox}>
                    {shop.includes(p.id) && <Check size={13} />}
                  </span>
                </button>
              ))}
            </div>
            <Pagination
              page={shopPage}
              total={own.length}
              size={9}
              onChange={setShopPage}
            />
            <button
              className={s.primary}
              disabled={!shop.length}
              onClick={() => {
                setOffers(true);
                setOfferIndex(0);
              }}
            >
              Preview trade offers
              <ArrowRight size={16} />
            </button>
          </>
        )}
      </div>
      <div hidden={task !== "negotiations"}>
        <TransactionLedger
          list={demo.transactions.filter(
            (t) => t.type === "Trade" && t.status === "Pending",
          )}
          actions
        />
        {!demo.transactions.some(
          (t) => t.type === "Trade" && t.status === "Pending",
        ) && (
          <Empty
            title="No open negotiations"
            text="Build an offer or shop players to start a discussion."
          />
        )}
      </div>
    </div>
  );
}
