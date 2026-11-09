import { ContactsTable } from "@/components/contacts-table";
import { LiveRefresh } from "@/components/live-refresh";
import { getHomeOrgId, requireMember } from "@/lib/auth";
import { getCustomerList, getCustomerListOptions } from "@/lib/contacts";
import { CUSTOMER_PAGE_SIZE, parseCustomerListParams } from "@/lib/customer-list";
import { getProjectLabels } from "@/lib/project-workspace";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = parseCustomerListParams(raw);
  const [profile, { rows, total }, options, labels, orgId] = await Promise.all([
    requireMember(),
    getCustomerList(params),
    getCustomerListOptions(),
    getProjectLabels(),
    getHomeOrgId(),
  ]);
  const page = Math.min(params.page, Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)));

  return (
    <div className="page-fill">
      {/* The customer list shows each customer's deals, so lead changes count too. */}
      {orgId && <LiveRefresh orgId={orgId} tables={["contacts", "leads"]} />}
      <ContactsTable
        initiallyOpen={raw.create === "1"}
        rows={rows}
        total={total}
        params={{ ...params, page }}
        options={options}
        labels={labels}
        canManage={["admin", "manager"].includes(profile.role)}
      />
    </div>
  );
}
