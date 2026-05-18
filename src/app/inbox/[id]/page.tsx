"use client";

import { Suspense } from "react";
import ThreadPage from "@/inbox/thread/ThreadPage";

export default function TradeThreadRoute() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", background: "#F5F0E6" }} />
      }
    >
      <ThreadPage />
    </Suspense>
  );
}
