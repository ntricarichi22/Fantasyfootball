"use client"

import { useEffect, useState } from "react"
import { HomeTopbar } from "./HomeTopbar"
import { GMPersonCard } from "./GMPersonCard"
import { MobileOrgLines } from "./MobileOrgLines"
import { DirectorPersonCard } from "./DirectorPersonCard"
import { DirectorTabBar, type DirectorTab } from "./DirectorTabBar"
import { TeamMasthead } from "./TeamMasthead"
import { teamTheme } from "./teamTheme"
import { DIRECTORS } from "./directors"
import { gmNameFor } from "./gmNames"
import { readStoredTeam } from "@/infrastructure/identity/storedTeam"
import { teamNickname } from "@/shared/league-data/nicknames"
import { Icon } from "@/shared/ui/Icon"
import PersonaPicker from "@/inbox/persona/PersonaPicker"
import type { GmPersona } from "@/research-strategy/api/types"

const FALLBACK_PERSONA: GmPersona = "straight_shooter"

type GmStats = { championships: number; tenure: number; titleYears: number[] }

const PERSONA_LABELS: Record<GmPersona, string> = {
  closer: "The Closer",
  straight_shooter: "Straight Shooter",
  architect: "The Architect",
  hustler: "The Hustler",
}

const GRID_GAP = 14
const MOBILE_BREAKPOINT = 768
const TICKER_INTERVAL_MS = 3500

const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, "-")

/** Team-specific GM headshot under public/avatars/gm/, keyed by nickname. */
function gmAvatarFor(teamName: string): string {
  return `/avatars/gm/${slugify(teamNickname(teamName))}.png`
}

/** Short tab label: drop the "Pro " from "Pro Personnel". */
function tabLabel(title: string): string {
  return title.replace(/^Pro\s+/i, "")
}

