"use client";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, Headphones, LockKeyhole, Maximize2, Minimize2, X } from "lucide-react";
import { DemoProvider, useDemo } from "./DemoState";
import { defaults, featureRole, roles, slots, type Availability, type FeatureId, type RoleId } from "./model";
import { Workspace } from "./Workspace";
import s from "./Prototype.module.css";

export function FranchisePrototype() { return <DemoProvider><Headquarters /></DemoProvider>; }

function Headquarters() {
  const demo = useDemo();
  const [roleId, setRoleId] = useState<RoleId>("coach");
  const [selections, setSelections] = useState(defaults);
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [staffReply, setStaffReply] = useState(false);
  const [staffQuestion, setStaffQuestion] = useState("");
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const staffDialog = useRef<HTMLDialogElement>(null);
  const playerDialog = useRef<HTMLDialogElement>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const workspaceBody = useRef<HTMLDivElement>(null);
  const role = roles.find((r) => r.id === roleId)!;
  const feature = selections[roleId];
  const selected = role.options.find((o) => o.id === feature)!;
  useLayoutEffect(() => { if (workspaceBody.current) workspaceBody.current.scrollTop = 0; }, [feature]);
  const inSeason = demo.phase === "WEEK 4";
  const empty = slots.filter((slot) => !demo.players.some((p) => p.group === "Starters" && p.slot === slot)).length;
  const byes = demo.players.filter((p) => p.group === "Starters" && p.condition === "Bye").length;
  const injured = demo.players.filter((p) => p.group === "Starters" && p.condition === "Questionable").length;
  const pending = demo.transactions.filter((t) => t.status === "Pending").length;
  const staffName = roleId === "coach" ? "Coaching staff" : roleId === "gm" ? feature === "draft" ? "Scouting Director" : feature === "strategy" ? "Strategy Director" : "Pro Personnel Director" : roleId === "owner" ? "League office" : "League desk";
  const lead = roleId === "coach" ? !inSeason ? "The next season starts with your depth. Let’s review the roster." : empty ? "Your FLEX spot is open. Let’s get your best lineup on the field." : byes ? "You have a starter on bye. Let’s find your next man up." : "Your starting slots are filled. Review any injury updates before kickoff."
    : roleId === "gm" ? demo.players.length > 25 ? "You’re over the roster limit. Let’s review your options before waivers." : "Your roster is within the limit. Let’s put your next move together."
    : roleId === "owner" ? "One rule proposal is open. Have your say before the owners meeting." : "The Founders lead the table. Week 4 brings a matchup with the Wingmen.";
  const leadFeature: FeatureId = roleId === "coach" || roleId === "gm" ? "roster" : roleId === "owner" ? "rules" : "scores";
  const metrics = roleId === "coach" ? inSeason ? [
    { label: "LINEUP", value: empty ? `${empty} open slot${empty > 1 ? "s" : ""}` : "Slots filled", issue: empty > 0, feature: "roster" as FeatureId },
    { label: "STARTERS", value: `${byes} bye · ${injured} questionable`, issue: byes + injured > 0, feature: "roster" as FeatureId },
    { label: "NEXT LOCK", value: "Sun · 1 PM ET", feature: "matchup" as FeatureId },
  ] : [{ label: "SEASON PREP", value: "Review your depth", feature: "depth" as FeatureId }, { label: "ROSTER", value: `${demo.players.length} / 25`, issue: demo.players.length > 25, feature: "roster" as FeatureId }]
    : roleId === "gm" ? [{ label: "ROSTER", value: `${demo.players.length} / 25`, issue: demo.players.length > 25, feature: "roster" as FeatureId }, { label: "SALARY CAP", value: "$43 remaining", feature: "waivers" as FeatureId }, { label: "WAIVERS", value: "Wed · 8 PM ET", feature: "waivers" as FeatureId }, { label: "ACTIVE MOVES", value: String(pending), feature: "transactions" as FeatureId }]
    : roleId === "owner" ? [{ label: "PROPOSALS", value: "1 open vote", feature: "rules" as FeatureId }, { label: "NEXT MEETING", value: "Oct 6 · 7 PM ET", feature: "meetings" as FeatureId }]
    : [{ label: "WEEK 4", value: "6 matchups", feature: "scores" as FeatureId }, { label: "YOUR POSITION", value: "1st of 12", feature: "standings" as FeatureId }];

  if ((roleId === "owner" || roleId === "league") && demo.players.length > 25) metrics.push({ label: "ROSTER ACTION", value: `${demo.players.length} / 25`, issue: true, feature: "roster" });

  useEffect(() => {
    const sync = () => {
      const [rawRole, rawFeature, mode] = window.location.hash.slice(1).split("/");
      const target = roles.find((r) => r.id === (rawRole === "field" ? "coach" : rawRole));
      if (!target) return;
      const option = target.options.find((o) => o.id === rawFeature);
      setRoleId(target.id);
      setSelections((old) => ({ ...old, [target.id]: option?.id ?? defaults[target.id] }));
      setExpanded(mode === "expanded");
      setMobileOpen(Boolean(option));
    };
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => { const d = staffDialog.current; if (staffOpen && d && !d.open) d.showModal(); if (!staffOpen && d?.open) d.close(); }, [staffOpen]);
  useEffect(() => { const d = playerDialog.current; if (demo.selectedPlayer && d && !d.open) d.showModal(); if (!demo.selectedPlayer && d?.open) d.close(); }, [demo.selectedPlayer]);
  function reviewStatus(target: FeatureId) {
    if (target === "roster") demo.setRosterGroup(roleId === "gm" ? "Bench" : "Starters");
    navigate(target);
  }
  function navigate(target: FeatureId, expand = false) {
    const nextRole = featureRole(target);
    setRoleId(nextRole); setSelections((old) => ({ ...old, [nextRole]: target })); setExpanded(expand); setMobileOpen(true);
    const hash = `#${nextRole}/${target}${expand ? "/expanded" : ""}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setStaffOpen(false);
  }
  function changeRole(id: RoleId, focus = false) {
    setRoleId(id); setMobileOpen(false); setExpanded(false); setMetricsOpen(false); setStaffReply(false);
    const target = id === "coach" && !inSeason && selections.coach === "matchup" ? "roster" : selections[id];
    setSelections((old) => ({ ...old, [id]: target }));
    window.history.pushState(null, "", `#${id}/${target}`);
    if (focus) tabRefs.current[roles.findIndex((r) => r.id === id)]?.focus();
  }
  function tabKeys(e: KeyboardEvent<HTMLButtonElement>) {
    const i = roles.findIndex((r) => r.id === roleId);
    const next = e.key === "ArrowRight" ? (i + 1) % 4 : e.key === "ArrowLeft" ? (i + 3) % 4 : e.key === "Home" ? 0 : e.key === "End" ? 3 : null;
    if (next !== null) { e.preventDefault(); changeRole(roles[next].id, true); }
  }
  function toggleExpand() { setExpanded(!expanded); window.history.replaceState(null, "", `#${roleId}/${feature}${expanded ? "" : "/expanded"}`); }
  function swipeStart(e: PointerEvent) { if (e.pointerType === "touch" && !(e.target as HTMLElement).closest("button,a,input,select,textarea,[data-workspace]")) gesture.current = { x: e.clientX, y: e.clientY }; }
  function swipeEnd(e: PointerEvent) { const start = gesture.current; gesture.current = null; if (!start) return; const dx = e.clientX - start.x; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(e.clientY - start.y) * 1.5) { const i = roles.findIndex((r) => r.id === roleId); changeRole(roles[(i + (dx < 0 ? 1 : 3)) % 4].id); } }
  const editing = demo.players.find((p) => p.id === demo.selectedPlayer);

  return <main className={`${s.app} ${expanded ? s.expanded : ""} ${mobileOpen ? s.mobileOpen : ""}`} onPointerDown={swipeStart} onPointerUp={swipeEnd} onPointerCancel={() => { gesture.current = null; }}>
    <div className={s.scenery} aria-hidden="true">{roles.map((r, i) => <div key={r.id} className={`${s.scene} ${r.id === roleId && ready[r.id] ? s.sceneVisible : ""}`}><Image src={`/ui-refresh/${r.image}.jpg`} alt="" fill sizes="100vw" priority={i === 0} onLoad={() => setReady((old) => ({ ...old, [r.id]: true }))} /></div>)}<div className={s.scrim} /></div>
    <div className={s.frame}>
      <header className={s.brandHeader}><a className={s.brand} href="/login/ui-preview" aria-label="Franchise Mode home"><span className={s.brandMark}>FM<span>·</span></span><span><strong>FRANCHISE MODE</strong><small>DYNASTY FANTASY FOOTBALL</small></span></a><span className={s.demoBadge}>SAMPLE LEAGUE</span><div className={s.greeting}>Welcome back, <strong>Nick.</strong><span>N</span></div></header>
      <div className={s.teamHeader}><div className={s.teamName}><Image src={`/teams/${demo.identity.crest}.png`} alt="" width={54} height={54} /><div><h1>{demo.identity.city} {demo.identity.name}</h1><p>CFC <span>·</span> 12 teams <span>·</span> Dynasty <span>·</span> Half PPR / SF</p></div></div><label className={s.calendar}><span>2026 <b>/</b></span><select aria-label="Sample league calendar phase" value={demo.phase} onChange={(e) => { demo.setPhase(e.target.value); if (roleId === "coach") navigate(e.target.value === "WEEK 4" ? "matchup" : "roster"); }}><option>WEEK 4</option><option>ROOKIE DRAFT</option><option>FREE AGENCY</option></select><ChevronDown size={16} /></label></div>
      <nav className={s.roleNav} aria-label="Franchise roles"><div role="tablist" aria-label="Choose your role">{roles.map((r, i) => <button key={r.id} ref={(el) => { tabRefs.current[i] = el; }} role="tab" id={`role-${r.id}`} aria-selected={r.id === roleId} aria-controls="role-content" tabIndex={r.id === roleId ? 0 : -1} onKeyDown={tabKeys} onClick={() => changeRole(r.id)}><span className={s.number}>0{i + 1}</span><span className={s.desktopLabel}>{r.label}</span><span className={s.mobileLabel}>{r.short}</span></button>)}</div><button className={s.staffToggle} onClick={() => setStaffOpen(true)}><Headphones size={16} /> Ask your staff</button></nav>
      <aside className={`${s.briefing} ${metricsOpen ? s.metricsOpen : ""}`} aria-label="Staff briefing"><button className={s.briefLead} onClick={() => reviewStatus(leadFeature)}><span className={s.staffIcon}><Headphones size={24} /></span><span><small>STAFF BRIEFING <b>/</b> {staffName}</small><strong>{lead}</strong></span><ArrowRight size={20} /></button><div className={s.metrics}>{metrics.map((m) => <button key={m.label} onClick={() => reviewStatus(m.feature)} className={m.issue ? s.metricAlert : ""}><small>{m.label}</small><strong>{m.value}</strong></button>)}</div><button className={s.mobileMetrics} aria-expanded={metricsOpen} onClick={() => setMetricsOpen(!metricsOpen)}>{metricsOpen ? "Hide status" : `${metrics.length} status items`}<ChevronDown size={15} /></button></aside>
      <section id="role-content" role="tabpanel" aria-labelledby={`role-${roleId}`} className={s.stage}>
        <div className={s.sidebar}><div className={s.hero}><h2>{role.headline}</h2><p>{role.description}</p></div><nav className={s.radialMenu} aria-label={`${role.short} tools`}><span className={s.rail} aria-hidden="true"><i key={roleId} /></span>{role.options.map((option) => { const Icon = option.icon; return <button key={option.id} className={`${s.menuItem} ${feature === option.id ? s.menuSelected : ""}`} aria-current={feature === option.id ? "page" : undefined} aria-label={option.label} title={expanded ? option.label : undefined} onClick={() => navigate(option.id, expanded)}><span className={s.radial}><Icon size={23} strokeWidth={1.6} /></span><span className={s.menuCopy}><strong>{option.label}</strong><small>{option.description}</small></span><ChevronRight className={s.menuArrow} size={17} /></button>; })}</nav><div className={s.sidebarBottom}><span>YOUR FRANCHISE HEADQUARTERS</span><button onClick={() => navigate(feature)}>Open {selected.label}<ArrowRight size={16} /></button></div></div>
        <div className={s.workspace} data-workspace><header className={s.workspaceHeader}><button className={s.mobileBack} onClick={() => setMobileOpen(false)} aria-label={`Back to ${role.short} menu`}><ArrowLeft size={19} /></button><div><span>{role.label.toUpperCase()}</span><h2>{selected.label}</h2></div><span className={s.workspaceSample}>DEMO</span><button className={s.expandButton} onClick={toggleExpand} aria-label={expanded ? "Collapse workspace" : "Expand workspace"} title={expanded ? "Collapse workspace" : "Expand workspace"}>{expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button></header><div className={s.workspaceBody} ref={workspaceBody}><Workspace feature={feature} navigate={navigate} askStaff={() => setStaffOpen(true)} /></div></div>
      </section>
      <footer className={s.footer}><span>DESIGN PREVIEW <b>·</b> Dummy data · changes reset on reload</span><span>{role.short} <b>/</b> {selected.label}</span></footer>
    </div>
    <div className={s.toast} role="status" aria-live="polite">{demo.toast && <><Check size={18} />{demo.toast}</>}</div>
    <dialog ref={staffDialog} aria-label="Staff briefing" className={`${s.dialog} ${s.staffDialog}`} onCancel={() => setStaffOpen(false)} onClose={() => setStaffOpen(false)}><div className={s.dialogHeader}><span><Headphones size={20} /> {staffName}</span><button aria-label="Close staff briefing" onClick={() => setStaffOpen(false)}><X /></button></div><div className={s.dialogContent}><span className={s.kicker}>YOUR STAFF BRIEFING</span><h2>Let’s make your next move.</h2><p>{lead}</p><div className={s.advice}><strong>Staff recommendation</strong><p>{roleId === "coach" ? "Start with your open slots and bye-week replacements. James Cook and DK Metcalf are options on your bench. Review the sample projections before setting your lineup." : roleId === "gm" ? "Review depth before making a roster move. Keep your team direction and private player values in mind when comparing offers." : roleId === "owner" ? "Read the proposed taxi-squad amendment, review the current rule, and bring any questions to the next meeting." : "Check this week’s matchups, then compare the standings. The scores and league activity here are illustrative."}</p><button className={s.primary} onClick={() => navigate(leadFeature)}>Open {leadFeature === "roster" ? "Roster" : leadFeature === "rules" ? "League Rules" : "Scores"}<ArrowRight size={17} /></button></div><p className={s.privateNote}><LockKeyhole size={14} /> Your staff conversations and player values stay private.</p><form onSubmit={(e) => { e.preventDefault(); if (staffQuestion.trim()) setStaffReply(true); }}><label className={s.field}>Ask your staff<textarea value={staffQuestion} onChange={(e) => { setStaffQuestion(e.target.value); setStaffReply(false); }} placeholder="What should I focus on next?" required rows={2} /></label><button className={s.secondary} type="submit">Preview a staff response<ArrowRight size={16} /></button></form>{staffReply && <div className={s.advice}><strong>Scripted demo response</strong><p>Start with the item highlighted in your briefing. I can help compare your options within that workspace. This is a sample conversation; no AI request was sent.</p></div>}</div></dialog>
    <dialog ref={playerDialog} aria-labelledby="player-profile-name" className={s.dialog} onCancel={() => demo.openPlayer(null)} onClose={() => demo.openPlayer(null)}>{editing && <><div className={s.dialogHeader}><span>Player profile</span><button aria-label="Close player profile" onClick={() => demo.openPlayer(null)}><X /></button></div><div className={s.dialogContent}><span className={s.kicker}>{editing.position} · {editing.group}</span><h2 id="player-profile-name">{editing.name}</h2><div className={s.profileStats}><div><strong>{editing.points.toFixed(1)}</strong><small>PROJ POINTS</small></div><div><strong>{editing.bye}</strong><small>BYE WEEK</small></div><div><strong>{editing.condition ?? "Healthy"}</strong><small>SAMPLE STATUS</small></div></div><PlayerEditor key={editing.id} playerId={editing.id} /><div className={s.buttonRow}>{["RB", "WR", "TE"].includes(editing.position) && editing.group === "Bench" && <button className={s.primary} onClick={() => { demo.startPlayer(editing.id, "FLEX"); demo.openPlayer(null); }}>Start at FLEX</button>}{editing.group === "Starters" && <button className={s.secondary} onClick={() => { demo.editPlayer(editing.id, { group: "Bench", slot: undefined }); demo.notify("Moved to the bench in this demo."); demo.openPlayer(null); }}>Move to bench</button>}</div></div></>}</dialog>
  </main>;
}

function PlayerEditor({ playerId }: { playerId: string }) {
  const demo = useDemo(); const player = demo.players.find((p) => p.id === playerId)!;
  const [availability, setAvailability] = useState<Availability>(player.availability);
  const [asking, setAsking] = useState(player.asking);
  return <form className={s.playerEditor} onSubmit={(e) => { e.preventDefault(); demo.editPlayer(playerId, { availability, asking }); demo.notify("Your private player settings were saved in this demo."); }}><p className={s.privateNote}><LockKeyhole size={15} /> PRIVATE · Only you and your staff</p><label className={s.field}>Player availability<select value={availability} onChange={(e) => setAvailability(e.target.value as Availability)}>{["Untouchable", "Core piece", "Listening", "Moveable"].map((x) => <option key={x}>{x}</option>)}</select></label><label className={s.field}>Your private asking price<input value={asking} onChange={(e) => setAsking(e.target.value)} maxLength={90} /></label><button type="submit" className={s.primary}>Save player settings<Check size={17} /></button></form>;
}
