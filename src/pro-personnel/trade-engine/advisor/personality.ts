// Layer 1: Static team identities. Hand-curated per team based on Nick's
// observations of the league. Layer 2 (learned personality from trade
// history + chat) is parked for a future build.
//
// Keys are full team_name as it appears in team_email_map.team_name.
// Any team not in this map falls through to DEFAULT_PERSONALITY.

export type DealerType = "active" | "sticky" | "difficult";

export type TeamPersonality = {
  identity: string;          // 1-2 sentence read on the owner's behavior
  negotiation_style: string; // How they negotiate when engaged
  dealer_type: DealerType;   // active = open to dealing, sticky = sits on guys, difficult = unique problems
};

export const DEFAULT_PERSONALITY: TeamPersonality = {
  identity: "Standard operator. No strong tendencies one way or the other.",
  negotiation_style: "Negotiates normally — expects fair value, will counter if off.",
  dealer_type: "active",
};

export const TEAM_PERSONALITIES: Record<string, TeamPersonality> = {
  "Doylestown Destroyers": {
    identity: "Sits on his roster. Rarely initiates and rarely accepts. When he does engage, he wants to feel like he clearly won the deal.",
    negotiation_style: "Your offer needs to look generous on the surface, not just be fair on paper. If the deal is borderline, he'll pass.",
    dealer_type: "sticky",
  },
  "Brokepark Browns": {
    identity: "Notorious for not responding. Often goes dark on offers entirely. Getting him to engage at all is the win.",
    negotiation_style: "Don't expect counters or replies. Send your best realistic offer the first time — there usually isn't a second chance.",
    dealer_type: "sticky",
  },
  "Buffalo Wingmen": {
    identity: "Has his own valuation system that doesn't track the trade chart. Some guys he overvalues massively, others he'll move cheap.",
    negotiation_style: "Read what he says he wants more than what the math says. Lean into his stated targets — value alignment matters less than fit.",
    dealer_type: "difficult",
  },
  "Brunswick Buschmasters": {
    identity: "Nickel-and-dimer. Will counter even on fair deals trying to extract one more piece.",
    negotiation_style: "Expect him to push for a sweetener regardless of how the deal grades. Build in a small cushion or be ready for a counter.",
    dealer_type: "difficult",
  },
  "Virginia Founders": {
    identity: "Active dealer. Open to most conversations and willing to make moves when the value is there.",
    negotiation_style: "Standard negotiation — fair value gets it done. Will counter if the deal misses, accept if it lands.",
    dealer_type: "active",
  },
  "Kentucky Kush": {
    identity: "Active dealer. Willing to engage on most fronts and not afraid to make big moves.",
    negotiation_style: "Standard negotiation — straightforward. If the value works he'll consider it seriously.",
    dealer_type: "active",
  },
  "Windy City Crossfitters": {
    identity: "Active dealer. Frequently in the market and open to creative deals.",
    negotiation_style: "Standard negotiation. Receptive to multi-piece offers and three-team scenarios.",
    dealer_type: "active",
  },
  "Fairmount Freaks": {
    identity: "Active dealer. Stays in motion — always shopping something.",
    negotiation_style: "Standard negotiation. Will engage quickly if the offer matches his current direction.",
    dealer_type: "active",
  },
  "Boston Birdmen": {
    identity: "Active dealer. Open to conversations and willing to move pieces when it makes sense.",
    negotiation_style: "Standard negotiation — fair value gets it done.",
    dealer_type: "active",
  },
  "Mayfield Matzo Balls": {
    identity: "Active dealer. Open to most conversations.",
    negotiation_style: "Standard negotiation — straightforward when the value aligns.",
    dealer_type: "active",
  },
  "Oregon Onslaught": {
    identity: "Active dealer. Willing to engage and not precious about most pieces.",
    negotiation_style: "Standard negotiation. Receptive when the deal makes sense for his roster direction.",
    dealer_type: "active",
  },
};

export function getPersonality(teamName: string | null | undefined): TeamPersonality {
  if (!teamName) return DEFAULT_PERSONALITY;
  return TEAM_PERSONALITIES[teamName] ?? DEFAULT_PERSONALITY;
}
