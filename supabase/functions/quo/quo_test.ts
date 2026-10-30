import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { conversationPartner, importableCall, importableMessage } from "./quo.ts";

const conversation = { id: "CN1", name: "Jane", participants: ["+16135550101"], phoneNumberId: "PN1" };

Deno.test("a one-to-one conversation's partner is the other number", () => {
  assertEquals(conversationPartner(conversation, "+16135550000"), "+16135550101");
  assertEquals(conversationPartner({ ...conversation, participants: ["+16135550000", "+16135550101"] }, "+16135550000"), "+16135550101");
});

Deno.test("group texts have no single partner", () => {
  assertEquals(conversationPartner({ ...conversation, participants: ["+16135550101", "+16135550102"] }, "+16135550000"), null);
  assertEquals(conversationPartner({ ...conversation, participants: null }, "+16135550000"), null);
});

Deno.test("texts keep the first recipient and their photos; empty ones are dropped", () => {
  assertEquals(
    importableMessage({
      id: "AC1",
      direction: "outgoing",
      from: "+16135550000",
      to: ["+16135550101"],
      text: "",
      media: [{ url: "https://example.com/a.jpg", type: "image/jpeg" }],
      createdAt: "2026-10-01T12:00:00.000Z",
    }),
    {
      id: "AC1",
      direction: "outgoing",
      from: "+16135550000",
      to: "+16135550101",
      text: "",
      media: [{ url: "https://example.com/a.jpg", type: "image/jpeg" }],
      createdAt: "2026-10-01T12:00:00.000Z",
    },
  );
  assertEquals(
    importableMessage({ id: "AC2", direction: "incoming", from: "+1", to: [], text: "  ", createdAt: "2026-10-01T12:00:00.000Z" }),
    null,
  );
});

Deno.test("a call is stored from the customer's side", () => {
  const call = {
    id: "AC5",
    direction: "incoming" as const,
    status: "completed",
    duration: 61.4,
    answeredAt: "2026-10-01T12:00:03.000Z",
    createdAt: "2026-10-01T12:00:00.000Z",
  };
  assertEquals(importableCall(call, "+16135550000", "+16135550101"), {
    id: "AC5",
    direction: "incoming",
    from: "+16135550101",
    to: "+16135550000",
    status: "completed",
    duration: 61,
    answered: true,
    createdAt: "2026-10-01T12:00:00.000Z",
  });
  assertEquals(importableCall({ ...call, direction: "outgoing", answeredAt: null }, "+16135550000", "+16135550101")?.answered, false);
});
