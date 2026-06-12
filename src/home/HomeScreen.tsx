"use client"

import { useEffect, useState } from "react"
import { HomeTopbar } from "./HomeTopbar"
import { GMPersonCard } from "./GMPersonCard"
import { OrgChartLines } from "./OrgChartLines"
import { DirectorPersonCard } from "./DirectorPersonCard"
import { DIRECTORS } from "./directors"
import { readStoredTeam } from "@/infrastructure/identity/storedTeam"
import { Icon } from "@/shared/ui/Icon"
import PersonaPicker from "@/inbox/persona/PersonaPicker"
import type { GmPersona } from "@/research-strategy/api/types"

// TODO Phase 2+: replace hardcoded GM_DATA with a fetch from /api/gm/me
const GM_DATA = {
  name: "Nick Tricarichi",
  personaKey: "straight_shooter" as GmPersona,
  championships: 2,
  years: 7,
}

const PERSONA_LABELS: Record<GmPersona, string> = {
  closer: "The Closer",
  straight_shooter: "Straight Shooter",
  architect: "The Architect",
  hustler: "The Hustler",
}

const GRID_GAP = 16
const MOBILE_BREAKPOINT = 768
const TICKER_INTERVAL_MS = 3500

export function HomeScreen() {
  const [tickerTick, setTickerTick] = useState(0)
  const [teamName, setTeamName] = useState<string>("Virginia Founders")
  const [rosterId, setRosterId] = useState<string>("")
  const [unreadCount, setUnreadCount] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const [persona, setPersona] = useState<GmPersona>(GM_DATA.personaKey)
  const [personaModalOpen, setPersonaModalOpen] = useState(false)
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
      // Diagnostic - kept from Phase 0 to debug the "—" placeholder issue
      // eslint-disable-next-line no-console
      console.log("[HomeScreen] readStoredTeam:", team)
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[HomeScreen] readStoredTeam failed:", err)
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

  const gmCard = (
    <GMPersonCard
      name={GM_DATA.name}
      persona={persona}
      personaLabel={PERSONA_LABELS[persona]}
      championships={GM_DATA.championships}
      years={GM_DATA.years}
      unreadCount={unreadCount}
      onPersonaClick={() => setPersonaModalOpen(true)}
      isMobile={isMobile}
    />
  )

  const directorBoxes = DIRECTORS.map((d) => (
    <DirectorPersonCard
      key={d.key}
      director={d}
      tickerTick={tickerTick}
      isMobile={isMobile}
    />
  ))

  const hero = (
    <div style={{ textAlign: "center", padding: "10px 24px", flexShrink: 0 }}>
      <h1
        style={{
          fontWeight: 800,
          fontSize: isMobile ? 30 : 34,
          letterSpacing: "-0.02em",
          textTransform: "uppercase",
          lineHeight: 1,
          margin: 0,
        }}
      >
        {teamName}
      </h1>
      <p
        style={{
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontSize: 14,
          color: "#8C7E6A",
          margin: "4px 0 0",
          fontWeight: 400,
        }}
      >
        Organizational Chart
      </p>
    </div>
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
          padding: 24,
          maxWidth: 720,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setPersonaModalOpen(false)}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#1A1A1A",
              padding: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <PersonaPicker value={persona} onChange={savePersona} />
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <div style={{ background: "#F5F0E6", minHeight: "100vh" }}>
        <HomeTopbar teamName={teamName} />
        {hero}
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            padding: "0 24px 20px",
            display: "flex",
            flexDirection: "column",
            gap: GRID_GAP,
          }}
        >
          {gmCard}
          {directorBoxes}
        </div>
        {personaModal}
      </div>
    )
  }

  // Desktop: the whole org chart is locked to the viewport - no page
  // scroll. The two card rows split the leftover height evenly, and the
  // headshots inside the cards absorb the flex, so every card is the
  // exact same height on any screen.
  return (
    <div
      style={{
        background: "#F5F0E6",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <HomeTopbar teamName={teamName} />
      {hero}

      <div
        style={{
          maxWidth: 1280,
          width: "100%",
          margin: "0 auto",
          padding: "0 24px 18px",
          boxSizing: "border-box",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: GRID_GAP,
            flex: 1,
            minHeight: 0,
          }}
        >
          <div style={{ gridColumn: 2, minHeight: 0 }}>{gmCard}</div>
        </div>

        <OrgChartLines gap={GRID_GAP} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: GRID_GAP,
            flex: 1,
            minHeight: 0,
          }}
        >
          {directorBoxes.map((box, i) => (
            <div key={DIRECTORS[i].key} style={{ minHeight: 0 }}>
              {box}
            </div>
          ))}
        </div>
      </div>

      {personaModal}
    </div>
  )
}
