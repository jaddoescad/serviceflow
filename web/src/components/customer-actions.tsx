"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ContactDetail } from "@/lib/contacts";
import { Button } from "./ui";

const CustomerForm = dynamic(() =>
  import("./create-contact-form").then((module) => module.CreateContactModal),
);

/** The customer page's Edit button; opens the customer form. */
export function CustomerActions({
  customer,
}: {
  customer: Pick<ContactDetail, "id" | "name" | "email" | "phone" | "address">;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Button ref={trigger} type="button" variant="secondary" onClick={() => setEditing(true)}>
        Edit
      </Button>
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
