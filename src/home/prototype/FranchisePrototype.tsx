"use client";
import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { ArrowLeft, Check, ChevronRight, Menu, X } from "lucide-react";
import { DemoProvider, useDemo } from "./DemoState";
import {
  initialRules,
  roles,
  featureRole,
  type RoleId,
  type FeatureId,
  type Availability,
} from "./model";
import { Workspace } from "./Workspace";
import { Crest, Portrait, TaskTiles, type Tile } from "./UI";
import { lineupSlots, subLimit } from "./leagueFixture";
import s from "./Prototype.module.css";
const taskOptions: Partial<Record<FeatureId, Tile[]>> = {
  trades: [
    {
      id: "build",
      title: "Build an Offer",
      text: "Build it yourself, or describe the deal to your director.",
      image: "studio-gm",
      tag: "MAKE YOUR MOVE",
      position: "70% center",
    },
    {
      id: "shop",
      title: "Shop Your Guys",
      text: "Choose who's available. Your director works the phones.",
      image: "sideline-v3",
      tag: "TEST THE MARKET",
      position: "96% center",
    },
    {
      id: "negotiations",
      title: "Active Negotiations",
      text: "Your offers, counters, and conversations. All in one place.",
      image: "studio-owner",
      tag: "KEEP TALKS MOVING",
      position: "70% center",
    },
  ],
  draft: [
    {
      id: "board",
      title: "Build Your Board",
      text: "Scout the class. Rank your targets. Know your next pick.",
      image: "studio-gm",
      tag: "SCOUTING DEPARTMENT",
      position: "73% center",
    },
    {
      id: "room",
      title: "Enter Draft Room",
      text: "Your league's next chapter starts on the clock.",
      image: "league-v4",
      disabled: true,
      position: "80% center",
    },
    {
      id: "mock",
      title: "Do a Mock",
      text: "Run the scenarios before draft night.",
      image: "sideline-v3",
      tag: "REHEARSE YOUR PICKS",
      position: "90% center",
    },
  ],
  rules: initialRules.map((r, i) => ({
    id: r.id,
    title: r.title,
    text: r.description,
    image: i % 2 ? "studio-gm" : "studio-owner",
    tag: "THE CONSTITUTION",
    position: i % 2 ? "75% center" : "80% center",
  })),
  meetings: [
    {
      id: "upcoming",
      title: "Next Meeting",
      text: "October 6. The agenda, the proposals, and your seat at the table.",
      image: "studio-owner",
      tag: "OCT 06 · 7 PM",
      position: "75% center",
    },
    {
      id: "past",
      title: "Past Meetings",
      text: "Revisit the discussions and decisions that shaped the league.",
      image: "studio-gm",
      tag: "MEETING ARCHIVE",
      position: "65% center",
    },
  ],
};
export function FranchisePrototype() {
  return (
    <DemoProvider>
      <Headquarters />
    </DemoProvider>
  );
}
function Headquarters() {
  const demo = useDemo();
  const [roleId, setRoleId] = useState<RoleId>("coach");
  const [feature, setFeature] = useState<FeatureId | null>(null);
  const [task, setTask] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const role = roles.find((r) => r.id === roleId)!;
  const option = role.options.find((o) => o.id === feature);
  const tiles = feature ? taskOptions[feature] : undefined;
  const focused = Boolean(feature && (!tiles || task));
  const activeTask = tiles?.find((t) => t.id === task);
  function updateHash(r: RoleId, f: FeatureId | null, t = "") {
    const hash = "#" + r + (f ? "/" + f : "") + (t ? "/" + t : "");
    window.history.pushState(null, "", hash);
  }
  function navigate(f: FeatureId, t = "") {
    const r = featureRole(f);
    setRoleId(r);
    setFeature(f);
    setTask(t);
    setMenuOpen(false);
    updateHash(r, f, t);
    stage.current?.scrollTo(0, 0);
  }
  function changeRole(r: RoleId) {
    setRoleId(r);
    setFeature(null);
    setTask("");
    setMenuOpen(false);
    updateHash(r, null);
  }
  function back() {
    if (task && feature) {
      setTask("");
      updateHash(roleId, feature);
    } else changeRole(roleId);
  }
  useEffect(() => {
    function sync() {
      const [rawRole, rawFeature, rawTask] = window.location.hash
        .slice(1)
        .split("/");
      const r = roles.find(
        (r) => r.id === (rawRole === "field" ? "coach" : rawRole),
      );
      if (!r) return;
      const alias =
        rawFeature === "roster" || rawFeature === "depth"
          ? "lineup"
          : rawFeature;
      const f = r.options.find((o) => o.id === alias);
      const t = f
        ? taskOptions[f.id]?.find((x) => x.id === rawTask && !x.disabled)
        : undefined;
      setRoleId(r.id);
      setFeature(f?.id ?? null);
      setTask(t?.id ?? "");
      setMenuOpen(false);
    }
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  useEffect(() => {
    const d = dialog.current;
    if (demo.selectedPlayer && d && !d.open) d.showModal();
    if (!demo.selectedPlayer && d?.open) d.close();
  }, [demo.selectedPlayer]);
  function tabKeys(e: KeyboardEvent<HTMLButtonElement>) {
    const i = roles.findIndex((r) => r.id === roleId);
    const n =
      e.key === "ArrowRight"
        ? (i + 1) % roles.length
        : e.key === "ArrowLeft"
          ? (i + roles.length - 1) % roles.length
          : null;
    if (n !== null) {
      e.preventDefault();
      changeRole(roles[n].id);
      tabRefs.current[n]?.focus();
    }
  }
  function swipeStart(e: PointerEvent) {
    if (
      e.pointerType === "touch" &&
      !(e.target as HTMLElement).closest(
        "button,a,input,select,textarea,[data-workspace]",
      )
    )
      gesture.current = { x: e.clientX, y: e.clientY };
  }
  function swipeEnd(e: PointerEvent) {
    const p = gesture.current;
    gesture.current = null;
    if (!p) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    if (Math.abs(dx) > 85 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const i = roles.findIndex((r) => r.id === roleId);
      changeRole(
        roles[(i + (dx < 0 ? 1 : roles.length - 1)) % roles.length].id,
      );
    }
  }
  const player = demo.players.find((p) => p.id === demo.selectedPlayer);
  return (
    <main
      className={[
        s.app,
        focused ? s.focused : "",
        menuOpen ? s.menuOpen : "",
        feature && !focused ? s.choosing : "",
      ].join(" ")}
      onPointerDown={swipeStart}
      onPointerUp={swipeEnd}
      onPointerCancel={() => {
        gesture.current = null;
      }}
    >
      <div className={s.scenery} aria-hidden="true">
        {roles.map((r, i) => (
          <div
            key={r.id}
            className={[s.scene, r.id === roleId ? s.sceneVisible : ""].join(
              " ",
            )}
          >
            <Image
              src={"/ui-refresh/" + r.image + ".jpg"}
              alt=""
              fill
              sizes="100vw"
              priority={i === 0}
            />
          </div>
        ))}
        <div className={s.scrim} />
      </div>
      <div className={s.frame}>
        <header className={s.brandHeader}>
          <button
            className={s.brand}
            onClick={() => changeRole("coach")}
            aria-label="Franchise Mode home"
          >
            <span className={s.brandMark}>
              FM<span>·</span>
            </span>
            <span>
              <strong>FRANCHISE MODE</strong>
              <small>DYNASTY FANTASY FOOTBALL</small>
            </span>
          </button>
          <div className={s.greeting}>
            Welcome back, <strong>Nick.</strong>
            <span>N</span>
          </div>
        </header>
        <div className={s.teamHeader}>
          <div className={s.teamName}>
            <Crest
              crest={demo.identity.crest}
              name={demo.identity.name}
              size={51}
            />
            <div>
              <small>YOUR FRANCHISE</small>
              <h1>
                {demo.identity.city} {demo.identity.name}
              </h1>
              <p>
                CFC <span>·</span> 12 teams <span>·</span> Dynasty{" "}
                <span>·</span> Half PPR / SF
              </p>
            </div>
          </div>
          <label className={s.calendar}>
            <span>
              2026 <b>/</b>
            </span>
            <select
              aria-label="Sample league calendar phase"
              value={demo.phase}
              onChange={(e) => demo.setPhase(e.target.value)}
            >
              <option>WEEK 4</option>
              <option>ROOKIE DRAFT</option>
              <option>FREE AGENCY</option>
            </select>
          </label>
        </div>
        <nav className={s.roleNav} aria-label="Franchise roles">
          <div role="tablist" aria-label="Choose your role">
            {roles.map((r, i) => (
              <button
                key={r.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                id={"role-" + r.id}
                aria-selected={r.id === roleId}
                aria-controls="role-content"
                tabIndex={r.id === roleId ? 0 : -1}
                onKeyDown={tabKeys}
                onClick={() => changeRole(r.id)}
              >
                <small>0{i + 1}</small>
                {r.label}
              </button>
            ))}
          </div>
          <span className={s.navStatus}>
            <i className={s.liveDot} />
            YOUR FRANCHISE HQ
          </span>
        </nav>
        <section
          id="role-content"
          role="tabpanel"
          aria-labelledby={"role-" + roleId}
          className={s.stage}
          ref={stage}
        >
          <aside
            className={s.sidebar}
            onMouseEnter={() => {
              if (focused) setMenuOpen(true);
            }}
            onMouseLeave={() => setMenuOpen(false)}
            onFocusCapture={() => {
              if (focused) setMenuOpen(true);
            }}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setMenuOpen(false);
            }}
          >
            <button
              className={s.menuToggle}
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className={s.hero}>
              <span className={s.heroRule} />
              <h2>{role.headline}</h2>
              <p>{role.description}</p>
            </div>
            <nav className={s.radialMenu} aria-label={role.label + " tools"}>
              <span className={s.rail}>
                <i key={roleId} />
              </span>
              {role.options.map((o) => {
                const Icon = o.icon;
                return (
                  <button
                    key={o.id}
                    className={[
                      s.menuItem,
                      feature === o.id ? s.menuSelected : "",
                    ].join(" ")}
                    aria-current={feature === o.id ? "page" : undefined}
                    aria-label={o.label}
                    title={focused ? o.label : undefined}
                    onClick={() => navigate(o.id)}
                  >
                    <span className={s.radial}>
                      <Icon size={23} strokeWidth={1.65} />
                    </span>
                    <span className={s.menuCopy}>
                      <strong>{o.label}</strong>
                      <small>{o.description}</small>
                    </span>
                    <ChevronRight className={s.menuArrow} size={17} />
                  </button>
                );
              })}
            </nav>
            <span className={s.sidebarNote}>THE NEXT CHAPTER IS YOURS.</span>
          </aside>
          <div className={s.contentStage}>
            {!feature && (
              <div className={s.sceneCaption}>
                <span>EST. 2026</span>
                <strong>
                  {roleId === "coach"
                    ? "TAKE THE SIDELINE."
                    : roleId === "gm"
                      ? "MAKE YOUR NEXT MOVE."
                      : roleId === "owner"
                        ? "BUILD SOMETHING LASTING."
                        : "EVERY GAME MATTERS."}
                </strong>
                <small>{demo.identity.name} · CFC</small>
              </div>
            )}
            {feature && !focused && tiles && (
              <div className={s.taskSelection}>
                <div className={s.taskHeading}>
                  <span className={s.eyebrow}>{option?.label}</span>
                  <h2>
                    {feature === "trades"
                      ? "LET'S MAKE A MOVE."
                      : feature === "draft"
                        ? "THE FUTURE STARTS HERE."
                        : feature === "meetings"
                          ? "YOUR SEAT AT THE TABLE."
                          : "KNOW THE PLAYBOOK."}
                  </h2>
                </div>
                <TaskTiles
                  tiles={tiles}
                  label={option?.label ?? ""}
                  onSelect={(id) => navigate(feature, id)}
                />
              </div>
            )}
            <div className={s.workspace} hidden={!focused} data-workspace>
              <header className={s.workspaceHeader}>
                <button
                  className={s.backButton}
                  onClick={back}
                  aria-label={
                    task
                      ? "Back to " + option?.label
                      : "Back to " + role.label + " menu"
                  }
                >
                  <ArrowLeft size={17} />
                  <span>{task ? "Back to " + option?.label : role.label}</span>
                </button>
                <h2>{activeTask?.title ?? option?.label}</h2>
                <span className={s.headerMeta}>
                  {feature === "lineup"
                    ? demo.players.filter(
                        (p) => p.group === "Starters" || p.group === "Subs",
                      ).length +
                      " / " +
                      (lineupSlots.length + subLimit) +
                      " ACTIVE"
                    : "CFC / " + demo.phase}
                </span>
              </header>
              <div className={s.workspaceBody}>
                <Workspace
                  feature={focused ? feature : null}
                  task={task}
                  navigate={navigate}
                />
              </div>
            </div>
          </div>
        </section>
        <footer className={s.footer}>
          <span>
            DESIGN PREVIEW <b>·</b> Fictional data. Changes stay in this
            session.
          </span>
          <span>
            FRANCHISE MODE <b>©</b> 2026
          </span>
        </footer>
      </div>
      {demo.toast && (
        <div className={s.toast} role="status">
          <Check size={17} />
          {demo.toast}
        </div>
      )}
      <dialog
        ref={dialog}
        className={s.dialog}
        aria-label="Player profile"
        onCancel={() => demo.openPlayer(null)}
        onClose={() => demo.openPlayer(null)}
      >
        {player && (
          <>
            <header>
              <span>PLAYER PROFILE</span>
              <button
                aria-label="Close player profile"
                onClick={() => demo.openPlayer(null)}
              >
                <X size={20} />
              </button>
            </header>
            <div className={s.profileHero}>
              <Portrait id={player.id} name={player.name} />
              <div>
                <small>
                  {player.position} · {player.team} · {player.group}
                </small>
                <h2>{player.name}</h2>
                <p>
                  {player.opponent} · {player.game}
                </p>
              </div>
            </div>
            <div className={s.profileStats}>
              <div>
                <strong>{player.points.toFixed(1)}</strong>
                <small>PROJECTED</small>
              </div>
              <div>
                <strong>{player.bye}</strong>
                <small>BYE WEEK</small>
              </div>
              <div>
                <strong>{player.condition ?? "Healthy"}</strong>
                <small>STATUS</small>
              </div>
            </div>
            <div className={s.profileEditor}>
              <label className={s.field}>
                Availability
                <select
                  value={player.availability}
                  onChange={(e) =>
                    demo.editPlayer(player.id, {
                      availability: e.target.value as Availability,
                    })
                  }
                >
                  {["Untouchable", "Core piece", "Listening", "Moveable"].map(
                    (a) => (
                      <option key={a}>{a}</option>
                    ),
                  )}
                </select>
              </label>
              <label className={s.field}>
                Your asking price
                <input
                  value={player.asking}
                  onChange={(e) =>
                    demo.editPlayer(player.id, { asking: e.target.value })
                  }
                />
              </label>
              <small className={s.subtle}>
                Your strategy settings are visible only to you.
              </small>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
