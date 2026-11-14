import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { currentAppSessionFromRequest } from "@/infrastructure/auth/currentSession";
import { browserStorageScope } from "@/infrastructure/identity/browserStorage";
import { BrowserStorageScopeProvider } from "@/infrastructure/identity/BrowserStorageScopeProvider";
import { isCfcLeague } from "@/shared/league-data/capabilities";
import { getTeamIdentities } from "@/shared/league-data/teamIdentity";
import "./globals.css";

export const metadata: Metadata = {
  title: "CFC — Cleveland Football Club",
  description: "Cleveland Football Club fantasy football command center.",
};

// viewportFit: "cover" lets fixed bottom tab bars extend under the iOS home
// indicator (paired with env(safe-area-inset-bottom) padding where needed).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A live session scopes browser caches; revoked sessions cannot reopen private history.
  const { session } = await currentAppSessionFromRequest(new Request("https://app.local", { headers: await headers() }));
  const storageScope = browserStorageScope(session);
  const teams = session ? await getTeamIdentities(session.leagueId) : [];
  const identity = session ? {
    cfcFeatures: isCfcLeague(session.leagueId),
    userId: session.userId, leagueId: session.leagueId, rosterId: session.rosterId, role: session.role,
    teamName: teams.find(team => team.rosterId === session.rosterId)?.teamName ?? `Team ${session.rosterId}`,
  } : null;
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href={"https://fonts.googleapis.com/css2?family=Bowlby+One+SC&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700;800&family=Syne:wght@700;800&display=swap"}
        />
        {/* Tabler icon webfont — `ti ti-*` classes (persona icons on the offer
            cards, the phone on the trade door's reply button, etc.). These
            classes were referenced app-wide but the font was never loaded. */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css"
        />
      </head>
      <body className="antialiased bg-[var(--cfc-canvas)] text-[var(--cfc-ink)]">
        <BrowserStorageScopeProvider key={`${storageScope ?? "signed-out"}:${session?.rosterId ?? ""}:${session?.role ?? ""}`} identity={identity}>
          {children}
        </BrowserStorageScopeProvider>
      </body>
    </html>
  );
}
