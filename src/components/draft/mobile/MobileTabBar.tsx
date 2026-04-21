"use client";

/**
 * Bottom tab bar for the mobile draft room. Three equal-width tabs:
 *   1. Roster
 *   2. Asst. GM (NOTE: keep the period after "Asst")
 *   3. Trade
 *
 * Tapping any tab opens its corresponding bottom sheet. Tapping the
 * currently-active tab again closes the sheet. The bar itself remains
 * visible above the sheet so users can switch tabs without dismissing first.
 */

export type MobileTab = "roster" | "assistant" | "trade";

type Props = {
  activeTab: MobileTab | null;
  onSelectTab: (tab: MobileTab) => void;
};

export function MobileTabBar({ activeTab, onSelectTab }: Props) {
  return (
    <nav className="cfc-mobile-tabbar" role="tablist" aria-label="Draft room tabs">
      <TabButton
        tab="roster"
        label="Roster"
        active={activeTab === "roster"}
        onClick={onSelectTab}
        icon={<RosterIcon />}
      />
      <TabButton
        tab="assistant"
        label="Asst. GM"
        active={activeTab === "assistant"}
        onClick={onSelectTab}
        icon={<AssistantIcon />}
      />
      <TabButton
        tab="trade"
        label="Trade"
        active={activeTab === "trade"}
        onClick={onSelectTab}
        icon={<TradeIcon />}
        last
      />
    </nav>
  );
}

function TabButton({
  tab,
  label,
  active,
  onClick,
  icon,
  last,
}: {
  tab: MobileTab;
  label: string;
  active: boolean;
  onClick: (tab: MobileTab) => void;
  icon: React.ReactNode;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onClick(tab)}
      className="cfc-mobile-tabbar-btn"
      data-active={active || undefined}
      data-last={last || undefined}
    >
      <span className="cfc-mobile-tabbar-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="cfc-mobile-tabbar-label">{label}</span>
    </button>
  );
}

function RosterIcon() {
  // 14x14 square with three horizontal lines inside.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" stroke="#1A1A1A" strokeWidth="2" fill="none" />
      <line x1="3" y1="5" x2="11" y2="5" stroke="#1A1A1A" strokeWidth="1.5" />
      <line x1="3" y1="7.5" x2="11" y2="7.5" stroke="#1A1A1A" strokeWidth="1.5" />
      <line x1="3" y1="10" x2="11" y2="10" stroke="#1A1A1A" strokeWidth="1.5" />
    </svg>
  );
}

function AssistantIcon() {
  // 14x14 solid black circle with a 2px border.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6" stroke="#1A1A1A" strokeWidth="2" fill="#1A1A1A" />
    </svg>
  );
}

function TradeIcon() {
  // Two horizontal arrow lines (top and bottom), 2px each.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <line x1="1" y1="4" x2="13" y2="4" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="square" />
      <polyline
        points="10,1.5 13,4 10,6.5"
        stroke="#1A1A1A"
        strokeWidth="2"
        fill="none"
        strokeLinecap="square"
      />
      <line x1="1" y1="10" x2="13" y2="10" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="square" />
      <polyline
        points="4,7.5 1,10 4,12.5"
        stroke="#1A1A1A"
        strokeWidth="2"
        fill="none"
        strokeLinecap="square"
      />
    </svg>
  );
}
