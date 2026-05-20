"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readStoredTeam } from "@/infrastructure/identity/storedTeam";
import TradeBuilder from "@/pro-personnel/trade-builder/TradeBuilder";
import BuilderCyclerView from "@/pro-personnel/trade-builder/BuilderCyclerView";
import type { DealAsset } from "@/pro-personnel/trade-builder/DealCard";

// /pro-personnel/trade-builder page wrapper.
//
// Routes between three modes based on the ?seed= query param:
//
//   (no seed)     → BuilderCyclerView   — cycle through computed targets
//   ?seed=studio  → TradeBuilder seeded from sessionStorage[cfc_studio_seed_deal]
//                                       — Studio Edit handoff
//   ?seed=cycler  → TradeBuilder seeded from sessionStorage[cfc_builder_seed_deal]
//                                       — Builder cycler Edit handoff
//   ?seed=fresh   → TradeBuilder empty  — PHONES ARE OPEN flow from cycler
//
// The sessionStorage seed key is read once on mount and then cleared so
// that a page refresh doesn't re-trigger the seeded editor (the user lands
// back on the cycler on refresh, which matches expected behavior).

type SeedDeal = {
  partner_team_id: string;
  partner_team_name: string;
  send: Array<{ key: string; name: string; type?: string }>;
  receive: Array<{ key: string; name: string; type?: string }>;
};

type RouteMode =
  | { kind: "loading" }
  | { kind: "cycler" }
  | { kind: "editor"; initialTeams: Array<{ id: string; name: string }>; initialDealAssets: DealAsset[] };

export default function TradeBuilderPage() {
  const searchParams = useSearchParams();
  const seed = searchParams?.get("seed") ?? null;
  const [mode, setMode] = useState<RouteMode>({ kind: "loading" });

  useEffect(() => {
    // No seed param → cycler
    if (!seed) {
      setMode({ kind: "cycler" });
      return;
    }

    // Fresh editor — no sessionStorage read needed
    if (seed === "fresh") {
      setMode({ kind: "editor", initialTeams: [], initialDealAssets: [] });
      return;
    }

    // Seeded editor — read sessionStorage key based on which surface seeded it
    const seedKey = seed === "studio" ? "cfc_studio_seed_deal" : "cfc_builder_seed_deal";
    try {
      const raw = sessionStorage.getItem(seedKey);
      if (!raw) {
        setMode({ kind: "cycler" });
        return;
      }
      const data = JSON.parse(raw) as SeedDeal;
      const stored = readStoredTeam();
      const myTeamId = stored.rosterId ?? "";
      const myTeamName = stored.teamName ?? "";

      const dealAssets: DealAsset[] = [
        ...(data.send ?? []).map(a => ({
          key: a.key,
          name: a.name,
          fromTeamId: myTeamId,
          toTeamId: data.partner_team_id,
          fromTeamName: myTeamName,
          toTeamName: data.partner_team_name,
        })),
        ...(data.receive ?? []).map(a => ({
          key: a.key,
          name: a.name,
          fromTeamId: data.partner_team_id,
          toTeamId: myTeamId,
          fromTeamName: data.partner_team_name,
          toTeamName: myTeamName,
        })),
      ];

      setMode({
        kind: "editor",
        initialTeams: [{ id: data.partner_team_id, name: data.partner_team_name }],
        initialDealAssets: dealAssets,
      });

      // Clear so refresh doesn't re-trigger the seeded editor
      sessionStorage.removeItem(seedKey);
    } catch {
      setMode({ kind: "cycler" });
    }
  }, [seed]);

  const handleBack = () => {
    // Manual editor's back button returns to the cycler (clean URL)
    window.location.href = "/pro-personnel/trade-builder";
  };

  if (mode.kind === "loading") {
    return (
      <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 11, color: "#8C7E6A", letterSpacing: "0.1em" }}>
          LOADING…
        </div>
      </div>
    );
  }

  if (mode.kind === "editor") {
    return (
      <TradeBuilder
        initialCart={[]}
        initialTeams={mode.initialTeams}
        initialDealAssets={mode.initialDealAssets}
        onBack={handleBack}
      />
    );
  }

  return <BuilderCyclerView />;
}