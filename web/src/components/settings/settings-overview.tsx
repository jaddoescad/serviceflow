import Link from "next/link";
import type { CompanySettings } from "@/lib/actions/settings";
import type { EmployeeProfile } from "@/lib/types";
import { fmtDate, fmtRelativeTime, initials } from "@/lib/format";
import { Avatar, StatusText } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out";
import { Detail, ROLE_LABELS, SettingsSection } from "./settings-section";

const ROLE_DESCRIPTIONS: Array<{ role: string; text: string }> = [
  { role: "Owner", text: "Full access, including company settings. Can't be demoted or deactivated." },
  { role: "Admin", text: "Company and labour settings and team accounts, plus everything a manager can do." },
  { role: "Manager", text: "Job amounts, budgets, timesheets and the team map. Can't change settings or accounts." },
  { role: "Crew", text: "Clock in and out, view projects, and take and upload photos." },
];

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 font-display text-lg font-semibold tabular-nums text-[var(--color-heading)]">{value}</div>
    </div>
  );
}

export function TeamSection({ team }: { team: CompanySettings["team"] }) {
  return (
    <SettingsSection
      id="team"
      title="Team & access"
      description="Who can use ServiceFlow for your company, and what each role can do."
      footer={
        <>
          <span>
            {team.inactive
              ? `${team.inactive} deactivated ${team.inactive === 1 ? "account" : "accounts"} can't sign in.`
              : "No deactivated accounts."}
          </span>
          <Link href="/employees" className="ml-auto font-medium text-[var(--color-brand-strong)] hover:underline">
            Manage team →
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-4">
        <Figure label="Active members" value={team.active} />
        <Figure label="Owners & admins" value={team.owners + team.admins} />
        <Figure label="Managers" value={team.managers} />
        <Figure label="Crew" value={team.crew} />
      </div>
      <dl className="mt-5 divide-y divide-[var(--color-border)] text-sm">
        {ROLE_DESCRIPTIONS.map(({ role, text }) => (
          <div key={role} className="grid gap-1 py-2.5 sm:grid-cols-[110px_1fr]">
            <dt className="font-medium text-[var(--color-heading)]">{role}</dt>
            <dd className="text-[var(--color-muted)]">{text}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  );
}

function IntegrationRow({
  initial,
  name,
  description,
  tone,
  status,
  detail,
}: {
  initial: string;
  name: string;
  description: string;
  tone: "good" | "warn" | "neutral";
  status: string;
  detail: string;
}) {
  return (
    <li className="flex flex-wrap items-start gap-4 py-4 first:pt-0 last:pb-0">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-sm font-semibold text-[var(--color-heading)]">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-[var(--color-heading)]">{name}</span>
          <StatusText tone={tone}>{status}</StatusText>
        </div>
        <p className="mt-0.5 text-sm text-[var(--color-muted)]">{description}</p>
        <p className="mt-1 text-xs tabular-nums text-[var(--color-muted)]">{detail}</p>
      </div>
    </li>
  );
}

export function IntegrationsSection({
  integrations,
}: {
  integrations: CompanySettings["integrations"];
}) {
  if (!integrations) {
    return (
      <SettingsSection
        id="integrations"
        title="Integrations"
        description="Services connected to your company."
      >
        <p className="text-sm text-[var(--color-muted)]">Only managers can see integration details.</p>
      </SettingsSection>
    );
  }
  const { dripjobs, companycam, appPhotos } = integrations;
  const dripjobsRecent =
    dripjobs.lastReceivedAt != null &&
    Date.now() - new Date(dripjobs.lastReceivedAt).getTime() < 7 * 24 * 60 * 60 * 1000;
  const number = (value: number) => value.toLocaleString("en-CA");

  return (
    <SettingsSection
      id="integrations"
      title="Integrations"
      description="Services that send data into ServiceFlow for your company."
    >
      <ul className="divide-y divide-[var(--color-border)]">
        <IntegrationRow
          initial="DJ"
          name="DripJobs"
          description="New leads, quotes and won jobs arrive automatically."
          tone={dripjobs.events === 0 ? "neutral" : dripjobs.failed30d ? "warn" : dripjobsRecent ? "good" : "warn"}
          status={
            dripjobs.events === 0
              ? "Not connected"
              : dripjobs.failed30d
                ? `${dripjobs.failed30d} failed in 30 days`
                : dripjobsRecent
                  ? "Receiving"
                  : "Quiet this week"
          }
          detail={
            dripjobs.events
              ? `${number(dripjobs.events30d)} events in the last 30 days · last ${fmtRelativeTime(dripjobs.lastReceivedAt)}`
              : "No events received yet."
          }
        />
        <IntegrationRow
          initial="CC"
          name="CompanyCam"
          description="Project photos imported from CompanyCam."
          tone="neutral"
          status={companycam.photos ? "Imported" : "Not imported"}
          detail={
            companycam.photos
              ? `${number(companycam.photos)} photos · last import ${fmtDate(companycam.lastImportedAt)}`
              : "No photos imported."
          }
        />
        <IntegrationRow
          initial="SF"
          name="ServiceFlow app"
          description="Photos and videos your crew capture on site."
          tone={appPhotos.photos ? "good" : "neutral"}
          status={appPhotos.photos ? "In use" : "No uploads yet"}
          detail={
            appPhotos.photos
              ? `${number(appPhotos.photos)} uploads · last ${fmtDate(appPhotos.lastUploadedAt)}`
              : "Crew photos will appear here once uploaded."
          }
        />
      </ul>
    </SettingsSection>
  );
}

export function AccountSection({
  profile,
  role,
  companySince,
}: {
  profile: EmployeeProfile;
  role: string | null;
  companySince: string;
}) {
  const name = profile.full_name ?? profile.email ?? "You";
  return (
    <SettingsSection
      id="account"
      title="Your account"
      description="The account you're signed in with."
      footer={
        <>
          <span>Change your name or phone from the Team page.</span>
          <SignOutButton className="ml-auto" />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <Avatar label={initials(name)} />
        <div className="min-w-0">
          <div className="font-medium text-[var(--color-heading)]">{name}</div>
          <div className="text-sm text-[var(--color-muted)]">{profile.email}</div>
        </div>
      </div>
      <div className="mt-5 grid gap-4 border-t border-[var(--color-border)] pt-5 sm:grid-cols-2">
        <Detail label="Role">{role ? ROLE_LABELS[role] ?? role : "—"}</Detail>
        <Detail label="Company on ServiceFlow since">{fmtDate(companySince || null)}</Detail>
      </div>
    </SettingsSection>
  );
}
