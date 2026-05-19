"use client"

import { useEffect, useState } from "react"
import { HomeTopbar } from "./HomeTopbar"
import { GMNameplate } from "./GMNameplate"
import { OrgChartLines } from "./OrgChartLines"
import { DirectorBox } from "./DirectorBox"
import { DIRECTORS } from "./directors"
import { readStoredTeam } from "@/infrastructure/identity/storedTeam"

// TODO Phase 2+: replace hardcoded GM_DATA with a fetch from /api/gm/me
const GM_DATA = {
  name: "Nick Tricarichi",
  personaKey: "straight_shooter" as const,
  personaLabel: "Straight Shooter",
  championships: 2,
  years: 7,
}

const GRID_GAP = 16
const MOBILE_BREAKPOINT = 768
const TICKER_INTERVAL_MS = 3500

export function HomeScreen() {
  const [tickerTick, setTickerTick] = useState(0)
  const [teamName, setTeamName] = useState<string>("Virginia Founders")
  const [unreadCount, setUnreadCount] = useState(0)
  const [isMobile, setIsMobile] = useState(false)

  // Single shared ticker interval so all directors stay in sync
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
      const stored = team as { teamName?: string; name?: string } | null
      const name = stored?.teamName ?? stored?.name
      if (name && typeof name === "string" && name.trim().length > 0) {
        setTeamName(name)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[HomeScreen] readStoredTeam failed:", err)
    }
  }, [])

  // Fetch inbox unread count for the GM brass plaque
  useEffect(() => {
    fetch("/api/inbox/unread-count")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setUnreadCount(d?.count ?? 0))
      .catch(() => {
        // silent - the plaque just stays at 0
      })
  }, [])

  // Mobile viewport detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  const gmCard = (
    <GMNameplate
      name={GM_DATA.name}
      personaKey={GM_DATA.personaKey}
      personaLabel={GM_DATA.personaLabel}
      championships={GM_DATA.championships}
      years={GM_DATA.years}
      unreadCount={unreadCount}
    />
  )

  const directorBoxes = DIRECTORS.map((d) => (
    <DirectorBox key={d.key} director={d} tickerTick={tickerTick} />
  ))

  return (
    <div style={{ background: "#F5F0E6", minHeight: "100vh" }}>
      <HomeTopbar teamName={teamName} />

      {/* Hero - compact */}
      <div style={{ textAlign: "center", padding: "14px 24px 14px" }}>
        <h1
          style={{
            fontWeight: 800,
            fontSize: isMobile ? 32 : 42,
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
            fontSize: 16,
            color: "#8C7E6A",
            margin: "6px 0 0",
            fontWeight: 400,
          }}
        >
          Organizational Chart
        </p>
      </div>

      {/* Org chart */}
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "0 24px 20px",
        }}
      >
        {isMobile ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: GRID_GAP,
            }}
          >
            {gmCard}
            {directorBoxes}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: GRID_GAP,
              }}
            >
              <div style={{ gridColumn: 2 }}>{gmCard}</div>
            </div>

            <OrgChartLines gap={GRID_GAP} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: GRID_GAP,
              }}
            >
              {directorBoxes}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}