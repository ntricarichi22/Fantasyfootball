"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeftRight, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, ClipboardList, Landmark, MessageSquare, Shield, Tag, Trophy, Users, X, type LucideIcon } from "lucide-react";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { gmNameFor } from "./gmNames";
import styles from "./FranchiseHome.module.css";

type Action = { title: string; description: string; detail: string; icon: LucideIcon; href?: string; staff?: boolean };
type Scene = { id: string; label: string; title: string; subtitle: string; actions: Action[] };
const scenes: Scene[] = [
  { id: "field", label: "The Field", title: "Game day starts here.", subtitle: "Your team. Your matchup. Every Sunday.", actions: [
    { title: "My Team", description: "Your roster, picks, and starting lineup.", detail: "Your franchise at a glance: roster, future draft picks, and weekly lineup decisions. This in-season workspace is coming soon.", icon: Users },
    { title: "Matchup", description: "Follow your weekly head-to-head.", detail: "Your weekly opponent, projected matchup, and live scoring will live here. This in-season workspace is coming soon.", icon: Shield },
    { title: "Standings", description: "See the league and playoff picture.", detail: "League standings, the playoff race, and your path to a championship. This in-season workspace is coming soon.", icon: Trophy },
  ]},
  { id: "owner", label: "Owner’s Suite", title: "Shape the league.", subtitle: "A seat at the table. A say in what comes next.", actions: [
    { title: "Owners Meeting", description: "Bring the league together.", detail: "A dedicated space for your annual owners meeting, agenda, and league discussion. Coming soon.", icon: Landmark },
    { title: "Proposals", description: "Submit ideas. Make your voice count.", detail: "Submit rule proposals, review the discussion, and vote on the future of your league. Coming soon.", icon: MessageSquare },
    { title: "League History", description: "Revisit seasons and champions.", detail: "Explore the league historian and the stories of previous seasons.", icon: BookOpen, href: "/historian" },
  ]},
  { id: "gm", label: "GM’s Office", title: "Build your next contender.", subtitle: "Make your move. Your staff is ready.", actions: [
    { title: "Find a Trade", description: "Explore deals that improve your team.", detail: "Build an offer with the existing trade builder.", icon: ArrowLeftRight, href: "/pro-personnel/trade-builder?seed=fresh" },
    { title: "Shop My Guys", description: "Gauge the market for your players.", detail: "Open the trade studio to explore the market for your roster.", icon: Tag, href: "/pro-personnel/trade-studio" },
    { title: "Meet Your Staff", description: "Talk it through with your directors.", detail: "Choose the director you want to meet.", icon: Users, staff: true },
    { title: "Big Board", description: "Rank prospects. Prepare for the draft.", detail: "Open your existing scouting board and prospect rankings.", icon: ClipboardList, href: "/scouting/big-board" },
  ]},
];
const directors = [
  { name: "Pro Personnel", description: "Trade opportunities and player value", href: "/personnel-office" },
  { name: "Scouting", description: "Prospects, rankings, and draft preparation", href: "/scouting" },
  { name: "Strategy", description: "Team direction and player availability", href: "/strategy" },
];

