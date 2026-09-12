import { MockDraftView } from "@/scouting/mock-draft/MockDraftView";
import { getDraftStatus } from "@/shared/league-data";
import { redirect } from "next/navigation";

export default async function Page() {
  const status = await getDraftStatus();
  if (status.complete) redirect("/scouting/draft-room/results");
  return <MockDraftView />;
}
