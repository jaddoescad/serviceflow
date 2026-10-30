"use client";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { initials } from "@/lib/format";
import { useRouter } from "next/navigation";
import { setActive, setPayRate, setRole } from "@/lib/actions/employees";
import dynamic from "next/dynamic";
import { PageHeader } from "./kpi";
import { DataTable, RowLink, TablePanel, TableToolbar, Td, Th, Tr } from "./table-ui";
import { Avatar, Button, EmptyState, Input, Select, StatusText } from "./ui";
const CreateTeamMember = dynamic(() =>
  import("./create-team-member").then((module) => module.CreateTeamMember),
);
import type { Role } from "@/lib/types";

const EditTeamMember = dynamic(() =>
  import("./edit-team-member").then((module) => module.EditTeamMember),
);

type TeamMember = {
  phone: string | null;
  job_title: string | null;
  updated_at: string;
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  hourly_rate: number | null;
};
function MemberRole({
  member,
  disabled,
}: {
  member: TeamMember;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      <select
        aria-label={`Role for ${member.full_name || member.email}`}
        value={member.role}
        disabled={disabled || pending}
        className="h-7 rounded-[var(--radius-control)] border border-transparent bg-transparent pl-1 pr-5 text-[13px] capitalize text-[var(--color-text)] outline-none hover:border-[var(--color-border-strong)] focus:border-[var(--color-brand)] focus:shadow-[var(--focus-ring)] disabled:appearance-none disabled:hover:border-transparent"
        onChange={(event) => {
          const role = event.target.value as Role;
          setError("");
          startTransition(async () => {
            try {
              const result = await setRole(member.id, role);
              if (result.error) setError(result.error);
              else router.refresh();
            } catch {
              setError("Could not update role. Try again.");
            }
          });
        }}
      >
        <option value="admin">Admin</option>
        <option value="manager">Manager</option>
        <option value="painter">Painter</option>
      </select>
      {error ? (
        <p role="alert" className="mt-1 max-w-xs text-xs text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
    </>
  );
}

function MemberRate({ member }: { member: TeamMember }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const name = member.full_name || member.email;
  if (!editing)
    return (
      <span className="inline-flex items-center gap-1">
        {member.hourly_rate == null
          ? "—"
          : `$${member.hourly_rate.toFixed(2)}/hr`}
        <button
          type="button"
          aria-label={`Edit hourly rate for ${name}`}
          onClick={() => {
            setValue(member.hourly_rate?.toString() ?? "");
            setError("");
            setEditing(true);
          }}
          className="rounded-md p-1 text-[var(--color-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M12.5 4.5 15.5 7.5 7.5 15.5H4.5v-3zM11 6l3 3" />
          </svg>
        </button>
      </span>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        startTransition(async () => {
          try {
            const result = await setPayRate({
              userId: member.id,
              hourlyRate: Number(value),
              effectiveFrom: new Date().toLocaleDateString("en-CA", {
                timeZone: "America/Toronto",
              }),
            });
            if (result.error) setError(result.error);
            else {
              setEditing(false);
              router.refresh();
            }
          } catch {
            setError("Could not save rate. Try again.");
          }
        });
      }}
    >
      <div className="flex items-center gap-1">
        <span className="text-[var(--color-muted)]">$</span>
        <div className="w-20">
          <Input
            autoFocus
            type="number"
            min="0.01"
            step="0.01"
            required
            aria-label={`Hourly rate for ${name}`}
            value={value}
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setEditing(false);
            }}
          />
        </div>
      </div>
      <div className="mt-1 flex gap-1">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function MemberMenu({
  member,
  onEdit,
  isSelf,
}: {
  member: TeamMember;
  onEdit: () => void;
  isSelf: boolean;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        disabled={pending}
        aria-label={`Manage ${member.full_name || member.email}`}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(
              8,
              Math.min(bounds.right - 192, window.innerWidth - 200),
            ),
            top:
              bounds.bottom + 100 < window.innerHeight
                ? bounds.bottom + 4
                : Math.max(8, bounds.top - 100),
          });
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-base text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] disabled:opacity-50"
      >
        ···
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        style={position}
        className="fixed m-0 w-48 rounded-[var(--radius)] border-0 bg-[var(--color-surface)] p-1 text-[13px] shadow-[var(--shadow-pop)]"
      >
        <button
          type="button"
          onClick={() => {
            menu.current?.hidePopover();
            onEdit();
          }}
          className="flex h-8 w-full items-center rounded-md px-2 text-left text-[var(--color-text)] hover:bg-[var(--color-hover)]"
        >
          Edit User
        </button>
        <button
          type="button"
          disabled={pending || isSelf}
          className={`flex h-8 w-full items-center rounded-md px-2 text-left hover:bg-[var(--color-hover)] disabled:opacity-50 ${member.is_active ? "text-[var(--color-bad)]" : "text-[var(--color-text)]"}`}
          onClick={() => {
            menu.current?.hidePopover();
            setError("");
            startTransition(async () => {
              try {
                const result = await setActive(member.id, !member.is_active);
                if (result.error) setError(result.error);
                else router.refresh();
              } catch {
                setError("Could not update account status. Try again.");
              }
            });
          }}
        >
          {member.is_active ? "Deactivate" : "Reactivate"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 max-w-xs text-xs text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function TeamDirectory({
  members,
  actorId,
  canManage,
  showRates,
}: {
  members: TeamMember[];
  actorId: string;
  canManage: boolean;
  showRates: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const visible = useMemo(
    () =>
      members
        .filter(
          (member) =>
            (status === "all" || member.is_active === (status === "active")) &&
            `${member.full_name ?? ""} ${member.email ?? ""}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(b.is_active) - Number(a.is_active) ||
            (a.full_name || a.email || "").localeCompare(
              b.full_name || b.email || "",
            ),
        ),
    [members, search, status],
  );
  return (
    <div className="page-fill">
      <PageHeader
        title="Team"
        subtitle={visible.length}
        actions={canManage ? <Button onClick={() => setCreating(true)}>+ Add User</Button> : null}
      />
      <TableToolbar>
        <div className="w-full sm:w-64">
          <Input
            type="search"
            aria-label="Find a team member"
            placeholder="Find a team member…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          aria-label="Team status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All users</option>
        </Select>
      </TableToolbar>
      <TablePanel fill>
        <DataTable minWidth={680}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Contact</Th>
              {showRates ? <Th>Hourly rate</Th> : null}
              <Th>Status</Th>
              {canManage ? (
                <Th className="w-12">
                  <span className="sr-only">Manage user</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((member) => (
              <Tr key={member.id}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar label={initials(member.full_name ?? member.email ?? "?")} />
                    <div className="min-w-0">
                      <RowLink href={`/employees/${member.id}`}>
                        <span className={member.is_active ? undefined : "text-[var(--color-muted)]"}>
                          {member.full_name || member.email}
                        </span>
                      </RowLink>
                      {member.job_title ? (
                        <div className="text-xs font-normal text-[var(--color-muted)]">
                          {member.job_title}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Td>
                <Td>
                  <MemberRole
                    member={member}
                    disabled={!canManage || member.id === actorId}
                  />
                </Td>
                <Td muted className="break-words">
                  {member.email ? (
                    <a
                      href={`mailto:${member.email}`}
                      className="hover:text-[var(--color-heading)] hover:underline"
                    >
                      {member.email}
                    </a>
                  ) : (
                    "—"
                  )}
                  {member.phone ? (
                    <a
                      href={`tel:${member.phone}`}
                      className="block hover:text-[var(--color-heading)] hover:underline"
                    >
                      {member.phone}
                    </a>
                  ) : null}
                </Td>
                {showRates ? (
                  <Td className="whitespace-nowrap tabular-nums">
                    <MemberRate member={member} />
                  </Td>
                ) : null}
                <Td>
                  <StatusText tone={member.is_active ? "good" : "neutral"}>
                    {member.is_active ? "Active" : "Deactivated"}
                  </StatusText>
                </Td>
                {canManage ? (
                  <Td className="text-right">
                    <MemberMenu
                      member={member}
                      isSelf={member.id === actorId}
                      onEdit={() => setEditing(member)}
                    />
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </DataTable>
        {visible.length ? null : <EmptyState>No team members match.</EmptyState>}
      </TablePanel>
      {editing ? (
        <EditTeamMember member={editing} onClose={() => setEditing(null)} />
      ) : null}
      {creating ? (
        <CreateTeamMember onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}
