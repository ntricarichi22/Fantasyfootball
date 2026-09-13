import { NextResponse } from "next/server";
export async function POST() {
  // Browser assertions are not trustworthy audit evidence. Kept as an inert
  // compatibility endpoint while clients roll forward.
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
