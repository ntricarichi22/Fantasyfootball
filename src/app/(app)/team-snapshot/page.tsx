import { Suspense } from "react";

import TeamHqView from "../../../components/TeamHqView";

export default function TeamSnapshotPage() {
  return (
    <Suspense fallback={<main className="min-h-[calc(100vh-44px)] bg-[var(--cfc-canvas)]" />}>
      <TeamHqView />
    </Suspense>
  );
}
