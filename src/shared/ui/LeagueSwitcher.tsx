"use client";

import { useState } from "react";
import { finalizeLeagueSession, listLeagueChoices, type LeagueChoice } from "@/infrastructure/identity/leagueSelection";

export function LeagueChoiceList({ leagues, onChoose, busy }: { leagues: LeagueChoice[]; onChoose: (leagueId: string) => void; busy: boolean }) {
  return <div aria-label="Your leagues" style={{ display: "grid", gap: 8 }}>
    {leagues.map(league => <button key={league.leagueId} type="button" disabled={busy} onClick={() => onChoose(league.leagueId)}
      style={{ padding: 10, textAlign: "left", border: "1px solid #aaa", borderRadius: 6, background: "#FEFCF9", color: "#1A1A1A" }}>
      League {league.leagueId} · Team {league.rosterId}
    </button>)}
  </div>;
}

export function LeagueSwitcher() {
  const [leagues, setLeagues] = useState<LeagueChoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    setBusy(true); setError("");
    try { setLeagues(await listLeagueChoices()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load leagues."); }
    finally { setBusy(false); }
  }
  async function choose(leagueId: string) {
    setBusy(true); setError("");
    try {
      const result = await finalizeLeagueSession(leagueId);
      if (result.redirect) window.location.assign(result.redirect);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to switch leagues."); setBusy(false); }
  }
  return <div>
    <button type="button" onClick={open} disabled={busy}>Switch league</button>
    {leagues && <LeagueChoiceList leagues={leagues} onChoose={choose} busy={busy} />}
    {error && <p role="alert">{error}</p>}
  </div>;
}
