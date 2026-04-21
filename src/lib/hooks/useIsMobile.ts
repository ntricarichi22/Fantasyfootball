"use client";

import { useEffect, useState } from "react";

/**
 * Mobile breakpoint for the draft room layout. Per spec:
 *   - <= 768px → mobile layout
 *   - >  768px → existing desktop layout, unchanged
 */
export const MOBILE_BREAKPOINT_PX = 768;

/**
 * SSR-safe viewport-width hook. Returns `false` on the server and during the
 * first client render so the SSR markup matches the client hydration pass
 * (avoiding hydration mismatches), then flips to the real value after mount.
 *
 * Only one breakpoint is supported per spec — keep this simple.
 */
export function useIsMobile(breakpointPx: number = MOBILE_BREAKPOINT_PX): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setIsMobile(query.matches);
    update();
    // Modern browsers expose `addEventListener` on MediaQueryList; older
    // Safari only has `addListener`. Use whichever is available.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, [breakpointPx]);

  return isMobile;
}
