import Link from "next/link";
import { CatalogItemDialog } from "@/components/catalog-item-dialog";
import { PageHeader } from "@/components/kpi";
import { DataTable, RowLink, TablePanel, Td, Th, Tr } from "@/components/table-ui";
import { EmptyState, buttonClassName } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtCents } from "@/lib/line-items";
import { getCatalogItems } from "@/lib/proposals";
import { ProposalsTabs } from "../tabs";

export const dynamic = "force-dynamic";

const PATH = "/proposals/catalog";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const [{ item: opened }, , items] = await Promise.all([searchParams, requireStaff(), getCatalogItems()]);
  const editing = items.find((item) => item.id === opened) ?? null;
  return (
    <div className="page-fill">
      <PageHeader
        title="Proposals"
        actions={
          <Link href={`${PATH}?item=new`} scroll={false} className={buttonClassName()}>
            + New Item
          </Link>
        }
      />
      <ProposalsTabs active="catalog" />
      <TablePanel fill>
        <DataTable minWidth={560}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th numeric>Price</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Tr key={item.id}>
                <Td>
                  <RowLink href={`${PATH}?item=${item.id}`}>{item.name}</RowLink>
                </Td>
                <Td muted className="w-1/2 max-w-0 truncate">
                  {item.description}
                </Td>
                <Td numeric>{fmtCents(item.unitPriceCents)}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        {items.length ? null : <EmptyState>No products or services yet.</EmptyState>}
      </TablePanel>
      {opened === "new" || editing ? <CatalogItemDialog key={opened} item={editing} closeHref={PATH} /> : null}
    </div>
  );
}
