import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { buttonClassName } from "@/components/ui";

export const metadata: Metadata = {
  title: "ServiceFlow — software for painting and home-service companies",
  description:
    "ServiceFlow runs a painting or home-service company's sales and jobs: leads, estimate appointments, proposals, job schedules, crew hours, photos and invoices.",
};

const FEATURES: { title: string; body: string }[] = [
  {
    title: "Leads and estimate appointments",
    body: "New leads land in a sales pipeline. When you book an estimate, ServiceFlow suggests times when your estimator is free and close to their other visits.",
  },
  {
    title: "Proposals customers can sign",
    body: "Send proposals and change orders by email or text. Customers review, sign and pay a deposit from a private link.",
  },
  {
    title: "Job schedule and crews",
    body: "Schedule jobs, assign crews and track the hours they clock against each job's labour budget.",
  },
  {
    title: "Photos, invoices and job costing",
    body: "Keep every project's photos, documents, invoices and costs in one place.",
  },
];

/** The home page for signed-out visitors (signed-in staff see their Today page at /). */
export default function AboutPage() {
  return (
    <PublicPage>
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-heading)] sm:text-3xl">
        Run your painting company from lead to final invoice.
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--color-muted)]">
        ServiceFlow is the office and field software for painting and home-service companies. Your sales team, office
        and crews work from the same customers, appointments and jobs on the web and on iPhone and Android.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/signup" className={buttonClassName()}>Create a company</Link>
        <Link href="/login" className={buttonClassName({ variant: "secondary" })}>Sign in</Link>
      </div>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="text-[14px] font-semibold text-[var(--color-heading)]">{feature.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted)]">{feature.body}</p>
          </div>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-[var(--color-heading)]">Google Calendar</h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed">
          Each team member can connect their own Google Calendar in Settings. ServiceFlow then adds the appointments
          assigned to them, and the job schedule if they choose, to that calendar, updates or removes those events when plans change, and checks when they
          are already busy so new appointments aren&apos;t booked over other commitments. Those other events also appear,
          read-only, on the Appointments calendar for your managers. ServiceFlow keeps their time, title and location, never
          their descriptions or attendees. You can disconnect at any time.
          See the <Link href="/privacy" className="text-[var(--color-brand-strong)] underline">privacy policy</Link> for
          details.
        </p>
      </section>
    </PublicPage>
  );
}
