"use client"

import { useEffect, useState } from "react"
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar"
import { GMPersonCard } from "./GMPersonCard"
import { DirectorPersonCard } from "./DirectorPersonCard"
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

const MOBILE_BREAKPOINT = 768
/** Warm khaki field the laminated badges sit on. */
const TAN = "#C7BA9B"

const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, "-")

/** Team-specific GM headshot under public/avatars/gm/, keyed by nickname. */
function gmAvatarFor(teamName: string): string {
  return `/avatars/gm/${slugify(teamNickname(teamName))}.png`
}

export function HomeScreen() {
  const [teamName, setTeamName] = useState<string>("Virginia Founders")
  const [rosterId, setRosterId] = useState<string>("")
  const [unreadCount, setUnreadCount] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const [persona, setPersona] = useState<GmPersona>(FALLBACK_PERSONA)
  const [personaModalOpen, setPersonaModalOpen] = useState(false)
  const [gmStats, setGmStats] = useState<GmStats>({ championships: 0, tenure: 0, titleYears: [] })
  // Full strategy profile - the save endpoint upserts the whole row, so we
  // must POST the complete profile with only gm_persona changed.
  const [strategyProfile, setStrategyProfile] = useState<Record<string, unknown> | null>(null)

  // Pull team identity from stored auth
  useEffect(() => {
    try {
      const team = readStoredTeam()
      const stored = team as
        | { teamName?: string; name?: string; rosterId?: string }
        | null
      const name = stored?.teamName ?? stored?.name
      // Defer off the synchronous effect path (avoids cascading-render lint).
      queueMicrotask(() => {
        if (name && typeof name === "string" && name.trim().length > 0) {
          setTeamName(name)
        }
        if (stored?.rosterId) {
          setRosterId(stored.rosterId)
        }
      })
    } catch {
      /* keep the default placeholder team */
    }
  }, [])

  // Fetch inbox unread count for the GM badge status
  useEffect(() => {
    fetch("/api/inbox/unread-count")
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setUnreadCount(d?.count ?? 0))
      .catch(() => {
        // silent - the badge just stays at "all clear"
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
        // silent - badge falls back to zeros until data loads
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

  const nicknameSlug = slugify(teamNickname(teamName))
  const theme = teamTheme(nicknameSlug)
  const crestSrc = `/teams/${nicknameSlug}.png`
  const gmName = gmNameFor(teamName) ?? "General Manager"

  // The torn "FRONT OFFICE" hero strip that sits under the team banner.
  const frontOfficeHero = (small: boolean) => {
    const d = small ? 4 : 6 // 3D extrude depth
    const shadow = Array.from({ length: d }, (_, i) => `${i + 1}px ${i + 1}px 0 #0E2A4E`).join(",")
    return (
      <div style={{ display: "flex", alignItems: "center", gap: small ? 12 : 20, flexShrink: 0, marginTop: small ? 10 : 22, marginBottom: small ? 4 : 12 }}>
        <span
          style={{
            fontFamily: "'Bowlby One SC', system-ui, sans-serif",
            fontSize: small ? 19 : 30,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            color: "#E2B23C",
            WebkitTextStroke: `${small ? 1 : 1.5}px #0E2A4E`,
            textShadow: shadow,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          Front Office
        </span>
        <div style={{ flex: 1, height: small ? 3 : 4, background: "#0E2A4E" }} />
      </div>
    )
  }

  const gmCard = (
    <GMPersonCard
      name={gmName}
      teamName={teamName}
      crestSrc={crestSrc}
      persona={persona}
      personaLabel={PERSONA_LABELS[persona]}
      championships={gmStats.championships}
      years={gmStats.tenure}
      unreadCount={unreadCount}
      avatarSrc={gmAvatarFor(teamName)}
      onPersonaClick={() => setPersonaModalOpen(true)}
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

  // ── Mobile: vertical scroll of the four full badges ──
  if (isMobile) {
    return (
      <div style={{ background: TAN, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <UnifiedTopbar />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "12px 12px 28px" }}>
          <div style={{ maxWidth: 430, width: "100%", margin: "0 auto" }}>
            <TeamMasthead teamName={teamName} crestSrc={crestSrc} theme={theme} seasons={gmStats.tenure} rings={gmStats.championships} titleYears={gmStats.titleYears} compact />
            {frontOfficeHero(true)}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 6 }}>
              <div style={{ height: 460, flexShrink: 0 }}>{gmCard}</div>
              {DIRECTORS.map((d) => (
                <div key={d.key} style={{ height: 460, flexShrink: 0 }}>
                  <DirectorPersonCard director={d} teamName={teamName} crestSrc={crestSrc} />
                </div>
              ))}
            </div>
          </div>
        </div>
        {personaModal}
      </div>
    )
  }

  // ── Desktop: one row of four ID badges ──
  return (
    <div style={{ background: TAN, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <UnifiedTopbar />

      <div
        style={{
          maxWidth: 1228,
          width: "100%",
          margin: "0 auto",
          padding: "22px 24px 18px",
          boxSizing: "border-box",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <TeamMasthead teamName={teamName} crestSrc={crestSrc} theme={theme} seasons={gmStats.tenure} rings={gmStats.championships} titleYears={gmStats.titleYears} />

        {frontOfficeHero(false)}

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 16,
              height: "min(100%, 460px)",
            }}
          >
            <div style={{ minHeight: 0, minWidth: 0 }}>{gmCard}</div>
            {DIRECTORS.map((d) => (
              <div key={d.key} style={{ minHeight: 0, minWidth: 0 }}>
                <DirectorPersonCard director={d} teamName={teamName} crestSrc={crestSrc} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {personaModal}
    </div>
  )
}
