"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/shared/ui/Icon";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { teamCrestSrc, gmAvatarSrc } from "@/shared/league-data/nicknames";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import { DIRECTORS } from "@/home/directors";
import { NAVY, AMBER, RED } from "@/home/BadgeShell";
import PersonaPicker from "@/inbox/persona/PersonaPicker";
import type { GmPersona } from "@/research-strategy/api/types";

// One bar for the whole app, driven by the same DIRECTORS source-of-truth the
// home cards use, so adding a door/responsibility there updates the bar too.
//
//   Row 1 — every door (Inbox + each director), each wearing a shrunken copy
//           of its home-screen employee badge. Identical on every page, Home
//           included; the door you're inside gets the black bar.
//   Row 2 — the active door's responsibilities (Office + workrooms), blue tab.
//
// Desktop has no dropdown: every door is one click away in the bar, and the
// CFC block is a plain home link. Mobile keeps the CFC menu, but it's a fixed
// directory — every door with all its workrooms, never reshaped by where
// you're standing.

type MobileSearchConfig = {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

type UnifiedTopbarProps = {
  historianHref?: string;
  mobileSearch?: MobileSearchConfig;
  // Optional mobile-only affordance (e.g. Inbox's folder drawer). The CFC
  // block owns the nav directory, so a page that needs its own drawer passes
  // this to get a second mobile icon button.
  onMenuClick?: () => void;
};

// Tabs are gated to routes that actually ship, so a workroom listed in
// directors.ts without a page yet doesn't render a 404 tab.
const SHIPPED_ROUTES = new Set<string>([
  "/inbox",
  "/scouting",
  "/scouting/big-board",
  "/scouting/draft-room",
  "/scouting/mock-draft",
  "/personnel-office",
  "/pro-personnel/trade-builder",
  "/pro-personnel/trade-studio",
  "/strategy",
  "/strategy/set-strategy",
  "/strategy/set-availability",
]);

type Tab = { label: string; href: string; match: string };
type Door = {
  key: string;
  word: string;
  match: string[];
  tabs: Tab[];
  // Shrunken employee badge: the same headshot + field color the door's
  // home-screen ID badge uses (GM amber for Inbox, director red otherwise).
  badgeSrc: string | null;
  badgeField: string;
};

const FH = "Syne, sans-serif";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

function stripQuery(href: string): string {
  return href.split("?")[0];
}

function getInitials(teamName: string): string {
  if (!teamName || teamName === "—") return "—";
  const words = teamName.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function buildDoors(teamName: string): Door[] {
  // Inbox isn't a director — it's the GM's own door — so it's modelled here.
  const inboxDoor: Door = {
    key: "inbox",
    word: "INBOX",
    match: ["/inbox"],
    tabs: [],
    badgeSrc: gmAvatarSrc(teamName),
    badgeField: AMBER,
  };
  const directorDoors: Door[] = DIRECTORS.map((d) => {
    // Pro Personnel has two office routes (/personnel-office is the trade door,
    // /pro-personnel is the office landing) — match both to the same door.
    const extraMatch = d.officeHref === "/personnel-office" ? ["/pro-personnel"] : [];
    return {
      key: d.key,
      word: d.title.toUpperCase(),
      match: [stripQuery(d.officeHref), ...extraMatch, ...d.workrooms.map((w) => stripQuery(w.href))],
      tabs: [
        { label: "Office", href: d.officeHref, match: stripQuery(d.officeHref) },
        ...d.workrooms.map((w) => ({ label: w.title, href: w.href, match: stripQuery(w.href) })),
      ].filter((t) => SHIPPED_ROUTES.has(t.match)),
      badgeSrc: d.avatarSrc,
      badgeField: RED,
    };
  });
  return [inboxDoor, ...directorDoors];
}

// Longest-prefix match so "/strategy/set-strategy" beats "/strategy".
function activeDoor(doors: Door[], path: string): Door | null {
  let best: Door | null = null;
  let bestLen = 0;
  for (const door of doors) {
    for (const m of door.match) {
      if ((path === m || path.startsWith(m + "/")) && m.length > bestLen) {
        best = door;
        bestLen = m.length;
      }
    }
  }
  return best;
}

function activeTabIndex(door: Door, path: string): number {
  let idx = 0;
  let bestLen = -1;
  door.tabs.forEach((tab, i) => {
    const m = tab.match;
    if ((path === m || path.startsWith(m + "/")) && m.length > bestLen) {
      idx = i;
      bestLen = m.length;
    }
  });
  return idx;
}

function Caret({ up = false }: { up?: boolean }) {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polyline
        points={up ? "6 15 12 9 18 15" : "6 9 12 15 18 9"}
        fill="none"
        stroke="#F5C230"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A door's employee badge shrunk to bar scale — the same portrait treatment
// as BadgeShell's Portrait: colored field, navy frame, grayscale headshot
// sitting flush to the bottom. Key it by src so a late-loading team name
// (Inbox's GM headshot) resets the error state.
function DoorBadge({ src, field }: { src: string | null; field: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden="true"
      style={{
        width: 30,
        height: 33,
        background: field,
        border: `2px solid ${NAVY}`,
        borderRadius: 3,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      {src && !failed && (
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "auto", display: "block", filter: "grayscale(1)" }}
        />
      )}
    </span>
  );
}

export function UnifiedTopbar({ historianHref = "/historian", mobileSearch, onMenuClick }: UnifiedTopbarProps) {
  const path = usePathname() || "/";
  const isMobile = useIsMobile();

  const stored = readStoredTeam() as
    | { teamName?: string; name?: string; rosterId?: string }
    | null;
  const teamName = stored?.teamName ?? stored?.name ?? "—";
  const rosterId = stored?.rosterId ?? "";
  const initials = getInitials(teamName);
  const crestSrc = teamCrestSrc(teamName);
  const [crestFailed, setCrestFailed] = useState(false);

  const doors = useMemo(() => buildDoors(teamName), [teamName]);
  const door = activeDoor(doors, path);
  const tabIdx = door ? activeTabIndex(door, path) : 0;

  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [persona, setPersona] = useState<GmPersona>("straight_shooter");
  // The save endpoint upserts the whole row, so we must POST the complete
  // profile with only gm_persona changed.
  const [strategyProfile, setStrategyProfile] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!settingsOpen || !rosterId) return;
    fetch(`/api/research-strategy/strategy?teamId=${encodeURIComponent(rosterId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.data) {
          setStrategyProfile(j.data as Record<string, unknown>);
          if (j.data.gm_persona) setPersona(j.data.gm_persona as GmPersona);
        }
      })
      .catch(() => {});
  }, [settingsOpen, rosterId]);

  const savePersona = async (next: GmPersona) => {
    setPersona(next);
    if (!rosterId || !strategyProfile) return;
    const profile = { ...strategyProfile, gm_persona: next };
    setStrategyProfile(profile);
    try {
      await fetch("/api/research-strategy/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, profile }),
      });
    } catch {
      /* silent */
    }
  };

  const brandStyle = {
    background: "#1A1A1A",
    border: "none",
    padding: isMobile ? "10px 18px 10px 12px" : "11px 24px 11px 16px",
    clipPath:
      "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    cursor: "pointer",
    textDecoration: "none",
  } as const;
  const brandMark = (
    <span
      style={{
        color: "#F5C230",
        fontFamily: FH,
        fontWeight: 900,
        fontSize: isMobile ? 12 : 14,
        letterSpacing: "0.02em",
      }}
    >
      CFC
    </span>
  );
  // Desktop: plain home link (the doors live in the bar, so there's no menu).
  // Mobile: toggles the directory dropdown.
  const brandBlock = isMobile ? (
    <button
      type="button"
      onClick={() => setNavOpen((o) => !o)}
      aria-label="Navigation menu"
      aria-expanded={navOpen}
      style={brandStyle}
    >
      {brandMark}
      <Caret up={navOpen} />
    </button>
  ) : (
    <a href="/" aria-label="Home" style={brandStyle}>
      {brandMark}
    </a>
  );

  const showCrest = !!crestSrc && !crestFailed;
  const teamAvatar = (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      aria-label="Settings"
      style={{
        width: isMobile ? 26 : 28,
        height: isMobile ? 26 : 28,
        background: showCrest ? "#FEFCF9" : "#3366CC",
        border: "2px solid #1A1A1A",
        color: "#FEFCF9",
        fontFamily: FH,
        fontWeight: 900,
        fontSize: isMobile ? 10 : 11,
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {showCrest ? (
        <img
          src={crestSrc}
          alt={teamName}
          onError={() => setCrestFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        initials
      )}
    </button>
  );

  const tabs = door?.tabs ?? [];
  const showTabsRow = tabs.length > 0;

  return (
    <>
      <div style={{ background: "#F5F0E6", position: "relative" }}>
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            // 1.5× the original bar height so the badges get real presence.
            minHeight: isMobile ? undefined : 66,
          }}
        >
          {brandBlock}

          {isMobile ? (
            mobileSearch ? (
              <div style={{ flex: 1, minWidth: 0, padding: "6px 6px 6px 0", display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    background: "#FEFCF9",
                    border: "2px solid #1A1A1A",
                    padding: "5px 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                  }}
                >
                  <span style={{ color: "#8C7E6A", display: "flex", flexShrink: 0 }}>
                    <Icon name="search" size={13} />
                  </span>
                  <input
                    type="text"
                    value={mobileSearch.value}
                    onChange={(e) => mobileSearch.onChange(e.target.value)}
                    placeholder={mobileSearch.placeholder}
                    style={{
                      flex: 1,
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      fontSize: 12,
                      color: "#1A1A1A",
                      fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                      minWidth: 0,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 0 }} />
            )
          ) : (
            <>
              {/* The doors — every department wearing its mini ID badge.
                  cfc-hscroll: on narrow screens the strip scrolls horizontally
                  instead of silently clipping doors. */}
              <nav
                className="cfc-hscroll"
                style={{ display: "flex", alignItems: "stretch", marginLeft: 12, minWidth: 0 }}
              >
                {doors.map((d) => {
                  const on = door?.key === d.key;
                  const headHref = d.tabs[0]?.href ?? d.match[0];
                  return (
                    <a
                      key={d.key}
                      href={headHref}
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "0 11px",
                        fontFamily: FH,
                        fontWeight: 800,
                        fontSize: 11.5,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                        color: on ? "#1A1A1A" : "#8C7E6A",
                      }}
                    >
                      <DoorBadge key={d.badgeSrc ?? "none"} src={d.badgeSrc} field={d.badgeField} />
                      {d.word}
                      {on && (
                        <span
                          style={{
                            position: "absolute",
                            left: 8,
                            right: 8,
                            bottom: 0,
                            height: 3,
                            background: "#1A1A1A",
                          }}
                        />
                      )}
                    </a>
                  );
                })}
              </nav>

              <div style={{ flex: 1, minWidth: 0 }} />

              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 14px" }}>
                <span style={{ color: "#1A1A1A", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-body, 'DM Sans', sans-serif)" }}>
                  {teamName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = historianHref;
                  }}
                  aria-label="Historian"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#1A1A1A", padding: 0, display: "flex", alignItems: "center" }}
                >
                  <Icon name="search" size={17} />
                </button>
                {teamAvatar}
              </div>
            </>
          )}

          {isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px" }}>
              {onMenuClick && (
                <button
                  type="button"
                  onClick={onMenuClick}
                  aria-label="Open menu"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#1A1A1A", padding: 0, display: "flex", alignItems: "center" }}
                >
                  <Icon name="menu" size={18} />
                </button>
              )}
              {teamAvatar}
            </div>
          )}
        </div>

        {/* Responsibility tabs (Office + workrooms) for the active door. */}
        {showTabsRow && (
          <nav
            className="cfc-hscroll"
            style={{ display: "flex", alignItems: "stretch", background: "#EFE7D2", padding: isMobile ? "0 8px" : "0 12px" }}
          >
            {tabs.map((tab, i) => {
              const on = i === tabIdx;
              return (
                <a
                  key={tab.href}
                  href={tab.href}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    padding: isMobile ? "8px 9px" : "8px 13px",
                    fontFamily: FH,
                    fontWeight: 800,
                    fontSize: isMobile ? 10.5 : 11,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    color: on ? "#1A1A1A" : "#8C7E6A",
                  }}
                >
                  {tab.label}
                  {on && (
                    <span
                      style={{
                        position: "absolute",
                        left: isMobile ? 6 : 10,
                        right: isMobile ? 6 : 10,
                        bottom: 0,
                        height: 3,
                        background: "#3366CC",
                      }}
                    />
                  )}
                </a>
              );
            })}
          </nav>
        )}

        {/* Mobile directory — every door with all its workrooms, always. */}
        {isMobile && navOpen && (
          <>
            <div
              onClick={() => setNavOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 40 }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 3px)",
                left: 8,
                zIndex: 41,
                background: "#F5F0E6",
                border: "3px solid #1A1A1A",
                boxShadow: "6px 6px 0 #1A1A1A",
                width: 250,
                maxHeight: "80vh",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  padding: "7px 12px",
                  fontFamily: FM,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "#8C7E6A",
                  borderBottom: "2px solid #1A1A1A",
                }}
              >
                Front Office
              </div>
              {doors.map((d) => {
                const onDoor = door?.key === d.key;
                const headHref = d.tabs[0]?.href ?? d.match[0];
                return (
                  <div key={d.key} style={{ background: onDoor ? "#EFE7D2" : "transparent" }}>
                    <a
                      href={headHref}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        fontFamily: FH,
                        fontWeight: onDoor ? 900 : 800,
                        fontSize: 12,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        textDecoration: "none",
                        color: "#1A1A1A",
                      }}
                    >
                      <DoorBadge key={d.badgeSrc ?? "none"} src={d.badgeSrc} field={d.badgeField} />
                      {d.word}
                    </a>
                    {d.tabs.map((tab, i) => {
                      const onTab = onDoor && i === tabIdx;
                      // Sub-rows indent to where the door label starts (badge
                      // 30 + gap 8 + padding 12 = 50).
                      return (
                        <a
                          key={tab.href}
                          href={tab.href}
                          style={{
                            display: "block",
                            padding: onTab ? "5px 12px 5px 9px" : "5px 12px 5px 50px",
                            marginLeft: onTab ? 38 : 0,
                            borderLeft: onTab ? "3px solid #3366CC" : "none",
                            fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                            fontSize: 12,
                            fontWeight: onTab ? 700 : 600,
                            textDecoration: "none",
                            color: onTab ? "#1A1A1A" : "#8C7E6A",
                          }}
                        >
                          {tab.label}
                        </a>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26,26,26,0.6)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#F5F0E6",
              border: "3px solid #1A1A1A",
              boxShadow: "6px 6px 0 #1A1A1A",
              padding: 24,
              maxWidth: 720,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div
                style={{
                  fontFamily: FH,
                  fontWeight: 900,
                  fontSize: 18,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "#1A1A1A",
                }}
              >
                Settings
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#1A1A1A", padding: 0, display: "flex", alignItems: "center" }}
              >
                <Icon name="x" size={20} />
              </button>
            </div>
            <PersonaPicker value={persona} onChange={savePersona} />
          </div>
        </div>
      )}
    </>
  );
}
