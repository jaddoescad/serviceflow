/** Settings is a set of pages; each holds the sections listed for it, in order. */
export const SETTINGS_PAGES = [
  { id: "company", label: "Company", sections: ["company", "labour"] },
  { id: "team", label: "Team & crews", sections: ["team", "crews"] },
  { id: "branding", label: "Branding & documents", sections: ["branding", "documents"] },
  { id: "proposal-page", label: "Customer proposal page", sections: ["proposal-page"] },
  { id: "templates", label: "Templates", sections: ["templates", "task-templates"] },
  { id: "messaging", label: "Messaging & reviews", sections: ["quo", "email", "reviews"] },
  { id: "booking", label: "Leads & booking", sections: ["lead-intake", "availability"] },
  { id: "payments", label: "Online payments", sections: ["payments"] },
  { id: "integrations", label: "Integrations", sections: ["integrations", "calendar"] },
  { id: "account", label: "Your account", sections: ["account"] },
] as const;

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];
export type SettingsSectionId = (typeof SETTINGS_PAGES)[number]["sections"][number];

export function isSettingsPage(value: string): value is SettingsPageId {
  return SETTINGS_PAGES.some((page) => page.id === value);
}

/** Where a settings section lives: its page, scrolled to the section when it isn't the first there. */
export function settingsHref(section: SettingsSectionId): string {
  const page = SETTINGS_PAGES.find((candidate) => (candidate.sections as readonly string[]).includes(section));
  if (!page) return "/settings";
  return `/settings/${page.id}${page.sections[0] === section ? "" : `#${section}`}`;
}
