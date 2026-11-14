"use client";

import { browserStorageKey, readBrowserJson } from "@/infrastructure/identity/browserStorage";
import { useBrowserStorageScope } from "@/infrastructure/identity/BrowserStorageScopeProvider";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStoredTeam } from "@/infrastructure/identity/BrowserStorageScopeProvider";
import TradeBuilder from "@/pro-personnel/trade-builder/TradeBuilder";
import TradeDoor from "@/pro-personnel/trade-door/TradeDoor";
import type { DealAsset } from "@/pro-personnel/trade-builder/DealCard";

// /pro-personnel/trade-builder page wrapper.
//
// Routes between three modes based on the ?seed= query param:
//
//   (no seed)     → TradeDoor           — the director's chat: storylines →
//                                         goals → offer drawer (the "Build a
//                                         Trade" door per director_office.md)
//   ?seed=studio  → TradeBuilder seeded from sessionStorage[cfc_studio_seed_deal]
//                                       — Studio Edit handoff
//   ?seed=cycler  → TradeBuilder seeded from sessionStorage[cfc_builder_seed_deal]
//                                       — offer-drawer Edit handoff
//   ?seed=fresh   → TradeBuilder empty  — PHONES ARE OPEN flow from the door
//
// The sessionStorage seed key is read once on mount and then cleared so
// that a page refresh doesn't re-trigger the seeded editor (the user lands
// back on the cycler on refresh, which matches expected behavior).
//
// Implementation note: useSearchParams() must be wrapped in <Suspense>
// per Next.js 15+ static-generation requirements. The inner component
// reads the param; the default export provides the boundary.

type SeedAdvisor = {
  prose: string;
  grade: string;
  gradeColor: string;
};

type SeedDeal = {
  partner_team_id: string;
  partner_team_name: string;
  send: Array<{ key: string; name: string; type?: string }>;
  receive: Array<{ key: string; name: string; type?: string }>;
  // The director's take from the card the user tapped Edit on — carried into
  // the editor so the handoff reads as one continuous conversation.
  advisor?: SeedAdvisor;
};

type RouteMode =
  | { kind: "loading" }
  | { kind: "cycler" }
  | {
      kind: "editor";
      initialTeams: Array<{ id: string; name: string }>;
      initialDealAssets: DealAsset[];
      initialAdvisor?: SeedAdvisor;
    };

function LoadingScreen() {
  return (
    <div style={{ height: "calc(100vh - 44px)", background: "#F5F0E6", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 11, color: "#8C7E6A", letterSpacing: "0.1em" }}>
        LOADING…
      </div>
    </div>
  );
}

function TradeBuilderPageInner() {
  const { rosterId: myTeamId = "", teamName: myTeamName = "" } = useStoredTeam();
  const storageScope = useBrowserStorageScope();
  const searchParams = useSearchParams();
  const seed = searchParams?.get("seed") ?? null;
  const [mode, setMode] = useState<RouteMode>({ kind: "loading" });

  useEffect(() => {
    // No seed param → cycler
    if (!seed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Consume a browser session-storage handoff when the route seed changes.
      setMode({ kind: "cycler" });
      return;
    }

    // Fresh editor — no sessionStorage read needed
    if (seed === "fresh") {
      setMode({ kind: "editor", initialTeams: [], initialDealAssets: [] });
      return;
    }

    // Seeded editor — read sessionStorage key based on which surface seeded it
    const seedKey = browserStorageKey(seed === "studio" ? "studio-seed-deal" : "builder-seed-deal", storageScope);
    try {
      const saved = readBrowserJson("sessionStorage", seedKey);
      if (!saved || !seedKey) {
        setMode({ kind: "cycler" });
        return;
      }
      const data = saved as SeedDeal;

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
        initialAdvisor: data.advisor && data.advisor.prose ? data.advisor : undefined,
      });

      // Clear so refresh doesn't re-trigger the seeded editor
      sessionStorage.removeItem(seedKey);
    } catch {
      setMode({ kind: "cycler" });
    }
  }, [myTeamId, myTeamName, seed, storageScope]);

  const handleBack = () => {
    // Manual editor's back button returns to the cycler (clean URL)
    window.location.href = "/pro-personnel/trade-builder";
  };

  if (mode.kind === "loading") {
    return <LoadingScreen />;
  }

  if (mode.kind === "editor") {
    return (
      <TradeBuilder
        initialTeams={mode.initialTeams}
        initialDealAssets={mode.initialDealAssets}
        initialAdvisor={mode.initialAdvisor}
        onBack={handleBack}
      />
    );
  }

  return <TradeDoor />;
}

export default function TradeBuilderPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <TradeBuilderPageInner />
    </Suspense>
  );
}