"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Reusable bottom sheet for the mobile draft room. Slides up from below the
 * tab bar with a 300ms ease-out transition, covering ~65% of the screen so
 * the clock bar and top of the board stay visible behind the dark overlay.
 *
 * Mounted unconditionally (controlled by the `open` prop) so the same DOM
 * is animated in/out — preventing the slide animation from being swapped
 * when switching between tabs.
 */

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function MobileBottomSheet({ open, title, onClose, children }: Props) {
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
        data-sheet="true"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="cfc-mobile-sheet"
        data-open={open || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="cfc-mobile-sheet-handle" aria-hidden="true" />
        <header className="cfc-mobile-sheet-header">{title}</header>
        <div className="cfc-mobile-sheet-content">{children}</div>
      </div>
    </>
  );
}
