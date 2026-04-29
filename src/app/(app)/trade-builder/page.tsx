"use client";

import { Suspense, useCallback, useState } from "react";
import LandingPage from "../../../components/trade/LandingPage";
import TradeBuilder from "../../../components/trade/TradeBuilder";
import type { CartItem } from "../../../components/trade/CartSidebar";

function TradeFlow() {
  const [mode, setMode] = useState<"landing" | "building">("landing");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);

  const handleCheckout = useCallback((cartItems: CartItem[], selectedTeams: { id: string; name: string }[]) => {
    setCart(cartItems);
    setTeams(selectedTeams);
    setMode("building");
  }, []);

  const handleBack = useCallback(() => {
    setMode("landing");
  }, []);

  if (mode === "building") {
    return <TradeBuilder initialCart={cart} initialTeams={teams} onBack={handleBack} />;
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
