"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { cn } from "./ui";

type SidebarState = {
  collapsed: boolean;
  /** Open the sidebar with the search box focused. */
  focusSearch: boolean;
  expandToSearch: () => void;
};

const SidebarContext = createContext<SidebarState>({
  collapsed: false,
  focusSearch: false,
  expandToSearch: () => {},
});

export const useSidebar = () => useContext(SidebarContext);

/** The desktop sidebar: full width, or a rail of icons. */
export function AppSidebar({ initialCollapsed, children }: { initialCollapsed: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [focusSearch, setFocusSearch] = useState(false);

  function set(next: boolean) {
    setCollapsed(next);
    setFocusSearch(false);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        focusSearch,
        expandToSearch: () => {
          set(false);
          setFocusSearch(true);
        },
      }}
    >
      <aside
        data-sidebar={collapsed ? "collapsed" : "expanded"}
        className={cn(
          "sticky top-0 z-30 hidden h-svh shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] md:flex print:hidden",
          collapsed ? "w-14" : "w-[232px]",
        )}
      >
        {children}
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={() => set(!collapsed)}
          className={cn(
            "m-2 flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] text-[var(--sidebar-muted)] outline-none hover:bg-[var(--sidebar-surface)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]",
            collapsed && "justify-center px-0",
          )}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
            <path d={collapsed ? "m13 10 2 2-2 2" : "m15 10-2 2 2 2"} />
          </svg>
          {collapsed ? null : "Collapse"}
        </button>
      </aside>
    </SidebarContext.Provider>
  );
}
