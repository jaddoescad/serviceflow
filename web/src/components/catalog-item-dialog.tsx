"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCatalogItem, saveCatalogItem } from "@/lib/actions/proposals";
import { centsFromDollars, type CatalogItem } from "@/lib/line-items";
import { DialogFooter } from "./document-dialogs";
import { ProjectModal } from "./project-profile-panel";
import { Button, Field, Input, Textarea } from "./ui";

/** Adds or edits a product or service; documents keep their own copy of its name, description and price. */
export function CatalogItemDialog({ item, closeHref }: { item: CatalogItem | null; closeHref: string }) {
  const router = useRouter();
  const [id] = useState(() => item?.id ?? crypto.randomUUID());
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? (item.unitPriceCents / 100).toFixed(2) : "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const close = () => router.replace(closeHref, { scroll: false });

  function run(action: () => Promise<{ ok: boolean; error?: string }>, fallback: string) {
    startTransition(async () => {
      setError("");
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? fallback);
        return;
      }
      close();
    });
  }

  return (
    <ProjectModal title={item ? "Edit item" : "New item"} onClose={() => !pending && close()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => saveCatalogItem({ id, name, description, unitPriceCents: centsFromDollars(price) }),
            "Could not save.",
          );
        }}
      >
        <div className="space-y-4 p-5">
          <Field label="Name">
            <Input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Description">
            <Textarea
              rows={4}
              maxLength={4000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Price">
            <Input
              inputMode="decimal"
              placeholder="0.00"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="w-40"
            />
          </Field>
          {error ? (
            <p role="alert" className="text-[13px] text-[var(--color-bad)]">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          {item ? (
            <Button
              type="button"
              variant="danger"
              className="mr-auto"
              disabled={pending}
              onClick={() => run(() => deleteCatalogItem(item.id), "Could not delete.")}
            >
              Delete
            </Button>
          ) : null}
          <Button type="button" variant="subtle" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </ProjectModal>
  );
}
