import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CustomerPortalView, type PortalView } from "@/components/customer-portal";
import { portalLanguage, portalStrings } from "@/lib/portal-i18n";
import type { CustomerPortal } from "@/lib/portal-types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ view?: string }>;
};

const VIEWS: PortalView[] = ["proposals", "changeOrders", "invoices", "appointments", "request", "preferences"];

/** Shared by the page and its metadata, so one request runs it once. */
const loadPortal = cache(async (token: string): Promise<CustomerPortal | null> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("view_customer_portal", { requested_token: token });
  return (data as CustomerPortal | null) ?? null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const portal = await loadPortal(token);
  const lang = portalLanguage(portal?.customer.language, (await headers()).get("accept-language"));
  const title = portalStrings(lang).pageTitle;
  return {
    title: portal ? `${title} – ${portal.company.name}` : title,
    robots: { index: false, follow: false },
  };
}

/** A customer's private portal. `?view=preferences` opens message settings (unsubscribe links). */
export default async function CustomerPortalPage({ params, searchParams }: Props) {
  const [{ token }, { view }, requestHeaders] = await Promise.all([params, searchParams, headers()]);
  const portal = await loadPortal(token);
  if (!portal) notFound();
  const initialView = VIEWS.find((candidate) => candidate === view) ?? null;
  return (
    <CustomerPortalView
      portal={portal}
      token={token}
      initialLanguage={portalLanguage(portal.customer.language, requestHeaders.get("accept-language"))}
      initialView={initialView}
    />
  );
}