export function HomeScreen() {
  const [tickerTick, setTickerTick] = useState(0)
  const [teamName, setTeamName] = useState<string>("Virginia Founders")
  const [rosterId, setRosterId] = useState<string>("")
  const [unreadCount, setUnreadCount] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const [persona, setPersona] = useState<GmPersona>(FALLBACK_PERSONA)
  const [personaModalOpen, setPersonaModalOpen] = useState(false)
  const [activeDirector, setActiveDirector] = useState<string | null>(null)
  const [gmStats, setGmStats] = useState<GmStats>({ championships: 0, tenure: 0, titleYears: [] })
  // Full strategy profile - the save endpoint upserts the whole row, so we
  // must POST the complete profile with only gm_persona changed.
  const [strategyProfile, setStrategyProfile] = useState<Record<string, unknown> | null>(null)

  // Single shared ticker interval so all door teasers stay in sync
  useEffect(() => {
    const id = setInterval(() => setTickerTick((t) => t + 1), TICKER_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Pull team identity from stored auth
  useEffect(() => {
    try {
      const team = readStoredTeam()
      const stored = team as
        | { teamName?: string; name?: string; rosterId?: string }
        | null
      const name = stored?.teamName ?? stored?.name
      if (name && typeof name === "string" && name.trim().length > 0) {
        setTeamName(name)
      }
      if (stored?.rosterId) {
        setRosterId(stored.rosterId)
      }
    } catch {
      /* keep the default placeholder team */
    }
  }, [])

  // Fetch inbox unread count for the GM door status
  useEffect(() => {
    fetch("/api/inbox/unread-count")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setUnreadCount(d?.count ?? 0))
      .catch(() => {
        // silent - the door just stays at "all caught up"
      })
  }, [])

  // Fetch the GM's all-time record (championships, tenure, title years)
  useEffect(() => {
    if (!rosterId) return
    fetch(`/api/gm/me?teamId=${encodeURIComponent(rosterId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.tenure === "number") {
          setGmStats({ championships: d.championships ?? 0, tenure: d.tenure ?? 0, titleYears: d.titleYears ?? [] })
        }
      })
      .catch(() => {
        // silent - card falls back to zeros until data loads
      })
  }, [rosterId])

  // Load the saved persona from the team strategy profile
  useEffect(() => {
    if (!rosterId) return
    fetch(`/api/research-strategy/strategy?teamId=${encodeURIComponent(rosterId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.data) {
          setStrategyProfile(j.data as Record<string, unknown>)
          if (j.data.gm_persona) setPersona(j.data.gm_persona as GmPersona)
        }
      })
      .catch(() => {})
  }, [rosterId])

  const savePersona = async (next: GmPersona) => {
    setPersona(next)
    setPersonaModalOpen(false)
    // Without the loaded profile a partial POST would wipe the other
    // strategy fields, so only persist once it's available.
    if (!rosterId || !strategyProfile) return
    const profile = { ...strategyProfile, gm_persona: next }
    setStrategyProfile(profile)
    try {
      await fetch("/api/research-strategy/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: rosterId, profile }),
      })
    } catch {
      /* silent */
    }
  }

  // Mobile viewport detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  const theme = teamTheme(slugify(teamNickname(teamName)))
  const crestSrc = `/teams/${slugify(teamName)}.png`
  const gmName = gmNameFor(teamName)
  const gmDisplayName = gmName ? `${gmName}, GM` : "General Manager"

  const gmCard = (fixedPortrait: boolean) => (
    <GMPersonCard
      name={gmDisplayName}
      persona={persona}
      personaLabel={PERSONA_LABELS[persona]}
      championships={gmStats.championships}
      years={gmStats.tenure}
      unreadCount={unreadCount}
      avatarSrc={gmAvatarFor(teamName)}
      onPersonaClick={() => setPersonaModalOpen(true)}
      fixedPortrait={fixedPortrait}
    />
  )

  const personaModal = personaModalOpen && (
    <div
      onClick={() => setPersonaModalOpen(false)}
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
          padding: isMobile ? 16 : 24,
          maxWidth: 720,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => setPersonaModalOpen(false)}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#1A1A1A", padding: 0, display: "flex", alignItems: "center" }}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <PersonaPicker value={persona} onChange={savePersona} />
      </div>
    </div>
  )

  // ── Mobile: compact masthead, fixed GM card, tabs, slide-up sheet ──
  if (isMobile) {
    const tabs: DirectorTab[] = DIRECTORS.map((d) => ({
      key: d.key,
      label: tabLabel(d.title),
      avatarSrc: d.avatarSrc,
      color: d.accentColor,
      active: true,
    }))
    const activeCfg = DIRECTORS.find((d) => d.key === activeDirector) ?? null
    const closeSheet = () => setActiveDirector(null)
    const toggleSheet = (key: string) => setActiveDirector((cur) => (cur === key ? null : key))

    return (
      <div style={{ background: "#F5F0E6", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <HomeTopbar teamName={teamName} />

        <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 0, padding: "8px 10px 0", display: "flex", flexDirection: "column", gap: 8 }}>
            <TeamMasthead teamName={teamName} crestSrc={crestSrc} theme={theme} seasons={gmStats.tenure} rings={gmStats.championships} titleYears={gmStats.titleYears} compact />
            <div style={{ flex: 1, minHeight: 0 }}>{gmCard(false)}</div>
            <MobileOrgLines />
          </div>

          {activeCfg && (
            <>
              <div onClick={closeSheet} style={{ position: "absolute", inset: 0, background: "rgba(26,26,26,0.4)", zIndex: 5 }} />
              <div style={{ position: "absolute", left: 8, right: 8, bottom: 8, top: 56, zIndex: 6, display: "flex", flexDirection: "column" }}>
                <div onClick={closeSheet} style={{ width: 38, height: 4, borderRadius: 2, background: "#B4B2A9", margin: "0 auto 8px", flexShrink: 0, cursor: "pointer" }} />
                <div style={{ flex: 1, minHeight: 0 }}>
                  <DirectorPersonCard director={activeCfg} tickerTick={tickerTick} />
                </div>
              </div>
            </>
          )}
        </div>

        <DirectorTabBar items={tabs} activeKey={activeDirector} onSelect={toggleSheet} />
        {personaModal}
      </div>
    )
  }

  // ── Desktop: team masthead + one row of four portrait cards ──
  return (
    <div style={{ background: "#F5F0E6", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <HomeTopbar teamName={teamName} />

      <div
        style={{
          maxWidth: 1180,
          width: "100%",
          margin: "0 auto",
          padding: "16px 24px 20px",
          boxSizing: "border-box",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <TeamMasthead teamName={teamName} crestSrc={crestSrc} theme={theme} seasons={gmStats.tenure} rings={gmStats.championships} titleYears={gmStats.titleYears} />

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: GRID_GAP, height: "min(100%, 460px)" }}>
            <div style={{ minHeight: 0 }}>{gmCard(true)}</div>
            {DIRECTORS.map((d) => (
              <div key={d.key} style={{ minHeight: 0 }}>
                <DirectorPersonCard director={d} tickerTick={tickerTick} fixedPortrait />
              </div>
            ))}
          </div>
        </div>
      </div>

      {personaModal}
    </div>
  )
}
