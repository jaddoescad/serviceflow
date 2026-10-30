"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEmployee } from "@/lib/actions/employees";
import type { Role } from "@/lib/types";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { Button, Field, Input, Select } from "./ui";

export function CreateTeamMember({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("painter");
  const [created, setCreated] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <ProjectModal
      title={created ? "User Created" : "Add User"}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      {created ? (
        <>
          <div className="space-y-4 p-5">
            <p className="text-[13px] text-[var(--color-text)]">
              {name} can sign in with {email}.
            </p>
            {password ? (
              <Field label="Temporary password">
                <Input
                  readOnly
                  value={password}
                  autoComplete="off"
                  onFocus={(event) => event.target.select()}
                />
              </Field>
            ) : null}
            <p className="text-[13px] text-[var(--color-muted)]">
              Share these sign-in details securely. The password is shown only
              here.
            </p>
          </div>
          <ModalFooter>
            <Button onClick={onClose}>Done</Button>
          </ModalFooter>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            setError("");
            startTransition(async () => {
              try {
                const result = await createEmployee({
                  fullName: name.trim(),
                  email: email.trim(),
                  role,
                });
                if (!result.ok)
                  setError(result.error || "Could not create user.");
                else {
                  setPassword(result.temporaryPassword ?? null);
                  setCreated(true);
                  router.refresh();
                }
              } catch {
                setError(
                  "Could not confirm account creation. Check Team before trying again.",
                );
              }
            });
          }}
        >
          <div className="space-y-4 p-5">
            <Field label="Full name">
              <Input
                autoFocus
                required
                maxLength={120}
                disabled={pending}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                required
                maxLength={254}
                disabled={pending}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </Field>
            <Field label="Role">
              <Select
                value={role}
                disabled={pending}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                <option value="painter">Painter</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            {error ? (
              <p role="alert" className="text-[13px] text-[var(--color-bad)]">
                {error}
              </p>
            ) : null}
          </div>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !name.trim() || !email.trim()}
            >
              {pending ? "Creating…" : "Create User"}
            </Button>
          </ModalFooter>
        </form>
      )}
    </ProjectModal>
  );
}
