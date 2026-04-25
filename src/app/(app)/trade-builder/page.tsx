"use client";

import { Suspense } from "react";
import TradeBuilderView from "../../../components/trade-builder/TradeBuilderView";

export default function TradeBuilderPage() {
  return (
    <Suspense>
      <TradeBuilderView />
    </Suspense>
  );
}
