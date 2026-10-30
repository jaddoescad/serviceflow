import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emailAddress,
  findReplyToken,
  htmlToText,
  parseDeliveryEvent,
  parseInboundEmail,
  stripQuotedReply,
} from "./email.ts";

const token = "0123456789abcdef0123456789abcdef";

Deno.test("Postmark inbound JSON", () => {
  const email = parseInboundEmail({
    From: "Jane Doe <Jane@Example.com>",
    FromFull: { Email: "Jane@Example.com", Name: "Jane Doe" },
    ToFull: [{ Email: `reply+${token}@in.example.com`, Name: "" }],
    CcFull: [],
    Subject: "Re: Your estimate",
    TextBody: "Looks good!\n\nOn Mon, Oct 23, 2026 at 3:14 PM Brightline <hello@example.com> wrote:\n> Here is your estimate",
    StrippedTextReply: "Looks good!",
    HtmlBody: "<p>Looks good!</p>",
    Headers: [{ Name: "Message-ID", Value: "<abc@mail.example.com>" }],
    Date: "Fri, 23 Oct 2026 16:45:32 -04:00",
    Attachments: [{ Name: "wall.jpg", Content: "aGVsbG8=", ContentType: "image/jpeg", ContentLength: 5 }],
  });
  assertEquals(email?.from, "jane@example.com");
  assertEquals(findReplyToken(email!.recipients, "in.example.com"), token);
  assertEquals(email?.strippedText, "Looks good!");
  assertEquals(email?.messageId, "<abc@mail.example.com>");
  assertEquals(email?.receivedAt, "2026-10-23T20:45:32.000Z");
  assertEquals(email?.attachments, [
    { name: "wall.jpg", contentType: "image/jpeg", size: 5, inline: false, content: "aGVsbG8=" },
  ]);
});

Deno.test("Resend email.received events carry only metadata", () => {
  const email = parseInboundEmail({
    type: "email.received",
    data: { email_id: "re_1", from: "Jane <jane@example.com>", to: [`Reply+${token.toUpperCase()}@IN.example.com`], subject: "Re: Hi", message_id: "<m@x>" },
  });
  assertEquals(email?.resendEmailId, "re_1");
  assertEquals(findReplyToken(email!.recipients, "in.example.com"), token);
});

Deno.test("generic JSON and form fields", () => {
  const email = parseInboundEmail({ from: "jane@example.com", to: `office@example.com, reply+${token}@in.example.com`, subject: "Hi", text: "Hello" });
  assertEquals(email?.recipients, ["office@example.com", `reply+${token}@in.example.com`]);
  assertEquals(findReplyToken(email!.recipients, "other.example.com"), null);
  assertEquals(parseInboundEmail({ subject: "no sender" }), null);
});

Deno.test("delivery reports", () => {
  assertEquals(parseDeliveryEvent({ type: "email.bounced", data: { email_id: "re_2", bounce: { message: "Mailbox full" } } }), {
    providerId: "re_2",
    event: "bounced",
    detail: "Mailbox full",
  });
  assertEquals(parseDeliveryEvent({ type: "email.opened", data: { email_id: "re_2" } }), null);
});

Deno.test("addresses", () => {
  assertEquals(emailAddress('"Doe, Jane" <JANE@example.com>'), "jane@example.com");
  assertEquals(emailAddress("nobody"), null);
});

Deno.test("quoted replies are stripped", () => {
  assertEquals(stripQuotedReply("Sounds good, see you Tuesday.\n\nOn Mon, Oct 23, 2026 at 3:14 PM Brightline <\nhello@example.com> wrote:\n> Hi Jane"), "Sounds good, see you Tuesday.");
  assertEquals(stripQuotedReply("Oui, merci.\n\nLe lun. 23 oct. 2026, à 15 h 14, Brightline a écrit :\n> Bonjour"), "Oui, merci.");
  assertEquals(stripQuotedReply("Yes please\n\nSent from my iPhone"), "Yes please");
  assertEquals(stripQuotedReply("Thanks\r\n\r\nFrom: Brightline <hello@example.com>\r\nSent: Monday, October 23, 2026\r\nSubject: Estimate"), "Thanks");
  assertEquals(stripQuotedReply("Line one\n> quoted\n> more"), "Line one");
  assertEquals(stripQuotedReply("> only quoted"), "> only quoted");
});

Deno.test("HTML email to text", () => {
  assertEquals(
    htmlToText('<html><head><style>p{}</style></head><body><div>Hi &amp; thanks!<br>Tom</div><div class="gmail_quote">On Mon wrote: old</div></body></html>'),
    "Hi & thanks!\nTom",
  );
});
