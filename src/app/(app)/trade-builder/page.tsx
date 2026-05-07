"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import LandingPage from "../../../components/trade/LandingPage";
import TradeBuilder from "../../../components/trade/TradeBuilder";
import type { CartItem } from "../../../components/trade/CartSidebar";
import type { DealAsset } from "../../../components/trade/DealCard";
import { readStoredTeam } from "../../../lib/storedTeam";

type SeedAsset = { key: string; name: string };
type StudioSeed = {
  partner_team_id: string;
  partner_team_name: string;
  send: SeedAsset[];
  receive: SeedAsset[];
};

function TradeFlow() {
  const [mode, setMode] = useState<"landing" | "building">("landing");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [seedDealAssets, setSeedDealAssets] = useState<DealAsset[] | null>(null);

  // Studio Edit handoff. When ?seed=studio is present, hydrate from
  // sessionStorage and skip the landing page. Cleared after read so a
  // refresh doesn't re-trigger the same seed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("seed") !== "studio") return;

    try {
      const raw = sessionStorage.getItem("cfc_studio_seed_deal");
      if (!raw) return;
      sessionStorage.removeItem("cfc_studio_seed_deal");
      const seed = JSON.parse(raw) as StudioSeed;

      const { rosterId, teamName } = readStoredTeam();
      if (!rosterId) return;

      const myName = teamName || `Team ${rosterId}`;
      const partnerId = seed.partner_team_id;
      const partnerName = seed.partner_team_name;

      const dealAssets: DealAsset[] = [
        ...(seed.send ?? []).map((a) => ({
          key: a.key,
          name: a.name,
          fromTeamId: rosterId,
          toTeamId: partnerId,
          fromTeamName: myName,
          toTeamName: partnerName,
        })),
        ...(seed.receive ?? []).map((a) => ({
          key: a.key,
          name: a.name,
          fromTeamId: partnerId,
          toTeamId: rosterId,
          fromTeamName: partnerName,
          toTeamName: myName,
        })),
      ];

      if (dealAssets.length === 0) return;

      setSeedDealAssets(dealAssets);
      setTeams([{ id: partnerId, name: partnerName }]);
      setMode("building");

      // Strip ?seed=studio so a refresh lands on the normal flow
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      // Bad seed payload — fall through to landing
    }
  }, []);

  const handleCheckout = useCallback((cartItems: CartItem[], selectedTeams: { id: string; name: string }[]) => {
    setCart(cartItems);
    setTeams(selectedTeams);
    setSeedDealAssets(null);
    setMode("building");
  }, []);

  const handleBack = useCallback(() => {
    setMode("landing");
    setSeedDealAssets(null);
  }, []);

  if (mode === "building") {
    return (
      <TradeBuilder
        initialCart={cart}
        initialTeams={teams}
        initialDealAssets={seedDealAssets ?? undefined}
        onBack={handleBack}
      />
    );
  }

  return <LandingPage onCheckout={handleCheckout} />;
}

export default function TradeBuilderPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#F5F0E6" }} />}>
      <TradeFlow />
    </Suspense>
  );
}
