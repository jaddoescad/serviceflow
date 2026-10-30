"use client";

import { useRef, useState, useTransition } from "react";
import { saveCompanyBranding } from "@/lib/actions/settings";
import { documentAssetUrl, removeDocumentAssets, uploadDocumentAsset } from "@/lib/document-assets";
import { Button, Input } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const DEFAULT_COLOR = "#2f6bff";

/** "#2F6BFF", "2f6bff" → "#2f6bff"; anything else is returned trimmed. */
function normalizeHex(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(trimmed) ? `#${trimmed}` : trimmed;
}

export function BrandingForm({
  orgId,
  logoPath,
  brandColor,
  canManage,
}: {
  orgId: string;
  logoPath: string | null;
  brandColor: string | null;
  canManage: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(brandColor ?? "");
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const [working, setWorking] = useState<"logo" | "color">("color");

  const hex = normalizeHex(color);
  const colorValid = hex === "" || /^#[0-9a-f]{6}$/.test(hex);
  const colorChanged = hex !== (brandColor ?? "");
  const disabled = !canManage || pending;

  /** Logo and colour are saved together, so each change sends the other's saved value. */
  async function save(next: { logoPath: string; brandColor: string }, message: string, after?: () => Promise<void>) {
    const result = await saveCompanyBranding(next);
    if (!result.ok) {
      setStatus({ error: result.error ?? "Could not save branding." });
      return false;
    }
    await after?.();
    setStatus({ message });
    return true;
  }

  function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setStatus({ error: "Choose a PNG, JPG, WebP or SVG image." });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setStatus({ error: "Choose a logo under 2 MB." });
      return;
    }
    setWorking("logo");
    startTransition(async () => {
      setStatus({});
      let path: string;
      try {
        path = await uploadDocumentAsset(orgId, file, file.name);
      } catch {
        setStatus({ error: "Could not upload the logo. Try again." });
        return;
      }
      const saved = await save({ logoPath: path, brandColor: brandColor ?? "" }, "Logo saved.", async () => {
        if (logoPath) await removeDocumentAssets([logoPath]);
      });
      if (!saved) await removeDocumentAssets([path]);
    });
  }

  function removeLogo() {
    if (!logoPath) return;
    setWorking("logo");
    startTransition(async () => {
      setStatus({});
      await save({ logoPath: "", brandColor: brandColor ?? "" }, "Logo removed.", () =>
        removeDocumentAssets([logoPath]),
      );
    });
  }

  function saveColor() {
    setWorking("color");
    startTransition(async () => {
      setStatus({});
      await save({ logoPath: logoPath ?? "", brandColor: hex }, "Colour saved.");
    });
  }

  return (
    <SettingsSection
      id="branding"
      title="Branding"
      description="Your logo and colour on the proposals, change orders and invoices customers open."
      footer={
        canManage ? (
          <>
            <SaveStatus error={status.error} message={status.message} />
            <Button className="ml-auto" onClick={saveColor} disabled={pending || !colorChanged || !colorValid}>
              {pending && working === "color" ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <span>Only managers can change branding.</span>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Logo</span>
          <div className="flex flex-wrap items-center gap-2">
            {logoPath ? (
              <span className="flex h-12 w-28 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5">
                <img src={documentAssetUrl(logoPath)} alt="Company logo" className="max-h-full max-w-full object-contain" />
              </span>
            ) : null}
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => fileInput.current?.click()}>
              {pending && working === "logo" ? "Saving…" : logoPath ? "Replace" : "Upload logo"}
            </Button>
            {logoPath ? (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={removeLogo}>
                Remove
              </Button>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept={LOGO_TYPES.join(",")}
              hidden
              onChange={(event) => {
                uploadLogo(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Brand colour</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick brand colour"
              value={colorValid ? hex || DEFAULT_COLOR : (brandColor ?? DEFAULT_COLOR)}
              disabled={disabled}
              onChange={(event) => {
                setColor(event.target.value);
                setStatus({});
              }}
              className="h-8 w-10 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0"
            />
            <Input
              aria-label="Brand colour hex"
              value={color}
              maxLength={7}
              placeholder={DEFAULT_COLOR}
              disabled={disabled}
              aria-invalid={!colorValid}
              onChange={(event) => {
                setColor(event.target.value);
                setStatus({});
              }}
              className="w-28 tabular-nums"
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
