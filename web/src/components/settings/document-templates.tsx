"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDocumentTemplate } from "@/lib/actions/document-templates";
import { Button } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

/** Settings › Document templates: pages every new job starts with a copy of. */
export function DocumentTemplates({ templates }: { templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      setError("");
      const result = await createDocumentTemplate();
      if (!result.ok || !result.templateId) setError(result.error ?? "Could not create the template.");
      else router.push(`/settings/templates/${result.templateId}`);
    });
  }

  return (
    <SettingsSection
      id="templates"
      title="Document templates"
      description="Every new job starts with a copy of these in its Documents."
      footer={
        <>
          <SaveStatus error={error} />
          <Button variant="secondary" className="ml-auto" disabled={pending} onClick={create}>
            {pending ? "Creating…" : "New template"}
          </Button>
        </>
      }
    >
      {templates.length ? (
        <ul className="-my-2 divide-y divide-[var(--color-border)]">
          {templates.map((template) => (
            <li key={template.id} className="flex min-h-10 items-center py-1.5 text-[13px]">
              <Link
                href={`/settings/templates/${template.id}`}
                className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)] hover:underline"
              >
                {template.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--color-muted)]">No templates yet.</p>
      )}
    </SettingsSection>
  );
}
