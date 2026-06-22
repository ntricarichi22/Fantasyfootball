"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/shared/ui/Icon";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import { DIRECTORS } from "@/home/directors";
import PersonaPicker from "@/inbox/persona/PersonaPicker";
import type { GmPersona } from "@/research-strategy/api/types";

// One bar for the whole app. Driven by the same DIRECTORS source-of-truth the
// home cards use, so adding a door/responsibility there updates the bar too.
//
//   Tier 1 (Home "/")  → bare bar; the home cards do the navigating.
//   Tier 2 (a door)    → wordmark = the door, tabs = Office + its workrooms.
//   Tier 3 (a workroom)→ same bar, the deeper tab is lit.
//
// The CFC block is the "navigator": click it for a grouped menu that jumps to
// any door/responsibility in one move.

type MobileSearchConfig = {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

type UnifiedTopbarProps = {
  historianHref?: string;
  mobileSearch?: MobileSearchConfig;
  // Optional mobile-only affordance (e.g. Inbox's folder drawer). The CFC
  // block owns the nav navigator, so a page that needs its own drawer passes
  // this to get a second mobile icon button.
  onMenuClick?: () => void;
};

// Tabs are gated to routes that actually ship, so a workroom listed in
// directors.ts without a page yet (e.g. Mock Draft) doesn't render a 404 tab.
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
type Door = { key: string; word: string; match: string[]; tabs: Tab[] };

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

// Inbox isn't a director — it's the GM's own door — so it's modelled here.
const INBOX_DOOR: Door = {
  key: "inbox",
  word: "INBOX",
  match: ["/inbox"],
  tabs: [],
};

function buildDoors(): Door[] {
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
    };
  });
  return [INBOX_DOOR, ...directorDoors];
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

export function UnifiedTopbar({ historianHref = "/historian", mobileSearch, onMenuClick }: UnifiedTopbarProps) {
  const path = usePathname() || "/";
  const isMobile = useIsMobile();
  const doors = useMemo(() => buildDoors(), []);

  const isHome = path === "/";
  const door = activeDoor(doors, path);
  const tabIdx = door ? activeTabIndex(door, path) : 0;

  const stored = readStoredTeam() as
    | { teamName?: string; name?: string; rosterId?: string }
    | null;
  const teamName = stored?.teamName ?? stored?.name ?? "—";
  const rosterId = stored?.rosterId ?? "";
  const initials = getInitials(teamName);

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

  const wordmark = isHome || !door ? "FRONT OFFICE" : door.word;

  const brandBlock = (
    <button
      type="button"
      onClick={() => setNavOpen((o) => !o)}
      aria-label="Navigation menu"
      aria-expanded={navOpen}
      style={{
        background: "#1A1A1A",
        border: "none",
        padding: isMobile ? "10px 18px 10px 12px" : "11px 26px 11px 16px",
        clipPath:
          "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
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
      {!isMobile && (
        <span
          style={{
            color: "#FEFCF9",
            fontFamily: FH,
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: "0.05em",
          }}
        >
          {wordmark}
        </span>
      )}
      <Caret up={navOpen} />
    </button>
  );

  const teamAvatar = (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      aria-label="Settings"
      style={{
        width: isMobile ? 24 : 26,
        height: isMobile ? 24 : 26,
        background: "#3366CC",
        border: "2px solid #1A1A1A",
        color: "#FEFCF9",
        fontFamily: FH,
        fontWeight: 900,
        fontSize: isMobile ? 10 : 11,
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      {initials}
    </button>
  );

  const tabs = !isHome && door ? door.tabs : [];

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          background: "#F5F0E6",
          borderBottom: "3px solid #1A1A1A",
          position: "relative",
        }}
      >
        {brandBlock}

        {isMobile && mobileSearch ? (
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
          <>
            {/* Responsibility tabs (Office + workrooms). Hidden on Home. */}
            <nav style={{ display: "flex", alignItems: "stretch", marginLeft: isMobile ? 8 : 12, minWidth: 0, overflow: "hidden" }}>
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
                      padding: isMobile ? "0 9px" : "0 13px",
                      fontFamily: FH,
                      fontWeight: 800,
                      fontSize: isMobile ? 10.5 : 11.5,
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
                          bottom: -3,
                          height: 3,
                          background: "#3366CC",
                        }}
                      />
                    )}
                  </a>
                );
              })}
            </nav>

            <div style={{ flex: 1, minWidth: 0 }} />

            {!isMobile && (
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
            )}
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

        {/* The navigator — grouped jump to any door/responsibility. */}
        {navOpen && (
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
                left: isMobile ? 8 : 12,
                zIndex: 41,
                background: "#F5F0E6",
                border: "3px solid #1A1A1A",
                boxShadow: "6px 6px 0 #1A1A1A",
                width: 230,
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
                      {d.word}
                    </a>
                    {onDoor &&
                      d.tabs.map((tab, i) => {
                        const onTab = i === tabIdx;
                        return (
                          <a
                            key={tab.href}
                            href={tab.href}
                            style={{
                              display: "block",
                              padding: "5px 12px 5px 24px",
                              marginLeft: onTab ? 19 : 0,
                              paddingLeft: onTab ? 12 : 24,
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
