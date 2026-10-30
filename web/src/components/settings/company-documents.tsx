"use client";

import { useRef, useState, useTransition } from "react";
import { addCompanyDocument, deleteCompanyDocument, type CompanyDocument } from "@/lib/actions/settings";
import { documentAssetUrl, removeDocumentAssets, uploadDocumentAsset } from "@/lib/document-assets";
import { Button } from "@/components/ui";
import { TrashIcon } from "@/components/pipeline-ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
// The document-assets bucket's limit.
const MAX_FILE_MB = 25;

export function CompanyDocuments({
  orgId,
  documents,
  canManage,
}: {
  orgId: string;
  documents: CompanyDocument[];
  canManage: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  function upload(files: File[]) {
    if (!files.length) return;
    const wrongType = files.find((file) => !FILE_TYPES.includes(file.type));
    if (wrongType) {
      setStatus({ error: `${wrongType.name} isn't a PDF or image.` });
      return;
    }
    const tooBig = files.find((file) => file.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) {
      setStatus({ error: `${tooBig.name} is over ${MAX_FILE_MB} MB.` });
      return;
    }
    setUploading(true);
    startTransition(async () => {
      setStatus({});
      for (const file of files) {
        let path: string;
        try {
          path = await uploadDocumentAsset(orgId, file, file.name);
        } catch {
          setStatus({ error: `Could not upload ${file.name}. Try again.` });
          return;
        }
        const result = await addCompanyDocument({
          name: file.name,
          path,
          mimeType: file.type,
          byteSize: file.size,
        });
        if (!result.ok) {
          await removeDocumentAssets([path]);
          setStatus({ error: result.error ?? `Could not add ${file.name}.` });
          return;
        }
      }
      setStatus({ message: files.length === 1 ? "Document added." : `${files.length} documents added.` });
    });
  }

  function remove(document: CompanyDocument) {
    if (!window.confirm(`Delete “${document.name}”?`)) return;
    setUploading(false);
    startTransition(async () => {
      setStatus({});
      const result = await deleteCompanyDocument(document.id);
      if (!result.ok) {
        setStatus({ error: result.error ?? "Could not delete the document." });
        return;
      }
      await removeDocumentAssets([document.path]);
      setStatus({ message: "Document deleted." });
    });
  }

  return (
    <SettingsSection
      id="documents"
      title="Company documents"
      description="Insurance, WSIB and other files customers can open from every proposal."
      footer={
        canManage ? (
          <>
            <SaveStatus error={status.error} message={status.message} />
            <Button
              variant="secondary"
              className="ml-auto"
              disabled={pending}
              onClick={() => fileInput.current?.click()}
            >
              {pending && uploading ? "Uploading…" : "Upload"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={FILE_TYPES.join(",")}
              hidden
              onChange={(event) => {
                upload(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </>
        ) : (
          <span>Only managers can change company documents.</span>
        )
      }
    >
      {documents.length ? (
        <ul className="-my-2 divide-y divide-[var(--color-border)]">
          {documents.map((document) => (
            <li key={document.id} className="flex min-h-10 items-center gap-3 py-1.5 text-[13px]">
              <a
                href={documentAssetUrl(document.path)}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-medium text-[var(--color-heading)] hover:underline"
              >
                {document.name}
              </a>
              {canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${document.name}`}
                  disabled={pending}
                  onClick={() => remove(document)}
                  className="w-7 px-0 hover:bg-[var(--tag-red-bg)] hover:text-[var(--tag-red-text)]"
                >
                  <TrashIcon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--color-muted)]">No documents yet.</p>
      )}
    </SettingsSection>
  );
}
