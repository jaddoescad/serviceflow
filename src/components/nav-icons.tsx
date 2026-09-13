import type { ReactNode } from "react";

type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-[19px] w-[19px] shrink-0"}
    >
      {children}
    </svg>
  );
}

export function SearchNavIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </Icon>
  );
}

const DASHBOARD_ICON = (
  <Icon>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </Icon>
);

export const NAV_ICONS: Record<string, ReactNode> = {
  "/": DASHBOARD_ICON,
  "/leads": (
    <Icon>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" />
    </Icon>
  ),
  "/contacts": (
    <Icon>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19v-1.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V19" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5M18 13.5a4 4 0 0 1 2.5 3.7V19" />
    </Icon>
  ),
  "/jobs": (
    <Icon>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5M8.5 9h7M8.5 13h7M8.5 17H13" />
    </Icon>
  ),
  "/photos": (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4.5 17 4.2-4.2a1.5 1.5 0 0 1 2.1 0l1.5 1.5 1.4-1.4a1.5 1.5 0 0 1 2.1 0l3.7 3.7" />
    </Icon>
  ),
  "/financials": (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M16 8.5c-.8-.7-2-1.1-3.4-1.1-1.8 0-3.1.8-3.1 2s1 1.8 3.1 2.3 3.4 1 3.4 2.4-1.4 2.4-3.5 2.4c-1.6 0-3-.5-4-1.4M12.5 5.5v13" />
    </Icon>
  ),
  "/invoices": (
    <Icon>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </Icon>
  ),
  "/timesheets": (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  ),
  "/employees": (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </Icon>
  ),
};
