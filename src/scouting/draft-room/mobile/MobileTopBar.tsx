"use client";

/**
 * Mobile top bar — 40px tall, fixed at the top of the viewport.
 *
 * Layout (left → center → right):
 *   - Hamburger icon (20px wide, 14px tall, three horizontal bars in #FEFCF9)
 *   - "CFC" logo text (Syne 800, 12px, #F5C230, letter-spacing 2px)
 *   - Trade / dollar icon (18px, #FEFCF9 border, "$" in JetBrains Mono bold)
 *
 * The hamburger toggles the slide-out menu. The trade icon navigates to the
 * trade center route — same destination as the desktop top bar's "Trade
 * Center" link.
 */

type Props = {
  onOpenMenu: () => void;
  onTradePress: () => void;
};

export function MobileTopBar({ onOpenMenu, onTradePress }: Props) {
  return (
    <header className="cfc-mobile-topbar" role="banner">
      <button
        type="button"
        onClick={onOpenMenu}
        className="cfc-mobile-topbar-hamburger"
        aria-label="Open menu"
      >
        <span />
        <span />
        <span />
      </button>

      <span className="cfc-mobile-topbar-logo" aria-label="Cleveland Football Club">
        CFC
      </span>

      <button
        type="button"
        onClick={onTradePress}
        className="cfc-mobile-topbar-trade"
        aria-label="Open trade center"
      >
        $
      </button>
    </header>
  );
}
