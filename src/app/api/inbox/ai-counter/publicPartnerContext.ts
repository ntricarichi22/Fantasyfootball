export type PublicPartnerContext = {
  window: "";
  verdict: "";
  wants: "";
  sells: "";
  trade_stance: "";
  core_label: "";
  tier_label: "";
  top_need: string | null;
};

/** Response projection intentionally accepts no saved opponent settings. */
export function publicPartnerContext(topNeed: string | null): PublicPartnerContext {
  return {
    window: "", verdict: "", wants: "", sells: "", trade_stance: "",
    core_label: "", tier_label: "", top_need: topNeed,
  };
}
