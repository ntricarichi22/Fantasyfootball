// POST   /api/team-identity/logo — upload a custom team logo (multipart
//        "file"). Stored in the public "team-logos" bucket keyed by roster id;
//        object presence is what marks a team as having a custom logo.
// DELETE /api/team-identity/logo — remove it, restoring the original crest.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { rosterIdFromCookies } from "@/infrastructure/identity/rosterCookie";
import {
  TEAM_LOGO_BUCKET,
  invalidateTeamIdentities,
  parseLogoObjectName,
} from "@/shared/league-data/teamIdentity";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Every object in the bucket that belongs to this roster (current + stale
// paths from earlier uploads, since the color suffix changes the name).
async function logoObjectsFor(
  client: NonNullable<ReturnType<typeof getSupabaseAdminClient>["client"]>,
  rosterId: string
): Promise<string[]> {
  const { data } = await client.storage.from(TEAM_LOGO_BUCKET).list("", { limit: 100 });
  return (data ?? [])
    .map((o) => o.name)
    .filter((name) => name && parseLogoObjectName(name)?.rosterId === rosterId) as string[];
}

export async function POST(request: NextRequest) {
  try {
    const rosterId = rosterIdFromCookies(request);
    if (!rosterId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image attached." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Logo must be a PNG, JPEG, or WebP image." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Logo must be under 2MB." }, { status: 400 });
    }

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

    // Lazily create the bucket on first upload; "already exists" is fine.
    const { error: bucketError } = await client.storage.createBucket(TEAM_LOGO_BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
    });
    if (bucketError && !/already exists/i.test(bucketError.message)) {
      throw new Error(bucketError.message);
    }

    // Dominant color extracted client-side from the image; encoded into the
    // object name so identity resolution gets it from the bucket listing.
    const rawColor = String(form?.get("color") ?? "").toLowerCase();
    const colorHex = /^#[0-9a-f]{6}$/.test(rawColor) ? rawColor.slice(1) : null;
    const objectName = colorHex ? `${rosterId}.${colorHex}` : rosterId;

    const bytes = Buffer.from(await file.arrayBuffer());
    const { error } = await client.storage
      .from(TEAM_LOGO_BUCKET)
      .upload(objectName, bytes, { contentType: file.type, upsert: true });
    if (error) throw new Error(error.message);

    // Remove earlier uploads under other names (different color suffix).
    const stale = (await logoObjectsFor(client, rosterId)).filter((n) => n !== objectName);
    if (stale.length) await client.storage.from(TEAM_LOGO_BUCKET).remove(stale);

    invalidateTeamIdentities();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "logo_upload_failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const rosterId = rosterIdFromCookies(request);
    if (!rosterId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

    const { client, error: clientError } = getSupabaseAdminClient();
    if (!client) return NextResponse.json({ error: clientError }, { status: 500 });

    const names = await logoObjectsFor(client, rosterId);
    if (names.length) {
      const { error } = await client.storage.from(TEAM_LOGO_BUCKET).remove(names);
      if (error && !/not found/i.test(error.message)) throw new Error(error.message);
    }

    invalidateTeamIdentities();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "logo_remove_failed" },
      { status: 500 }
    );
  }
}
