// /dev/login — DEV-ONLY team switcher.
//
// Server component guard: 404s in production so the page never ships. The
// actual picker UI lives in DevLoginClient (client component).

import { notFound } from "next/navigation";
import DevLoginClient from "./DevLoginClient";

export const dynamic = "force-dynamic";

export default function DevLoginPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevLoginClient />;
}
