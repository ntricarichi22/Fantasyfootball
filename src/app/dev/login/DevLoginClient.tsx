"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const F = "var(--font-body, 'DM Sans', sans-serif)";
const FH = "var(--font-headline, 'Syne', sans-serif)";
const FM = "var(--font-mono, 'JetBrains Mono', monospace)";

const CREAM = "#F5F0E6";
const PAPER = "#FEFCF9";
const INK = "#1A1A1A";
const BLUE = "#185FA5";
const MUTE = "#8C7E6A";

type Team = {
  rosterId: string;
  teamName: string;
  email: string | null;
  profileComplete: boolean;
};

type Current = { rosterId?: string; teamName?: string };

function readCurrentIdentity(): Current {
  try {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith("cfc_identity="));
    if (!match) return {};
    const parsed = JSON.parse(decodeURIComponent(match.split("=")[1]));
    return { rosterId: String(parsed.rosterId), teamName: parsed.teamName };
  } catch {
    return {};
  }
}

export default function DevLoginClient() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [current, setCurrent] = useState<Current>({});
  const [busy, setBusy] = useState<string | null>(null); // rosterId being acted on, or "logout"
  const [msg, setMsg] = useState("");
  const [loadError, setLoadError] = useState("");

  const refreshCurrent = useCallback(() => setCurrent(readCurrentIdentity()), []);

  useEffect(() => {
    refreshCurrent();
    fetch("/api/dev/login")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.teams)) setTeams(j.teams);
        else setLoadError(j.error || "Failed to load teams");
      })
      .catch((e) => setLoadError(String(e)));
  }, [refreshCurrent]);

  const login = useCallback(
    async (rosterId: string) => {
      setBusy(rosterId);
      setMsg("");
      try {
        const r = await fetch("/api/dev/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rosterId }),
        });
        const j = await r.json();
        if (r.ok) {
          setMsg(`Logged in as ${j.team.teamName} (roster ${j.team.rosterId})`);
          refreshCurrent();
        } else {
          setMsg(j.error || "Login failed");
        }
      } catch (e) {
        setMsg(String(e));
      } finally {
        setBusy(null);
      }
    },
    [refreshCurrent],
  );

  const logout = useCallback(async () => {
    setBusy("logout");
    setMsg("");
    try {
      await fetch("/api/dev/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      setMsg("Logged out.");
      refreshCurrent();
    } finally {
      setBusy(null);
    }
  }, [refreshCurrent]);

  return (
    <div style={{ minHeight: "100vh", background: CREAM, fontFamily: F, color: INK, padding: "32px 20px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 24, letterSpacing: "0.02em" }}>DEV LOGIN</div>
          <div style={{ fontFamily: FM, fontSize: 10, color: PAPER, background: "#C0392B", padding: "2px 7px", letterSpacing: "0.08em", fontWeight: 700 }}>
            DEV ONLY
          </div>
        </div>
        <div style={{ fontFamily: FM, fontSize: 11, color: MUTE, marginBottom: 20, lineHeight: 1.5 }}>
          Impersonate any league team locally. Sets the same identity cookies as the real Supabase login.
          This page 404s in production.
        </div>

        {/* Current identity */}
        <div
          style={{
            border: `2.5px solid ${INK}`,
            boxShadow: `4px 4px 0 ${INK}`,
            background: PAPER,
            padding: "16px 18px",
            marginBottom: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontFamily: FM, fontSize: 10, color: MUTE, letterSpacing: "0.1em", marginBottom: 4 }}>
              SIGNED IN AS
            </div>
            <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 18 }}>
              {current.teamName ? `${current.teamName}` : "— not signed in —"}
            </div>
            {current.rosterId && (
              <div style={{ fontFamily: FM, fontSize: 10, color: MUTE, marginTop: 2 }}>roster {current.rosterId}</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {current.rosterId && (
              <button
                onClick={logout}
                disabled={busy === "logout"}
                style={btnStyle(false, busy === "logout")}
              >
                {busy === "logout" ? "…" : "LOG OUT"}
              </button>
            )}
            <Link href="/" style={{ ...btnStyle(true, false), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              GO TO APP →
            </Link>
          </div>
        </div>

        {/* Toast */}
        {msg && (
          <div style={{ fontFamily: FM, fontSize: 11, color: BLUE, marginBottom: 16, fontWeight: 700 }}>{msg}</div>
        )}
        {loadError && (
          <div style={{ fontFamily: FM, fontSize: 11, color: "#C0392B", marginBottom: 16 }}>
            Couldn&apos;t load teams: {loadError}
          </div>
        )}

        {/* Team grid */}
        <div style={{ fontFamily: FM, fontSize: 10, color: MUTE, letterSpacing: "0.1em", marginBottom: 10 }}>
          PICK A TEAM
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {teams.map((t) => {
            const active = current.rosterId === t.rosterId;
            return (
              <button
                key={t.rosterId}
                onClick={() => login(t.rosterId)}
                disabled={busy === t.rosterId}
                style={{
                  textAlign: "left",
                  border: `2.5px solid ${INK}`,
                  boxShadow: active ? `2px 2px 0 ${INK}` : `4px 4px 0 ${INK}`,
                  transform: active ? "translate(2px, 2px)" : "none",
                  background: active ? BLUE : PAPER,
                  color: active ? PAPER : INK,
                  padding: "12px 14px",
                  cursor: busy === t.rosterId ? "wait" : "pointer",
                  fontFamily: F,
                }}
              >
                <div style={{ fontFamily: FM, fontSize: 9, letterSpacing: "0.1em", color: active ? "#CFE0F0" : MUTE, marginBottom: 4 }}>
                  ROSTER {t.rosterId}
                  {active ? " · ACTIVE" : ""}
                </div>
                <div style={{ fontFamily: FH, fontWeight: 800, fontSize: 15, lineHeight: 1.15 }}>{t.teamName}</div>
                {busy === t.rosterId && (
                  <div style={{ fontFamily: FM, fontSize: 9, marginTop: 4 }}>signing in…</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function btnStyle(primary: boolean, disabled: boolean): React.CSSProperties {
  return {
    background: primary ? BLUE : PAPER,
    color: primary ? PAPER : INK,
    border: `2px solid ${INK}`,
    boxShadow: `3px 3px 0 ${INK}`,
    padding: "8px 14px",
    fontFamily: FM,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
