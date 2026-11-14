import { headers } from "next/headers";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { MockDraftView } from "@/scouting/mock-draft/MockDraftView";
import { getDraftStatus } from "@/shared/league-data";
import { redirect } from "next/navigation";

export default async function Page() {
  const { session } = await currentAppSessionFromRequest(new Request("https://app.local", { headers: await headers() }));
  if (!session) redirect("/login");
  const status = await getDraftStatus(session.leagueId);
  if (status.complete) redirect("/scouting/draft-room/results");
  return <MockDraftView />;
}
