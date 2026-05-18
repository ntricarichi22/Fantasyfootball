"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Slide-out hamburger nav for the mobile draft room. Covers ~80% of the
 * viewport from the left, with a dark overlay across the rest of the screen.
 * Tap the overlay or the close button to dismiss.
 *
 * Animation is driven by the `data-open` attribute so the same DOM is
 * present regardless of state — letting CSS transitions run smoothly. The
 * mute toggle is rendered inline as a switch (per the pick-announcement
 * integration spec).
 */

type NavItem = {
  href: string;
  label: string;
  active?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  navItems: NavItem[];
  onNavigate: (href: string) => void;
  muted: boolean;
  onToggleMute: () => void;
};

export function MobileHamburgerMenu({
  open,
  onClose,
  navItems,
  onNavigate,
  muted,
  onToggleMute,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className="cfc-mobile-overlay"
        data-open={open || undefined}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="cfc-mobile-hamburger"
        data-open={open || undefined}
        role="dialog"
        aria-label="Main navigation"
        aria-modal="true"
      >
        <div className="cfc-mobile-hamburger-header">
          <span className="cfc-mobile-hamburger-logo">CFC</span>
          <button
            type="button"
            className="cfc-mobile-hamburger-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <nav className="cfc-mobile-hamburger-nav">
          {navItems.map((item) => (
            <button
              key={item.href}
              type="button"
              className="cfc-mobile-hamburger-link"
              data-active={item.active || undefined}
              onClick={() => {
                onNavigate(item.href);
                onClose();
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="cfc-mobile-hamburger-footer">
          <span className="cfc-mobile-hamburger-mute-label">Draft Chime</span>
          <MuteToggle muted={muted} onToggle={onToggleMute} />
        </div>
      </aside>
    </>
  );
}

function MuteToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!muted}
      aria-label={muted ? "Unmute draft chime" : "Mute draft chime"}
      onClick={onToggle}
      className="cfc-mobile-mute-toggle"
      data-on={!muted || undefined}
    >
      <span className="cfc-mobile-mute-toggle-knob" />
    </button>
  );
}
