import { Suspense } from "react";

import TeamHqView from "../../../components/TeamHqView";

export default function TeamSnapshotPage() {
  return (
    <Suspense fallback={<main className="h-screen bg-black" />}>
      <TeamHqView />
    </Suspense>
  );
}
