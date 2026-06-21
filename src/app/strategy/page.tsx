import { redirect } from "next/navigation";

// The Strategy director has no standalone office page — its office landing is
// "Set Strategy". The UnifiedTopbar "Office" tab points at /strategy, so send
// it on to the real landing.
export default function StrategyOfficePage() {
  redirect("/strategy/set-strategy");
}
