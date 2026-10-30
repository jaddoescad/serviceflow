"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { getUnreadConversationCount } from "@/lib/inbox";
import {
  INBOX_PAGE,
  type Inbox,
  type InboxFilter,
  type OutboundActivity,
  type OutboundAttachment,
  type OutboundFilter,
  type Thread,
  type ThreadAttachment,
  type ThreadMessage,
} from "@/lib/inbox-types";
import type { MessageChannel } from "@/lib/messaging-types";
import { createClient } from "@/lib/supabase/server";
import { staffRead, staffWrite } from "./rpc";

type StoredAttachment = ThreadAttachment & { path?: string | null };

/** Stored email attachments open through short-lived signed links. */
async function withAttachmentLinks(thread: Thread | null): Promise<Thread | null> {
  return thread ? { ...thread, messages: await messagesWithLinks(thread.messages) } : null;
}

async function messagesWithLinks(messages: ThreadMessage[]): Promise<ThreadMessage[]> {
  const paths = messages.flatMap((message) =>
    (message.attachments as StoredAttachment[]).flatMap((attachment) => (attachment.path ? [attachment.path] : [])),
  );
  const links = new Map<string, string>();
  if (paths.length) {
    const supabase = await createClient();
    const { data } = await supabase.storage.from("message-attachments").createSignedUrls(paths, 60 * 60);
    for (const item of data ?? []) if (item.path && item.signedUrl) links.set(item.path, item.signedUrl);
  }
  return messages.map((message) => ({
    ...message,
    attachments: (message.attachments as StoredAttachment[]).map(({ path, ...attachment }) => ({
      name: attachment.name ?? null,
      contentType: attachment.contentType ?? null,
      size: attachment.size ?? null,
      url: path ? links.get(path) ?? null : attachment.url ?? null,
    })),
  }));
}

export async function getInbox(filter: InboxFilter, search = "", limit = INBOX_PAGE): Promise<Inbox> {
  return staffRead<Inbox>("get_inbox", {
    requested_filter: filter,
    requested_search: search.trim() || null,
    requested_limit: limit,
  });
}

export async function getConversation(id: string): Promise<Thread | null> {
  return withAttachmentLinks(await staffRead<Thread | null>("get_conversation", { requested_conversation: id }));
}

/** The deal page's Communications tab loads the customer's thread itself. */
export async function getContactThread(contactId: string): Promise<{ thread?: Thread | null; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_contact_thread", { requested_contact: contactId });
  if (error) return { error: "Could not load messages." };
  return { thread: await withAttachmentLinks(data as Thread | null) };
}

/** The page of a thread before `before`: a conversation's, or a customer's on the deal page. */
export async function getEarlierMessages(input: {
  conversationId: string | null;
  contactId: string | null;
  before: string;
}): Promise<ThreadMessage[]> {
  const messages = await staffRead<ThreadMessage[] | null>("get_earlier_messages", {
    requested_conversation: input.conversationId,
    requested_contact: input.contactId,
    requested_before: input.before,
  });
  return messagesWithLinks(messages ?? []);
}

/** For the sidebar badge and the tab title, between page loads. */
export async function getUnreadInboxCount(): Promise<number> {
  return getUnreadConversationCount();
}

/** Moves an unknown number's conversation onto the customer just made from it; returns the conversation it now lives in. */
export async function linkConversationContact(conversationId: string, contactId: string) {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("link_conversation_contact", {
    requested_conversation: conversationId,
    requested_contact: contactId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inbox", "layout");
  return { ok: true, conversationId: data as string };
}

export async function markConversationRead(id: string, read: boolean) {
  return staffWrite("set_conversation_read", { requested_conversation: id, requested_read: read }, ["/inbox"]);
}

/** Queues a reply; it goes out within seconds. */
export async function replyToConversation(input: {
  conversationId: string;
  channel: MessageChannel;
  subject: string;
  body: string;
  attachments: OutboundAttachment[];
}) {
  return staffWrite(
    "reply_to_conversation",
    {
      requested_conversation: input.conversationId,
      requested_channel: input.channel,
      requested_subject: input.subject,
      requested_body: input.body,
      requested_attachments: input.attachments,
    },
    ["/inbox"],
  );
}

export async function getOutboundActivity(filter: OutboundFilter): Promise<OutboundActivity[]> {
  return (await staffRead<OutboundActivity[] | null>("get_outbound_activity", { requested_status: filter })) ?? [];
}
