import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalSection, PublicPage } from "@/components/public-page";

export const metadata: Metadata = { title: "Privacy policy — ServiceFlow" };

const UPDATED = "November 10, 2026";

export default function PrivacyPage() {
  const email = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <PublicPage>
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-heading)]">Privacy policy</h1>
      <p className="mt-1 text-[13px] text-[var(--color-muted)]">Last updated {UPDATED}</p>
      <p className="mt-5 text-[14px] leading-relaxed [&_a]:text-[var(--color-brand-strong)] [&_a]:underline">
        ServiceFlow (&quot;ServiceFlow&quot;, &quot;we&quot;) provides software that painting and home-service companies
        use to manage leads, appointments, proposals, jobs, crews and invoices at serviceflowapp.com and in the
        ServiceFlow iPhone and Android apps. This policy explains what information we handle, why, and the choices you
        have. Questions: {email}.
      </p>

      <LegalSection title="Who this covers">
        <p>
          Our customers are companies (&quot;companies&quot;). Their staff and crew members sign in to ServiceFlow
          (&quot;users&quot;). Companies also store information about their own customers in ServiceFlow. For that
          customer information, the company decides what is collected and how it is used, and we process it on the
          company&apos;s behalf.
        </p>
      </LegalSection>

      <LegalSection title="Information we handle">
        <ul>
          <li>
            <strong>Account information:</strong> users&apos; names, email addresses, phone numbers, roles and the
            company they belong to.
          </li>
          <li>
            <strong>Company records:</strong> the leads, customers, addresses, appointments, proposals, change orders,
            invoices, payments, notes, photos, videos and documents a company enters or uploads.
          </li>
          <li>
            <strong>Crew time and location:</strong> clock-in and clock-out times, and, in the mobile apps, the device
            location at clock-in and while clocked in, so companies can confirm crews are on site.
          </li>
          <li>
            <strong>Messages:</strong> emails and texts a company sends to its customers through ServiceFlow and the
            replies it receives.
          </li>
          <li>
            <strong>Google Calendar information</strong> when a user connects their Google Calendar (see below).
          </li>
          <li>
            <strong>Technical information:</strong> sign-in sessions, device and browser details, and error reports used
            to keep the service secure and working.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Google Calendar">
        <p>
          Connecting Google Calendar is optional. Each user connects only their own calendar, in Settings › Calendar,
          and grants ServiceFlow permission to view and edit events on calendars they own. ServiceFlow uses only their
          primary calendar. With that permission ServiceFlow:
        </p>
        <ul>
          <li>
            <strong>Adds, updates and removes events</strong> for the ServiceFlow appointments assigned to that user and,
            if they turn it on, their company&apos;s job schedule (title, time, address and notes), and only for those. It
            does not change or delete events it did not create.
          </li>
          <li>
            <strong>Reads the user&apos;s other events.</strong> For users who take appointment bookings, ServiceFlow
            reads the events on their primary calendar from about five weeks back to about two months ahead and stores
            each event&apos;s start and end time, title, location and whether it lasts all day. It does not store
            descriptions or attendees. ServiceFlow uses these events only to avoid suggesting appointment times that
            overlap them, and to show them as read-only entries on the Appointments calendar to the user&apos;s
            company&apos;s managers, so the team can see bookings made in other tools. It refreshes them about every
            10 minutes and replaces the previous copy each time.
          </li>
          <li>
            <strong>Records the Google account email</strong> the user connected, so they can see which calendar is in
            use, and a refresh token that lets ServiceFlow keep the calendar up to date. The token is kept in a private
            part of our database that browsers and apps cannot read, is never shown in the browser, and is encrypted at
            rest by our database provider along with all stored data.
          </li>
        </ul>
        <p>
          ServiceFlow&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Specifically, we use Google user data only to provide the calendar
          features described above; we do not sell it, use it for advertising, or use it to train artificial intelligence
          or machine learning models; we do not transfer it to others except as needed to provide those features, to
          comply with law, or as part of a merger or acquisition with notice to users; and no person reads it except with
          the user&apos;s permission, for security purposes, or to comply with law.
        </p>
        <p>
          A user can disconnect at any time in Settings › Calendar. ServiceFlow then removes the events it added, deletes
          the copied events right away and the stored token once those events are removed, and stops accessing the
          calendar. Access can also be revoked from{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            your Google account permissions
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="How we use information">
        <ul>
          <li>To provide ServiceFlow&apos;s features to companies and their users.</li>
          <li>To send the emails and texts a company asks ServiceFlow to send, and account emails such as sign-in codes.</li>
          <li>To keep the service secure, prevent abuse, fix problems and support users who contact us.</li>
          <li>To comply with legal obligations.</li>
        </ul>
        <p>We do not sell personal information and do not use it for advertising.</p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>
          We use service providers to run ServiceFlow. They process information only on our instructions: Supabase
          (database, sign-in and storage), Vercel (website hosting), Cloudflare (photo and video storage), Google
          (Calendar, and Maps for addresses and drive times), Stripe (card payments), Resend (email), Quo (text
          messages, using each company&apos;s own account), Sentry (error reports), and OpenAI (optional AI features in
          the estimate calculator, which never receive Google user data).
        </p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>
          Company records are kept while the company uses ServiceFlow and deleted on the company&apos;s request.
          Users can delete their account in the mobile apps or by emailing us; we then remove their sign-in, devices and
          location history, and time entries and photos stay with the company&apos;s project records under &quot;Deleted
          user&quot;. Google Calendar data (the token, copied events and records of the events ServiceFlow added) is deleted
          when the calendar is disconnected or the account is deleted. If you delete your account without disconnecting
          first, events ServiceFlow already added stay on your calendar for you to delete.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Information is sent over encrypted connections, access is limited to each company&apos;s own users by role,
          and secrets such as calendar tokens and messaging keys stay on our servers.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can ask to see, correct or delete your personal information by emailing {email}. If your information was
          entered by a company that uses ServiceFlow, we may refer your request to that company.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We will post any changes to this policy on this page and update the date above. Significant changes will also be
          announced in ServiceFlow.
        </p>
      </LegalSection>
    </PublicPage>
  );
}
