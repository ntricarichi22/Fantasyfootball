"use client";

import { useBrowserStorageScope } from "@/infrastructure/identity/BrowserStorageScopeProvider";
import DraftRoom from "@/scouting/draft-room/DraftRoom";
import DraftCompleteModal from "@/scouting/draft-room/chrome/DraftCompleteModal";
import { DraftStatusProvider } from "@/scouting/draft-room/chrome/DraftStatusProvider";
import ClockBar from "@/scouting/draft-room/chrome/ClockBar";
import { UnifiedTopbar } from "@/shared/ui/UnifiedTopbar";

export default function DraftPage() {
  const scope = useBrowserStorageScope();
  if (!scope) return null;
  return (
    <DraftStatusProvider>
      <div className="cfc-shell-chrome">
        <UnifiedTopbar />
        <ClockBar />
      </div>
      <DraftRoom />
      <DraftCompleteModal />
    </DraftStatusProvider>
  );
}
