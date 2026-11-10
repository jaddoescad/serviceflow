import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, LegalSection, PublicPage } from "@/components/public-page";

export const metadata: Metadata = { title: "Terms of service — ServiceFlow" };

const UPDATED = "November 10, 2026";

export default function TermsPage() {
  const email = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <PublicPage>
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-heading)]">Terms of service</h1>
      <p className="mt-1 text-[13px] text-[var(--color-muted)]">Last updated {UPDATED}</p>
      <p className="mt-5 text-[14px] leading-relaxed [&_a]:text-[var(--color-brand-strong)] [&_a]:underline">
        These terms apply to ServiceFlow (&quot;ServiceFlow&quot;, &quot;we&quot;), the software at serviceflowapp.com and
        the ServiceFlow iPhone and Android apps. By creating a company or signing in, you agree to them. If you use
        ServiceFlow for a company, you agree on behalf of that company. Questions: {email}.
      </p>

      <LegalSection title="The service">
        <p>
          ServiceFlow helps painting and home-service companies manage leads, appointments, proposals, jobs, crews,
          photos and invoices. We may change, add or remove features over time. Some features rely on other services,
          such as Google Calendar, Stripe or a company&apos;s own text-messaging account, and work only while those services
          are available and connected.
        </p>
      </LegalSection>

      <LegalSection title="Accounts">
        <ul>
          <li>Keep your sign-in details to yourself and tell us promptly if you think someone else has used your account.</li>
          <li>
            The person who creates a company, and the admins they appoint, control who can access that company&apos;s
            information and what each person can do.
          </li>
          <li>You are responsible for what happens under your account and your company&apos;s accounts.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Your company's information">
        <p>
          Your company owns the information it puts into ServiceFlow, including its customers&apos; details, documents,
          photos and records. You give us permission to store and process that information only to provide ServiceFlow
          to you, as described in our <Link href="/privacy">privacy policy</Link>.
        </p>
        <p>
          You are responsible for having the right to enter and use that information, and for getting any consent your
          customers must give before you email or text them, including under anti-spam laws such as Canada&apos;s CASL.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>Don&apos;t use ServiceFlow to:</p>
        <ul>
          <li>break the law or anyone&apos;s rights, or send spam or misleading messages;</li>
          <li>upload malicious code or try to get into accounts, companies or systems you aren&apos;t allowed to access;</li>
          <li>interfere with the service or put an unreasonable load on it; or</li>
          <li>copy, resell or reverse-engineer ServiceFlow except as the law allows.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Connected services">
        <p>
          When you connect another service, such as Google Calendar, you also agree to that service&apos;s own terms, and
          you can disconnect it at any time. How ServiceFlow uses information from Google is described in the{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Fees">
        <p>Any fees for ServiceFlow are agreed with your company separately before they apply.</p>
      </LegalSection>

      <LegalSection title="Ending your use">
        <p>
          You can stop using ServiceFlow at any time, delete your user account in the mobile apps, or ask us to delete
          your company&apos;s information by emailing {email}. We may suspend or close an account that breaks these terms or
          puts the service or other users at risk, and will tell you when we reasonably can.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers">
        <p>
          We work to keep ServiceFlow available, accurate and secure, but it is provided &quot;as is&quot;. We do not
          promise it will be uninterrupted or error-free. Check important figures, such as prices, taxes, payroll hours and
          invoice totals, before relying on them.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the extent the law allows, ServiceFlow is not liable for indirect or consequential losses, such as lost
          profits, revenue or data, and our total liability for any claim is limited to the amount your company paid us
          for ServiceFlow in the twelve months before the claim.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>These terms are governed by the laws of the Province of Ontario and the federal laws of Canada that apply there.</p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. We will post changes on this page and update the date above, and announce
          significant changes in ServiceFlow. Continuing to use ServiceFlow after a change means you accept it.
        </p>
      </LegalSection>
    </PublicPage>
  );
}
