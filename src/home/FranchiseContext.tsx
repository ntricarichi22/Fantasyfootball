"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, ClipboardList, Flag, Shield, TrendingUp } from "lucide-react";
import styles from "./FranchiseHome.module.css";

type Props = { scene: string; preview: boolean; onOpen: (title: string) => void };

// Deliberately illustrative. This module never requests or presents live league data.
const lineup = [
  { slot: "QB", name: "Josh Allen", detail: "Quarterback", points: "24.6" },
  { slot: "RB", name: "Bijan Robinson", detail: "Running back", points: "18.2" },
  { slot: "WR", name: "Justin Jefferson", detail: "Wide receiver", points: "19.4" },
  { slot: "TE", name: "Trey McBride", detail: "Tight end", points: "13.1" },
];
const assets = [
  { slot: "QB", name: "Josh Allen", tag: "Core player" },
  { slot: "RB", name: "Bijan Robinson", tag: "Core player" },
  { slot: "WR", name: "Justin Jefferson", tag: "Listening to offers" },
];
const standings = [
  { name: "Virginia Founders", short: "Founders", crest: "founders", record: "3–0", points: "392.4" },
  { name: "Browns", short: "Browns", crest: "browns", record: "2–1", points: "376.8" },
  { name: "Wingmen", short: "Wingmen", crest: "wingmen", record: "2–1", points: "361.2" },
  { name: "Destroyers", short: "Destroyers", crest: "destroyers", record: "1–2", points: "344.7" },
];

export function FranchiseContext({ scene, preview, onOpen }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [assetView, setAssetView] = useState<"roster" | "picks">("roster");
  const title = scene === "coach" ? "This week’s matchup" : scene === "gm" ? "Your franchise assets" : "Around the league";
  const summary = scene === "coach" ? "Founders vs Wingmen" : scene === "gm" ? "Contending · 6 draft picks" : "Founders · 1st in the league";
  if (!preview) {
    return <aside className={styles.context} aria-label={title}>
      <div className={styles.contextHeader}><h3>{title}</h3><span className={styles.sampleTag}>COMING SOON</span></div>
      <div className={styles.emptyContext}><Shield size={36} strokeWidth={1.2} /><h4>Your franchise, in focus.</h4><p>{scene === "coach" ? "Your weekly matchup and lineup will appear here once the in-season workspace is connected." : scene === "gm" ? "A roster and draft-capital summary will appear here once this view is connected. Your existing tools are available in the menu." : "League standings and owner decisions will appear here once the league overview is connected."}</p></div>
    </aside>;
  }
  return <aside className={styles.context} aria-label={title + " — sample data"}>
    <div className={styles.contextHeader}><h3>{title}</h3><span className={styles.sampleTag}>SAMPLE DATA</span></div>
    <div className={styles.mobileSummary}>
      <div><span>{scene === "coach" ? "WEEK 4 MATCHUP" : scene === "gm" ? "TEAM DIRECTION" : "LEAGUE SNAPSHOT"}</span><strong>{summary}</strong></div>
      <button type="button" aria-expanded={expanded} aria-controls={"detail-" + scene} aria-label={expanded ? "Collapse sample details" : "Expand sample details"} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
    </div>
    <div id={"detail-" + scene} className={[styles.contextDetails, expanded ? styles.detailsExpanded : ""].join(" ")}>
      {scene === "coach" ? <>
        <div className={styles.matchupMeta}><span>WEEK 4 <span>·</span> HALF PPR</span><span>Projected points</span></div>
        <div className={styles.matchupScore}>
          <div><Image src="/teams/founders.png" width={42} height={42} alt="" /><span>FOUNDERS</span><strong>124<span>.8</span></strong><small>3–0 <span>·</span> YOUR TEAM</small></div>
          <span className={styles.versus}>VS</span>
          <div><Image src="/teams/wingmen.png" width={42} height={42} alt="" /><span>WINGMEN</span><strong>118<span>.3</span></strong><small>2–1 <span>·</span> OPPONENT</small></div>
        </div>
        <div className={styles.projectionBar} aria-hidden="true"><span /></div>
        <div className={styles.listHeading}><h4>Starting lineup</h4><span>4 featured starters</span></div>
        <div className={styles.lineup}>
          {lineup.map((player) => <div key={player.slot} className={styles.playerRow}><span className={styles.position} data-position={player.slot}>{player.slot}</span><div><strong>{player.name}</strong><small>{player.detail}</small></div><span className={styles.points}>{player.points}<small>PROJ</small></span></div>)}
        </div>
        <button type="button" className={styles.contextLink} onClick={() => onOpen("My Team")}>View team & lineup <ArrowRight size={16} /></button>
      </> : scene === "gm" ? <>
        <div className={styles.direction}><TrendingUp size={19} /><span>TEAM DIRECTION<strong>Contending</strong></span><small>Example strategy</small></div>
        <div className={styles.contextTabs} role="group" aria-label="Sample franchise assets">
          <button type="button" aria-pressed={assetView === "roster"} onClick={() => setAssetView("roster")}>Roster core</button>
          <button type="button" aria-pressed={assetView === "picks"} onClick={() => setAssetView("picks")}>Draft capital <span>6</span></button>
        </div>
        {assetView === "roster" ? <div className={styles.assetList}>{assets.map((player) => <div key={player.name} className={styles.playerRow}><span className={styles.position} data-position={player.slot}>{player.slot}</span><div><strong>{player.name}</strong><small>{player.tag}</small></div><span className={styles.assetDot} /></div>)}</div>
          : <div className={styles.pickList}>{["2027", "2028"].map((year) => <div key={year}><strong>{year}</strong><span>1st round</span><span>2nd round</span><span>3rd round</span></div>)}<p>All six selections are your own · sample picks</p></div>}
        <div className={styles.staffBrief}><ClipboardList size={23} /><div><span>FROM YOUR STRATEGY DIRECTOR</span><p>Protect your core. Explore a deal for depth without spending next year’s first.</p><small>Illustrative staff briefing</small></div></div>
        <button type="button" className={styles.contextLink} onClick={() => onOpen("Meet Your Staff")}>Meet your front office <ArrowRight size={16} /></button>
      </> : <>
        <div className={styles.listHeading}><h4>League standings</h4><span>After week 3</span></div>
        <table className={styles.standings}><caption className={styles.srOnly}>Illustrative league standings, top four teams</caption><thead><tr><th scope="col">TEAM</th><th scope="col">W–L</th><th scope="col">PF</th></tr></thead><tbody>{standings.map((team, i) => <tr key={team.name}><th scope="row"><span className={styles.rank}>{i + 1}</span><Image src={"/teams/" + team.crest + ".png"} alt="" width={26} height={26} /><span>{team.short}</span></th><td>{team.record}</td><td>{team.points}</td></tr>)}</tbody></table>
        <div className={styles.proposal}><div><Flag size={18} /><span>ON THE AGENDA</span></div><h4>Expand the rookie taxi squad</h4><p>Add one development spot for next season.</p><small>Example proposal · no active vote</small></div>
        <button type="button" className={styles.contextLink} onClick={() => onOpen("Proposals")}>Review league proposals <ArrowRight size={16} /></button>
      </>}
    </div>
  </aside>;
}
