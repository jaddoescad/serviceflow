import { PageTabs } from "@/components/page-tabs";

/** Proposals, Templates and Products & services share one header; these tabs switch between them. */
export function ProposalsTabs({ active }: { active: "proposals" | "templates" | "catalog" }) {
  return (
    <PageTabs
      label="Proposals sections"
      tabs={[
        { href: "/proposals", label: "Proposals", active: active === "proposals" },
        { href: "/proposals/templates", label: "Templates", active: active === "templates" },
        { href: "/proposals/catalog", label: "Products & services", active: active === "catalog" },
      ]}
    />
  );
}
