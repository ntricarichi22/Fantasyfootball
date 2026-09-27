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
import { Crest, Portrait, Tabs, Empty } from "./UI";
import { ShopSelection } from "./ShopSelection";
import { PickCrest } from "./PickCrest";
import { previewPicks, assetDisplayName, assetDetail } from "./pickAssets";
import { teams, type Transaction, type TransactionAsset } from "./model";
import s from "./Prototype.module.css";
type Asset = {
  id: string;
  name: string;
  meta: string;
  position: string;
  portrait?: string;
  originTeam?: string;
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
    portrait: "rookie-" + team + "-" + i,
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
  onOpen,
}: {
  list: Transaction[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className={s.transactionLedger}>
      <div className={s.ledgerHeader}>
        <span>TRANSACTION / ROSTER EFFECT</span>
        <span>STATUS</span>
        <span>AMOUNT</span>
        <span>DATE</span>
      </div>
      {list.map((t) => (
        <button
          className={s.ledgerRow}
          key={t.id}
          onClick={() => onOpen(t.id)}
          aria-label={"Open " + t.title}
        >
          <span className={s.ledgerDescription}>
            <Crest
              name={t.partner ?? "Trade partner"}
              crest={teams.find((team) => team.name === t.partner)?.crest}
              size={30}
            />
            <span>
              <strong>{t.title}</strong>
              <small>{t.detail}</small>
            </span>
          </span>
          <span className={s.transactionStatus} data-result="pending">
            Pending
          </span>
          <span className={s.ledgerAmount}>—</span>
          <time>{t.date}</time>
        </button>
      ))}
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
  const shop = demo.shopSelection;
  const [negotiationId, setNegotiationId] = useState("");
  const [countering, setCountering] = useState(false);
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
  const negotiation = demo.transactions.find(
    (t) => t.id === negotiationId && t.status === "Pending",
  );
  const other = rosterFor(partner);
  const items = browse === "Your roster" ? own : other;
  const selection = browse === "Your roster" ? send : receive;
  const visible = items.filter(
    (a) =>
      (filter === "All" ||
        a.position ===
          (({ QBs: "QB", RBs: "RB" } as Record<string, string>)[filter] ??
            filter) ||
        (filter === "PCs" && ["WR", "TE"].includes(a.position))) &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );
  const names = (ids: string[], source: Asset[]) =>
    ids
      .map((id) => {
        const asset = source.find((a) => a.id === id);
        return asset
          ? asset.name +
              (asset.position === "Picks" && asset.meta ? " " + asset.meta : "")
          : id;
      })
      .join(" + ");
  function toggle(id: string) {
    const update = browse === "Your roster" ? setSend : setReceive;
    update((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  }
  function saveOffer(
    title: string,
    detail: string,
    key: string,
    team: string,
    outgoing: TransactionAsset[],
    incoming: TransactionAsset[],
  ) {
    demo.addTransaction({
      title,
      detail,
      type: "Trade",
      status: "Pending",
      note: note.trim(),
      partner: team,
      direction: "sent",
      received: incoming,
      sent: outgoing,
    });
    setSaved((old) => [...old, key]);
    demo.notify("Trade proposed · local sample only");
  }
  function resolveNegotiation(status: "Accepted" | "Rejected" | "Withdrawn") {
    demo.setTransactions((old) =>
      old.map((t) =>
        t.id === negotiationId
          ? {
              ...t,
              status,
              actor: "you",
              date: "Just now",
              resolvedAt: Date.now(),
            }
          : t,
      ),
    );
    setNegotiationId("");
    setCountering(false);
  }
  function counterOffer() {
    if (!negotiation?.partner) return;
    const team = negotiation.partner;
    setPartner(team);
    setSend(
      own
        .filter((a) => negotiation.sent?.some((t) => t.name === a.name))
        .map((a) => a.id),
    );
    setReceive(
      rosterFor(team)
        .filter((a) => negotiation.received?.some((t) => t.name === a.name))
        .map((a) => a.id),
    );
    setNote(negotiation.note ?? "");
    setBrowse("Your roster");
    setFilter("All");
    setSearch("");
    setMode("Build it myself");
    setCountering(true);
  }
  function submitManualOffer() {
    const outgoing = own.filter((a) => send.includes(a.id)),
      incoming = other.filter((a) => receive.includes(a.id));
    const detail = names(send, own) + " for " + names(receive, other);
    if (task === "negotiations" && countering && negotiation) {
      demo.setTransactions((old) =>
        old.map((t) =>
          t.id === negotiationId
            ? {
                ...t,
                title: "Counteroffer to the " + partner,
                detail,
                partner,
                sent: outgoing,
                received: incoming,
                note: note.trim(),
                direction: "sent",
                date: "Just now",
              }
            : t,
        ),
      );
      setCountering(false);
      demo.notify("Counteroffer saved · local sample only");
    } else
      saveOffer(
        "Offer to the " + partner,
        detail,
        "manual",
        partner,
        outgoing,
        incoming,
      );
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
                  <PickCrest asset={a} owner={outgoing ? "own" : partner} />
                )}
                <span>
                  <strong>{assetDisplayName(a)}</strong>
                  <small>{assetDetail(a)}</small>
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
    const outgoing = own.filter((a) =>
      shopping ? shop.includes(a.id) : a.id === "cook",
    );
    const partnerAssets = rosterFor(team);
    const incoming =
      offerIndex === 1
        ? partnerAssets.filter((a) => a.name === "Drake London")
        : partnerAssets.filter(
            (a) =>
              a.name === "2027 Rd 1" ||
              a.name === (offerIndex === 0 ? "2028 Rd 2" : "2027 Rd 3"),
          );
    const offered = names(
      outgoing.map((a) => a.id),
      outgoing,
    );
    const returns = names(
      incoming.map((a) => a.id),
      incoming,
    );
    function offerAssets(assets: Asset[]) {
      return (
        <div className={s.offerAssetStack}>
          {assets.map((a) => (
            <div className={s.offerAsset} key={a.id}>
              {a.position === "Picks" ? (
                <PickCrest asset={a} />
              ) : (
                <Portrait id={a.portrait ?? "rookie-" + a.id} name={a.name} />
              )}
              <span>
                <strong>{assetDisplayName(a)}</strong>
                {assetDetail(a) && <small>{assetDetail(a)}</small>}
              </span>
            </div>
          ))}
        </div>
      );
    }
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
        <div className={s.offerTeamHeaders}>
          <TeamName name={demo.identity.name} crest={demo.identity.crest} />
          <TeamName name={team} />
        </div>
        <div className={s.offerTeams}>
          <section>
            <small>YOU SEND</small>
            {offerAssets(outgoing)}
          </section>
          <ArrowLeftRight size={28} />
          <section>
            <small>YOU RECEIVE</small>
            {offerAssets(incoming)}
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
                team,
                outgoing,
                incoming,
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
  if (task === "negotiations" && negotiation && !countering) {
    const assetRows = (assets: TransactionAsset[], owner: string) => (
      <div className={s.dealAssets}>
        {assets.map((a, i) => (
          <div key={a.name + i}>
            {a.portrait ? (
              <Portrait id={a.portrait} name={a.name} />
            ) : a.name.includes("Rd ") ? (
              <PickCrest asset={a} owner={owner} />
            ) : (
              <span className={s.assetToken} />
            )}
            <span>
              <strong>{assetDisplayName(a)}</strong>
              {assetDetail(a) && <small>{assetDetail(a)}</small>}
            </span>
          </div>
        ))}
      </div>
    );
    return (
      <div className={s.negotiationDetail}>
        <button className={s.textButton} onClick={() => setNegotiationId("")}>
          <ArrowLeft size={15} />
          All negotiations
        </button>
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
              {assetRows(negotiation.sent ?? [], "own")}
            </section>
            <section>
              <header>
                <small>YOU RECEIVE</small>
                <TeamName name={negotiation.partner ?? "Trade partner"} />
              </header>
              {assetRows(
                negotiation.received ?? [],
                negotiation.partner ?? "Trade partner",
              )}
            </section>
          </div>
          <footer className={s.negotiationActions}>
            {negotiation.note && <p>{negotiation.note}</p>}
            {negotiation.direction === "sent" ? (
              <button
                className={s.secondary}
                onClick={() => resolveNegotiation("Withdrawn")}
              >
                Withdraw
              </button>
            ) : (
              <>
                <button
                  className={s.primary}
                  onClick={() => resolveNegotiation("Accepted")}
                >
                  Accept
                </button>
                <button
                  className={s.secondary}
                  onClick={() => resolveNegotiation("Rejected")}
                >
                  Decline
                </button>
                <button className={s.secondary} onClick={counterOffer}>
                  Counter
                </button>
              </>
            )}
          </footer>
        </section>
      </div>
    );
  }
  return (
    <div className={s.tradeWorkspace}>
      <div
        hidden={task !== "build" && !(task === "negotiations" && countering)}
        className={s.buildWorkspace}
      >
        {task === "negotiations" && countering && (
          <button className={s.textButton} onClick={() => setCountering(false)}>
            <ArrowLeft size={15} />
            Back to offer
          </button>
        )}
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
                  onClick={submitManualOffer}
                >
                  {task === "negotiations" && countering
                    ? "Send counteroffer"
                    : "Send it"}
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
                options={["All", "QBs", "RBs", "PCs", "Picks"]}
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
                        <PickCrest
                          asset={a}
                          owner={browse === "Your roster" ? "own" : partner}
                        />
                      )}
                      <span>
                        <strong>{assetDisplayName(a)}</strong>
                        <small>{assetDetail(a)}</small>
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
              <label htmlFor="trade-prompt">
                What move do you have in mind?
              </label>
              <div>
                <input
                  id="trade-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Shop James Cook, move my 2027 1st, or find a young receiver…"
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
            <ShopSelection />
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
      <div hidden={task !== "negotiations" || countering}>
        <TransactionLedger
          list={demo.transactions.filter(
            (t) => t.type === "Trade" && t.status === "Pending",
          )}
          onOpen={(id) => {
            setNegotiationId(id);
            setCountering(false);
          }}
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
