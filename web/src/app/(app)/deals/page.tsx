import { redirect } from "next/navigation";

/** Deals live in the sales pipeline; its list view replaces the old table. */
export default function DealsPage() {
  redirect("/pipeline/sales?view=list");
}
