"use client";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { initials } from "@/lib/format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setActive, setRole } from "@/lib/actions/employees";
import dynamic from "next/dynamic";
import { Button } from "./ui";
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
        className="rounded border border-transparent bg-transparent py-1 pr-4 capitalize hover:border-slate-300 disabled:appearance-none"
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
        <p role="alert" className="mt-1 max-w-xs text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </>
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
        className="h-9 w-9 rounded text-xl hover:bg-slate-100 disabled:opacity-50"
      >
        ···
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        style={position}
        className="fixed m-0 w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg"
      >
        <button
          type="button"
          onClick={() => {
            menu.current?.hidePopover();
            onEdit();
          }}
          className="w-full rounded px-3 py-2 text-left text-slate-800 hover:bg-slate-100"
        >
          Edit User
        </button>
        <button
          type="button"
          disabled={pending || isSelf}
          className={`w-full rounded px-3 py-2 text-left hover:bg-slate-100 ${member.is_active ? "text-red-700" : "text-slate-800"}`}
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
        <p role="alert" className="mt-1 max-w-xs text-xs text-red-700">
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
    <section className="workspace-page">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-extrabold tracking-tight">Team</h1>
        {canManage ? (
          <Button onClick={() => setCreating(true)}>＋ Add User</Button>
        ) : null}
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="Find a team member"
          placeholder="Find a team member…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:w-80"
        />
        <select
          aria-label="Team status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All users</option>
        </select>

      </div>
      <div className="relative mt-6 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[680px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[32%]" />
            <col className="w-[16%]" />
            <col />
            {showRates ? <col className="w-28" /> : null}
            <col className="w-32" />
            {canManage ? <col className="w-14" /> : null}
          </colgroup>
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              {showRates ? (
                <th className="px-4 py-3 font-medium">Hourly rate</th>
              ) : null}
              <th className="px-4 py-3 font-medium">Status</th>
              {canManage ? (
                <th>
                  <span className="sr-only">Manage user</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((member) => (
              <tr
                key={member.id}
                className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/70 ${member.is_active ? "" : "text-slate-500"}`}
              >
                <td className="px-4 py-5">
                  <Link
                    href={`/employees/${member.id}`}
                    className="flex items-center gap-4 rounded-sm hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-600">
                      {initials(member.full_name ?? member.email ?? "?")}
                    </span>
                    <span className="min-w-0 break-words font-semibold">
                      {member.full_name || member.email}
                      {member.job_title ? (
                        <span className="mt-1 block text-xs font-normal text-slate-500">
                          {member.job_title}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-5 capitalize">
                  <MemberRole
                    member={member}
                    disabled={!canManage || member.id === actorId}
                  />
                </td>
                <td className="break-words px-4 py-5 text-sm text-slate-500">
                  {member.email ? (
                    <a
                      href={`mailto:${member.email}`}
                      className="hover:text-blue-600"
                    >
                      {member.email}
                    </a>
                  ) : (
                    "—"
                  )}
                  {member.phone ? (
                    <a
                      href={`tel:${member.phone}`}
                      className="mt-1 block hover:text-blue-600"
                    >
                      {member.phone}
                    </a>
                  ) : null}
                </td>
                {showRates ? (
                  <td className="px-4 py-5 tabular-nums">
                    {member.hourly_rate == null
                      ? "—"
                      : `$${member.hourly_rate.toFixed(2)}/hr`}
                  </td>
                ) : null}
                <td className="px-4 py-5 text-xs">
                  {member.is_active ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-500">
                      Deactivated
                    </span>
                  )}
                </td>
                {canManage ? (
                  <td className="px-2 py-5">
                    <MemberMenu
                      member={member}
                      isSelf={member.id === actorId}
                      onEdit={() => setEditing(member)}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length ? (
        <p className="py-16 text-center text-sm text-slate-500">
          No team members match.
        </p>
      ) : null}
      {editing ? (
        <EditTeamMember member={editing} onClose={() => setEditing(null)} />
      ) : null}
      {creating ? (
        <CreateTeamMember onClose={() => setCreating(false)} />
      ) : null}
    </section>
  );
}
