import Link from "next/link";
import type { CompanySettings } from "@/lib/actions/settings";
import type { EmployeeProfile } from "@/lib/types";
import { fmtDate, fmtRelativeTime, initials } from "@/lib/format";
import { Avatar, StatusText, Tag } from "@/components/ui";
import { SignOutButton } from "@/components/sign-out";
import { Detail, SettingsSection } from "./settings-section";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  crew: "Crew",
};

const ROLE_DESCRIPTIONS: Array<{ role: string; count: "owners" | "admins" | "managers" | "crew"; text: string }> = [
  { role: "Owner", count: "owners", text: "Full access, including company settings. Can't be demoted or deactivated." },
  { role: "Admin", count: "admins", text: "Company and labour settings and team accounts, plus everything a manager can do." },
  { role: "Manager", count: "managers", text: "Job amounts, budgets, timesheets and the team map. Can't change settings or accounts." },
  { role: "Crew", count: "crew", text: "Clock in and out, view projects, and take and upload photos." },
];

export function TeamSection({ team }: { team: CompanySettings["team"] }) {
  return (
    <SettingsSection
      id="team"
      title="Team & access"
      description="Who can use ServiceFlow for your company, and what each role can do."
      footer={
        <>
          <span>
            {team.active} active {team.active === 1 ? "member" : "members"}
            {team.inactive ? ` · ${team.inactive} deactivated` : ""}
          </span>
          <Link href="/employees" className="ml-auto font-medium text-[var(--color-brand-strong)] hover:underline">
            Manage team →
          </Link>
        </>
      }
    >
      <dl className="-my-2 divide-y divide-[var(--color-border)] text-[13px]">
        {ROLE_DESCRIPTIONS.map(({ role, count, text }) => (
          <div key={role} className="grid gap-1 py-2.5 sm:grid-cols-[120px_1fr]">
            <dt className="flex items-center gap-2 font-medium text-[var(--color-heading)]">
              {role}
              <Tag className="tabular-nums">{team[count]}</Tag>
            </dt>
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
    <li className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-heading)]">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[13px] font-medium text-[var(--color-heading)]">{name}</span>
          <StatusText tone={tone}>{status}</StatusText>
        </div>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{description}</p>
        <p className="mt-0.5 text-xs tabular-nums text-[var(--color-faint)]">{detail}</p>
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
        <p className="text-[13px] text-[var(--color-muted)]">Only managers can see integration details.</p>
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
      <div className="flex flex-wrap items-center gap-3">
        <Avatar label={initials(name)} />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[var(--color-heading)]">{name}</div>
          <div className="text-[13px] text-[var(--color-muted)]">{profile.email}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2">
        <Detail label="Role">{role ? ROLE_LABELS[role] ?? role : "—"}</Detail>
        <Detail label="Company on ServiceFlow since">{fmtDate(companySince || null)}</Detail>
      </div>
    </SettingsSection>
  );
}
