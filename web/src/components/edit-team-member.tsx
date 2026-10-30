"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editTeamProfile } from "@/lib/actions/employees";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { Button, Field, Input } from "./ui";
export type EditableTeamProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  job_title: string | null;
  updated_at: string;
};
export function EditTeamMember({
  member,
  onClose,
}: {
  member: EditableTeamProfile;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(member.full_name ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [title, setTitle] = useState(member.job_title ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <ProjectModal
      title="Edit User"
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setError("");
          startTransition(async () => {
            try {
              const result = await editTeamProfile({
                userId: member.id,
                fullName: name,
                phone,
                jobTitle: title,
                expectedUpdatedAt: member.updated_at,
              });
              if (result.error) setError(result.error);
              else {
                router.refresh();
                onClose();
              }
            } catch {
              setError("Could not save profile. Your changes are still here.");
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
              value={name}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Phone number">
            <Input
              type="tel"
              maxLength={60}
              value={phone}
              disabled={pending}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field label="Job title">
            <Input
              maxLength={120}
              value={title}
              disabled={pending}
              onChange={(event) => setTitle(event.target.value)}
            />
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
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save Changes"}
          </Button>
        </ModalFooter>
      </form>
    </ProjectModal>
  );
}
