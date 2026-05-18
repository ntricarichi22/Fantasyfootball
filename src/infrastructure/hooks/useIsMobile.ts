"use client";

import { useEffect, useState } from "react";

/**
 * Mobile breakpoint for the draft room layout. Per spec:
 *   - <= 768px → mobile layout
 *   - >  768px → existing desktop layout, unchanged
 */
export const MOBILE_BREAKPOINT_PX = 768;

/**
 * SSR-safe viewport-width hook. Returns `null` on the server and during the
 * first client render (before the viewport width is known), then resolves to
 * `true` or `false` after mount. Consumers should treat `null` as "not yet
 * determined" and show a loading state — never the wrong layout.
 */
export function useIsMobile(breakpointPx: number = MOBILE_BREAKPOINT_PX): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setIsMobile(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, [breakpointPx]);

  return isMobile;
}
