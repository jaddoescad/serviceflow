import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { documentStrings } from "@/lib/customer-i18n";
import { getPublicDocument } from "@/lib/proposals";
import type { DocumentKind } from "@/lib/proposal-types";
import { PublicDocumentView } from "./public-document";

type Props = { params: Promise<{ token: string }> };

/** The page and metadata behind a customer's private link: /p, /co and /i differ only by kind. */
export function publicDocumentRoute(kind: DocumentKind) {
  /** The title also names the file when the customer saves the page as a PDF. */
  async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { token } = await params;
    const doc = await getPublicDocument(kind, token);
    const t = documentStrings();
    const label = `${t.kind[kind]}${doc?.number ? ` #${doc.number}` : ""}`;
    return {
      title: doc ? `${label} – ${doc.company.name}` : label,
      robots: { index: false, follow: false },
    };
  }
  async function PublicDocumentPage({ params }: Props) {
    const { token } = await params;
    const doc = await getPublicDocument(kind, token);
    if (!doc) notFound();
    return <PublicDocumentView doc={doc} token={token} />;
  }
  return { generateMetadata, Page: PublicDocumentPage };
}
