"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/shared/ui/Icon";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import { useIsMobile } from "@/infrastructure/hooks/useIsMobile";
import PersonaPicker from "@/inbox/persona/PersonaPicker";
import type { GmPersona } from "@/research-strategy/api/types";

type MobileSearchConfig = {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

type InnerTopbarProps = {
  breadcrumb: string;
  historianHref?: string;
  onMenuClick?: () => void;
  mobileSearch?: MobileSearchConfig;
};

function getInitials(teamName: string): string {
  if (!teamName || teamName === "—") return "—";
  const words = teamName.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const FH = "Syne, sans-serif";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

export function InnerTopbar({
  breadcrumb,
  historianHref = "/historian",
  onMenuClick,
  mobileSearch,
}: InnerTopbarProps) {
  const stored = readStoredTeam() as
    | { teamName?: string; name?: string; rosterId?: string }
    | null;
  const teamName = stored?.teamName ?? stored?.name ?? "—";
  const rosterId = stored?.rosterId ?? "";
  const initials = getInitials(teamName);
  const isMobile = useIsMobile();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [persona, setPersona] = useState<GmPersona>("straight_shooter");
  // Full strategy profile - the save endpoint upserts the whole row, so we
  // must POST the complete profile with only gm_persona changed.
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
    // Without the loaded profile a partial POST would wipe the other
    // strategy fields, so only persist once it's available.
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

  const brandBlock = (
    <div
      onClick={isMobile && onMenuClick ? onMenuClick : undefined}
      style={{
        background: "#1A1A1A",
        padding: isMobile ? "10px 18px 10px 12px" : "11px 28px 11px 16px",
        clipPath:
          "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        cursor: isMobile && onMenuClick ? "pointer" : "default",
      }}
    >
      {isMobile && onMenuClick && (
        <span style={{ color: "#FEFCF9", display: "flex", alignItems: "center" }}>
          <Icon name="menu" size={16} ariaLabel="Open menu" />
        </span>
      )}
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
            fontSize: 13,
            letterSpacing: "0.04em",
          }}
        >
          FRONT OFFICE
        </span>
      )}
    </div>
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

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          background: "#F5F0E6",
          borderBottom: "3px solid #1A1A1A",
        }}
      >
        {brandBlock}

        {isMobile && mobileSearch ? (
          // Mobile: search bar takes the center
          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: "6px 6px 6px 0",
              display: "flex",
              alignItems: "center",
            }}
          >
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
          // Desktop: breadcrumb on left, team name + historian + avatar on right
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 4px 0 8px",
                flex: 1,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: "#1A1A1A",
                  fontFamily: FH,
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: "0.08em",
                }}
              >
                {breadcrumb}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "0 14px",
              }}
            >
              <span
                style={{
                  color: "#1A1A1A",
                  fontWeight: 700,
                  fontSize: 12,
                  fontFamily: "var(--font-body, 'DM Sans', sans-serif)",
                }}
              >
                {teamName}
              </span>
              <button
                type="button"
                onClick={() => {
                  window.location.href = historianHref;
                }}
                aria-label="Historian"
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
                <Icon name="search" size={17} />
              </button>
              {teamAvatar}
            </div>
          </>
        )}

        {isMobile && (
          <div style={{ display: "flex", alignItems: "center", padding: "0 10px" }}>
            {teamAvatar}
          </div>
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
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
      )}
    </>
  );
}