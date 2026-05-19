"use client";

export type IconName =
  | "search"
  | "menu"
  | "x"
  | "plus"
  | "arrow-left"
  | "arrow-right"
  | "arrow-down"
  | "archive"
  | "trash"
  | "mail"
  | "mail-opened"
  | "dots-vertical"
  | "square"
  | "square-check"
  | "square-minus"
  | "chevron-right";

type IconProps = {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  ariaLabel?: string;
};

/**
 * Hand-rolled inline SVG icons. Stroke color inherits via currentColor.
 * Phase 1 convention: 24x24 viewBox, stroke-width 2 default.
 */
export function Icon({ name, size = 16, strokeWidth = 2, ariaLabel }: IconProps) {
  const base = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": ariaLabel ? undefined : true,
    "aria-label": ariaLabel,
    role: ariaLabel ? "img" : undefined,
  };

  switch (name) {
    case "search":
      return (
        <svg {...base}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-5-5" />
        </svg>
      );
    case "menu":
      return (
        <svg {...base}>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      );
    case "x":
      return (
        <svg {...base}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case "plus":
      return (
        <svg {...base}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...base}>
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...base}>
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg {...base}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
      );
    case "archive":
      return (
        <svg {...base}>
          <rect x="3" y="4" width="18" height="4" />
          <path d="M5 8v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
          <line x1="10" y1="13" x2="14" y2="13" />
        </svg>
      );
    case "trash":
      return (
        <svg {...base}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case "mail":
      return (
        <svg {...base}>
          <rect x="2" y="4" width="20" height="16" />
          <polyline points="2 7 12 13 22 7" />
        </svg>
      );
    case "mail-opened":
      return (
        <svg {...base}>
          <path d="M2 9l10-5 10 5v11H2V9z" />
          <polyline points="2 9 12 14 22 9" />
        </svg>
      );
    case "dots-vertical":
      return (
        <svg {...base}>
          <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "square":
      return (
        <svg {...base}>
          <rect x="4" y="4" width="16" height="16" />
        </svg>
      );
    case "square-check":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={!ariaLabel} aria-label={ariaLabel}>
          <rect x="3" y="3" width="18" height="18" fill="currentColor" />
          <polyline
            points="7 12 10.5 15.5 17 9"
            fill="none"
            stroke="#FEFCF9"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "square-minus":
      return (
        <svg {...base}>
          <rect x="4" y="4" width="16" height="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...base}>
          <polyline points="9 6 15 12 9 18" />
        </svg>
      );
    default:
      return null;
  }
}