import assert from "node:assert/strict";
import chromiumBinary from "@sparticuz/chromium";
import { chromium } from "playwright-core";

/** Real disposable UI -> auth -> verified requester -> API -> database journey. */
export async function runAuthBrowserSmoke({ base, pool, league, otherLeague, member, counterpart, password }) {
  if (process.platform !== "linux") {
    console.log("Browser journey requires the bundled Linux Chromium; unavailable on this local platform.");
    return;
  }
  const browser = await chromium.launch({ executablePath: await chromiumBinary.executablePath(), args: chromiumBinary.args,
    headless: true, timeout: 20_000 });
  let timer;
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(20_000);
    // Fonts/icons are presentation-only. No auth, app API, provider, or data response is mocked.
    for (const pattern of ["**://fonts.googleapis.com/**", "**://fonts.gstatic.com/**", "**://cdn.jsdelivr.net/npm/@tabler/**"]) {
      await context.route(pattern, route => route.abort());
    }
    const postResponse = (page, path) => page.waitForResponse(response =>
      new URL(response.url()).origin === new URL(base).origin && new URL(response.url()).pathname === path && response.request().method() === "POST");
    const assertIdentity = async (response, userId, leagueId, rosterId) => {
      const headers = await response.request().allHeaders();
      assert.equal(headers["x-cfc-user-id"], userId, "component sends its verified account assertion");
      assert.equal(headers["x-cfc-league-id"], leagueId, "component sends its verified league assertion");
      assert.equal(headers["x-cfc-roster-id"], rosterId, "component sends its verified roster assertion");
    };
    const choose = async (page, leagueId, rosterId) => {
      const navigation = page.waitForEvent("domcontentloaded");
      const response = postResponse(page, "/api/auth/finalize");
      await page.getByRole("button", { name: `League ${leagueId} · Team ${rosterId}`, exact: true }).click();
      assert.equal((await response).status(), 200, "real UI membership selection succeeds");
      await navigation;
      await page.getByRole("button", { name: "Team settings", exact: true }).waitFor();
    };
    const login = async (page, email, leagueId, rosterId) => {
      await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
      await page.locator('input[type="email"]').fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.locator('input[type="password"]').fill(password);
      const result = postResponse(page, "/api/auth/login");
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
      assert.equal((await result).status(), 200, "browser signs in through the actual password endpoint");
      await choose(page, leagueId, rosterId);
    };
    const openRename = async (page, name) => {
      await page.getByRole("button", { name: "Team settings", exact: true }).click();
      await page.getByRole("button", { name: "Change Team Name", exact: true }).click();
      await page.locator('input[maxlength="30"]').fill(name);
    };
    const save = async (page, identity, accepted) => {
      const navigation = accepted ? page.waitForEvent("domcontentloaded") : null;
      const response = postResponse(page, "/api/team-identity");
      await page.getByRole("button", { name: "Save Name", exact: true }).click();
      const result = await response;
      await assertIdentity(result, ...identity);
      if (accepted) {
        assert.equal(result.status(), 200, "real component rename succeeds");
        await navigation;
        await page.getByRole("button", { name: "Team settings", exact: true }).waitFor();
      } else {
        assert.ok([401, 403, 409].includes(result.status()), "stale UI mutation is rejected despite the shared cookie change");
      }
    };
    const journey = async () => {
      const first = await context.newPage();
      await login(first, member.email, league, "1");
      await openRename(first, "Browser CFC Team");
      await save(first, [member.id, league, "1"], true);
      await openRename(first, "Stale League Rename");

      const second = await context.newPage();
      await second.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      await second.getByRole("button", { name: "Team settings", exact: true }).click();
      await second.getByRole("button", { name: "Switch league", exact: true }).click();
      await choose(second, otherLeague, "1");
      await openRename(second, "Browser Other Team");
      await save(second, [member.id, otherLeague, "1"], true);
      await save(first, [member.id, league, "1"], false);

      // The harder case: another account signs in to the SAME league.
      await openRename(second, "Stale Account Rename");
      await login(first, counterpart.email, otherLeague, "2");
      await save(second, [member.id, otherLeague, "1"], false);
      const rows = await pool.query("SELECT league_id,roster_id,team_name FROM public.team_email_map WHERE (league_id=$1 AND roster_id='1') OR (league_id=$2 AND roster_id IN ('1','2'))", [league, otherLeague]);
      assert.deepEqual(Object.fromEntries(rows.rows.map(row => [`${row.league_id}:${row.roster_id}`, row.team_name])), {
        [`${league}:1`]: "Browser CFC Team", [`${otherLeague}:1`]: "Browser Other Team", [`${otherLeague}:2`]: "Other Counterpart",
      }, "actual browser writes affect only the selected account/league; stale tabs affect neither team");
      console.log("Browser login/chooser/rename/switch and stale league/account journeys passed.");
    };
    await Promise.race([journey(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Disposable browser journey exceeded 90 seconds")), 90_000);
    })]);
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