export function FranchiseHome({ preview = false }: { preview?: boolean }) {
  const [index, setIndex] = useState(0);
  const [team, setTeam] = useState({ name: preview ? "Virginia Founders" : "Your Franchise", gm: preview ? "Nick" : "GM" });
  const [dialog, setDialog] = useState<Action | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const scene = scenes[index];

  useEffect(() => {
    const syncHash = () => {
      const next = scenes.findIndex((s) => "#" + s.id === window.location.hash);
      if (next >= 0) setIndex(next);
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    if (!preview) {
      const stored = readStoredTeam();
      if (stored.teamName) {
        const name = stored.teamName;
        queueMicrotask(() => setTeam({ name, gm: gmNameFor(name)?.split(" ")[0] ?? "GM" }));
      }
    }
    return () => window.removeEventListener("hashchange", syncHash);
  }, [preview]);

  useEffect(() => {
    const modal = dialogRef.current;
    if (dialog && modal && !modal.open) modal.showModal();
    if (!dialog && modal?.open) modal.close();
  }, [dialog]);

  function changeScene(next: number, focus = false) {
    const target = (next + scenes.length) % scenes.length;
    if (target !== index) {
      setIndex(target);
      window.history.replaceState(null, "", "#" + scenes[target].id);
      setPulseKey((key) => key + 1);
    }
    if (focus) tabRefs.current[target]?.focus();
  }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? scenes.length - 1 : null;
    if (next !== null) { event.preventDefault(); changeScene(next, true); }
  }
  function startSwipe(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch" || (event.target as HTMLElement).closest("a, button, dialog")) return;
    gesture.current = { x: event.clientX, y: event.clientY };
  }
  function finishSwipe(event: PointerEvent<HTMLElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start) return;
    const x = event.clientX - start.x, y = event.clientY - start.y;
    if (Math.abs(x) > 64 && Math.abs(x) > Math.abs(y) * 1.5) changeScene(index + (x < 0 ? 1 : -1));
  }
  function actionContent(action: Action) {
    const Icon = action.icon;
    return <><span className={styles.radial}><Icon size={23} strokeWidth={1.55} aria-hidden="true" /><span className={styles.tapRing} /></span><span className={styles.actionCopy}><span className={styles.actionTitle}>{action.title}</span><span className={styles.actionDescription}>{action.description}</span></span><ArrowRight className={styles.actionArrow} size={17} aria-hidden="true" /></>;
  }

  return (
    <main className={styles.shell} onPointerDown={startSwipe} onPointerUp={finishSwipe} onPointerCancel={() => { gesture.current = null; }}>
      <div className={styles.artwork} aria-hidden="true">
        {scenes.map((item, i) => <div key={item.id} className={[styles.sceneImage, i === index ? styles.sceneVisible : "", ready[item.id] ? styles.sceneReady : ""].join(" ")}>
          <Image src={"/ui-refresh/" + item.id + ".jpg"} alt="" fill sizes="100vw" priority={i === 0} onLoad={() => setReady((old) => ({ ...old, [item.id]: true }))} />
        </div>)}
        <div className={styles.scrim} />
        <div key={"reveal-" + index} className={styles.settle} />
        <div className={styles.grain} />
      </div>

      <div className={styles.frame}>
        <header className={styles.header}>
          <Link className={styles.brand} href={preview ? "/login/ui-preview" : "/"} aria-label="Franchise Mode home">
            <span className={styles.crest}>F<span>·</span>M</span>
            <span><strong>FRANCHISE MODE</strong><small>CFC <span>/</span> {team.name}</small></span>
          </Link>
          <div className={styles.identity}><span>Welcome back, <strong>{team.gm}.</strong></span><span className={styles.avatar} aria-hidden="true">{team.gm.slice(0, 1)}</span></div>
        </header>

        <nav className={styles.navigation} aria-label="Franchise areas">
          <div role="tablist" aria-label="Choose your franchise area" className={styles.tabs}>
            {scenes.map((item, i) => <button key={item.id} ref={(element) => { tabRefs.current[i] = element; }} id={"tab-" + item.id} role="tab" type="button" aria-selected={index === i} aria-controls={"panel-" + item.id} tabIndex={index === i ? 0 : -1} onKeyDown={onTabKey} onClick={() => changeScene(i)} className={index === i ? styles.activeTab : ""}><span className={styles.tabNumber}>0{i + 1}</span>{item.label}</button>)}
          </div>
          <span className={styles.navigationHint}>ONE FRANCHISE. THREE PERSPECTIVES.</span>
        </nav>

        <section key={scene.id} role="tabpanel" id={"panel-" + scene.id} aria-labelledby={"tab-" + scene.id} className={styles.panel}>
          <div className={styles.heading}>
            <span className={styles.eyebrow}><span />{scene.label}<span className={styles.headingLine} /></span>
            <h1>{scene.title}</h1>
            <p>{scene.subtitle}</p>
          </div>
          <div className={styles.menu} aria-label={scene.label + " actions"}>
            <span className={styles.rail} aria-hidden="true"><span key={pulseKey} className={styles.pulse} /></span>
            {scene.actions.map((action) => action.href && !preview
              ? <Link key={action.title} href={action.href} className={styles.action}>{actionContent(action)}</Link>
              : <button type="button" key={action.title} className={styles.action} onClick={() => setDialog(action)}>{actionContent(action)}</button>)}
          </div>
        </section>

        <footer className={styles.footer}>
          <span className={styles.footerLabel}>{preview ? "DESIGN PREVIEW" : "YOUR FRANCHISE HEADQUARTERS"}<span className={styles.footerDot}>·</span><Link href={preview ? "/login" : "/classic"}>{preview ? "Sign in" : "Classic home"}</Link></span>
          <div className={styles.sceneControls}><button type="button" aria-label="Previous scene" onClick={() => changeScene(index - 1)}><ChevronLeft size={18} /></button><span>0{index + 1}<span> / 03</span></span><button type="button" aria-label="Next scene" onClick={() => changeScene(index + 1)}><ChevronRight size={18} /></button></div>
        </footer>
      </div>

      <dialog ref={dialogRef} className={styles.dialog} onCancel={() => setDialog(null)} onClose={() => setDialog(null)} onClick={(event) => { if (event.target === event.currentTarget) setDialog(null); }} aria-labelledby="destination-title">
        {dialog && <div className={styles.dialogBody}>
          <button type="button" className={styles.close} aria-label="Close preview" onClick={() => setDialog(null)}><X size={22} /></button>
          <span className={styles.dialogEyebrow}>{dialog.staff ? "YOUR FRONT OFFICE" : dialog.href ? "CONNECTED WORKSPACE" : "COMING SOON"}</span>
          <h2 id="destination-title">{dialog.title}</h2>
          <p>{dialog.detail}</p>
          {dialog.staff ? <div className={styles.directors}>{directors.map((director) => <Link key={director.name} href={preview ? "/login?next=" + encodeURIComponent(director.href) : director.href}><span><strong>{director.name}</strong><small>{director.description}</small></span><ArrowRight size={19} /></Link>)}</div>
            : dialog.href ? <Link className={styles.destinationLink} href={preview ? "/login?next=" + encodeURIComponent(dialog.href) : dialog.href}>{preview ? "Sign in to open workspace" : "Open workspace"}<ArrowRight size={18} /></Link>
            : <button type="button" className={styles.destinationLink} onClick={() => setDialog(null)}>Back to headquarters<Check size={18} /></button>}
          {preview && dialog.staff && <small className={styles.previewNote}>Staff workspaces require your CFC sign-in.</small>}
        </div>}
      </dialog>
    </main>
  );
}
