import { notFound } from "next/navigation";
import { ProposalEditor } from "@/components/proposal-editor";
import { requireStaff } from "@/lib/auth";
import { getCatalogItems, getProposalTemplates } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export default async function ProposalTemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const isNew = templateId === "new";
  const [, templates, catalog] = await Promise.all([requireStaff(), getProposalTemplates(), getCatalogItems()]);
  const template = templates.find((item) => item.id === templateId);
  if (!isNew && !template) notFound();
  return (
    <ProposalEditor
      key={template?.id ?? "new"}
      mode="template"
      id={template?.id ?? crypto.randomUUID()}
      isNew={isNew}
      initial={
        template ?? {
          name: "",
          items: [],
          taxRatePercent: 13,
          depositPercent: null,
          depositCents: null,
          discountPercent: null,
          discountCents: null,
          packages: [],
          selectedPackageId: null,
          intro: "",
          terms: "",
          validUntil: null,
        }
      }
      catalog={catalog}
      backHref="/proposals/templates"
      backLabel="Templates"
    />
  );
}
