"use client";

import { useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ContactDetail } from "@/lib/contacts";

const CustomerForm = dynamic(() =>
  import("./create-contact-form").then((module) => module.CreateContactModal),
);

export function CustomerActions({
  customer,
}: {
  customer: Pick<ContactDetail, "id" | "name" | "email" | "phone" | "address">;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Customer menu"
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition({
            top: bounds.bottom + 4,
            left: Math.max(8, bounds.right - 192),
          });
        }}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl"
      >
        ···
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        style={position}
        onToggle={(event) => {
          if (event.newState === "open")
            menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }}
        className="fixed m-0 w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg"
      >
        <button
          type="button"
          onClick={() => {
            menu.current?.hidePopover();
            setEditing(true);
          }}
          className="w-full rounded px-4 py-2 text-left hover:bg-slate-100"
        >
          Edit Customer
        </button>
      </div>
      {editing && (
        <CustomerForm
          customer={customer}
          initiallyOpen
          hideTrigger
          onClosed={() => {
            setEditing(false);
            trigger.current?.focus();
          }}
        />
      )}
    </>
  );
}
