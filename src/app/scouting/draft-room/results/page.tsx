"use client";

import { useEffect, useState } from "react";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";
import type { LeagueSnapshot } from "@/shared/league-data";

export default function DraftResultsPage() {
  const [snapshot, setSnapshot] = useState<LeagueSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/league/snapshot")
      .then(async response => {
        if (!response.ok) throw new Error("Draft results are unavailable.");
        return response.json();
      })
      .then(setSnapshot)
      .catch(reason => setError(reason instanceof Error ? reason.message : "Draft results are unavailable."));
  }, []);
  const names = new Map(snapshot?.teams.map(team => [team.rosterId, team.teamName]) ?? []);
  const players = new Map(snapshot?.players.map(player => [player.id, player.name] as const) ?? []);
  return <main style={{ minHeight: "100vh", background: "#F5F0E6", color: "#0b1f3a" }}>
    <UnifiedTopbar />
    <section style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px" }}>
      <p style={{ color: "#a5222a", fontWeight: 800, letterSpacing: 2 }}>CFC DRAFT ARCHIVE</p>
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: 42, margin: "4px 0 24px" }}>{snapshot?.draftStatus.season ?? "—"} Draft Results</h1>
      {error ? <p>{error}</p> : !snapshot ? <p>Loading the official board…</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12 }}>
          {snapshot.draftStatus.picks.map(pick => <article key={pick.pickNumber} style={{ background: "#fffaf0", border: "2px solid #0b1f3a", borderTop: "7px solid #c59b2a", padding: 14 }}>
            <strong>{pick.round}.{String(pick.slot).padStart(2, "0")}</strong>
            <div style={{ fontSize: 18, marginTop: 6 }}>{players.get(pick.playerId) ?? `Player ${pick.playerId}`}</div>
            <small>{names.get(pick.rosterId) ?? `Team ${pick.rosterId}`}</small>
          </article>)}
        </div>
      )}
    </section>
  </main>;
}
