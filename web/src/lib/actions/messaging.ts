"use server";

import { headers } from "next/headers";
import { requireStaff } from "@/lib/auth";
import type { OutboundAttachment } from "@/lib/inbox-types";
import { createClient } from "@/lib/supabase/server";
import type {
  DealDrips,
  DripPreview,
  DripStage,
  DripTemplate,
  MessageChannel,
  MessagingSettings,
  PreviewRecord,
  ReviewSettings,
} from "@/lib/messaging-types";
import { staffRead, staffWrite, type ActionResult } from "./rpc";

export async function getDripSettings(pipeline: "sales" | "jobs"): Promise<DripStage[]> {
  return (await staffRead<DripStage[] | null>("get_drip_settings", { requested_pipeline: pipeline })) ?? [];
}

export async function getMessagingSettings(): Promise<MessagingSettings> {
  return staffRead("get_messaging_settings");
}

export async function saveDripStep(input: {
  id: string;
  stageId: string;
  delayMinutes: number;
  channel: MessageChannel;
  subject: string;
  body: string;
  enabled: boolean;
}) {
  return staffWrite(
    "save_drip_step",
    {
      requested_id: input.id,
      requested_stage: input.stageId,
      requested_delay_minutes: input.delayMinutes,
      requested_channel: input.channel,
      requested_subject: input.subject,
      requested_body: input.body,
      requested_enabled: input.enabled,
    },
    ["/drips"],
  );
}

export async function deleteDripStep(id: string) {
  return staffWrite("delete_drip_step", { requested_id: id }, ["/drips"]);
}

export async function setStageDrips(stageId: string, enabled: boolean) {
  return staffWrite("set_stage_drips", { requested_stage: stageId, requested_enabled: enabled }, ["/drips"]);
}

export async function saveReplyToEmail(replyToEmail: string) {
  return staffWrite("save_reply_to_email", { requested_reply_to_email: replyToEmail }, ["/settings"]);
}

/** Queues a one-off email or text; it shows on the deal's Communications tab, which reloads itself. */
export async function queueCustomerMessage(input: {
  recordId: string;
  channel: MessageChannel;
  subject: string;
  body: string;
  attachments: OutboundAttachment[];
}) {
  return staffWrite(
    "queue_customer_message",
    {
      requested_record: input.recordId,
      requested_channel: input.channel,
      requested_subject: input.subject,
      requested_body: input.body,
      requested_attachments: input.attachments,
    },
    [],
  );
}

/** From the unsubscribe link; the message id is the only credential. */
export async function optOutOfMessages(messageId: string): Promise<{ company?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("opt_out_of_messages", { requested_message: messageId });
  if (error) return { error: "Could not update your preferences. Try again." };
  if (!data) return { error: "This link is no longer valid." };
  return { company: data as string };
}

// Previews and test sends ----------------------------------------------------

/** This site's address, so previews and tests carry working links. */
async function siteUrl(): Promise<string | null> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host");
  return host ? `${list.get("x-forwarded-proto") ?? "https"}://${host}` : null;
}

export async function getDripPreviewRecords(pipeline: "sales" | "jobs"): Promise<PreviewRecord[]> {
  return (await staffRead<PreviewRecord[] | null>("get_drip_preview_records", { requested_pipeline: pipeline })) ?? [];
}

/** A step filled in for one deal, or for a sample customer when `recordId` is null. */
export async function previewDripMessage(input: {
  subject: string;
  body: string;
  recordId: string | null;
}): Promise<DripPreview | null> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_drip_message", {
    requested_subject: input.subject,
    requested_body: input.body,
    requested_record: input.recordId,
    requested_base_url: await siteUrl(),
  });
  return error ? null : (data as DripPreview);
}

/** Queues the step, filled for `recordId` (or the sample customer), to the signed-in person. */
export async function sendDripTest(input: {
  channel: MessageChannel;
  subject: string;
  body: string;
  recordId: string | null;
}): Promise<ActionResult & { address?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("send_drip_test", {
    requested_channel: input.channel,
    requested_subject: input.subject,
    requested_body: input.body,
    requested_record: input.recordId,
    requested_base_url: await siteUrl(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, address: data as string };
}

// Review requests and aftercare ----------------------------------------------

export async function getReviewSettings(): Promise<ReviewSettings> {
  return staffRead("get_review_settings");
}

export async function saveReviewSettings(input: ReviewSettings) {
  return staffWrite(
    "save_review_settings",
    {
      requested_link: input.reviewLink ?? "",
      requested_review_delay_days: input.reviewDelayDays,
      requested_aftercare_delay_days: input.aftercareDelayDays,
    },
    ["/settings", "/drips"],
  );
}

/** Adds a ready-made step to a completed jobs stage; the stage's drips switch is left alone. */
export async function addDripTemplate(stageId: string, template: DripTemplate) {
  return staffWrite("add_drip_template", { requested_stage: stageId, requested_template: template }, ["/drips"]);
}

// A deal's drips ---------------------------------------------------------------

export async function getDealDrips(recordId: string): Promise<DealDrips | null> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_deal_drips", { requested_record: recordId });
  return error ? null : (data as DealDrips);
}

/** Pausing cancels what is queued; resuming re-queues the stage's steps still ahead. */
export async function setDealDripsPaused(recordId: string, paused: boolean) {
  return staffWrite("set_deal_drips_paused", { requested_record: recordId, requested_paused: paused }, ["/pipeline"]);
}

export async function skipQueuedMessage(messageId: string) {
  return staffWrite("skip_queued_message", { requested_message: messageId }, []);
}
