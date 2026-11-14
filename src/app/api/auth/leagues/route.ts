import { NextResponse } from "next/server";
import { availableLeagueChoices, verifiedProviderSession } from "@/infrastructure/auth/providerSession";

export async function GET(request: Request) {
  const provider = await verifiedProviderSession(request);
  if (provider.error) return NextResponse.json({ error: provider.error }, { status: provider.status });
  const leagues = await availableLeagueChoices(provider);
  if (!leagues) return NextResponse.json({ error: "auth_state_unavailable" }, { status: 503 });
  return NextResponse.json({ leagues }, { headers: { "Cache-Control": "no-store" } });
}
