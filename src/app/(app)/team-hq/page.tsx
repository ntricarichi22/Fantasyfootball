import { Suspense } from "react";

import OwnersBoxView from "../../../components/owners-box/OwnersBoxView";

export default function TeamHqPage() {
  return (
    <Suspense fallback={<main className="min-h-[calc(100vh-44px)] bg-[var(--cfc-canvas)]" />}>
      <OwnersBoxView />
    </Suspense>
  );
}
