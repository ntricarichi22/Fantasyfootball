"use client";

import { Suspense } from "react";
import InboxPage from "@/components/gm-office/InboxPage";

export default function TradesPage() {
  return (
    <Suspense>
      <InboxPage />
    </Suspense>
  );
}
