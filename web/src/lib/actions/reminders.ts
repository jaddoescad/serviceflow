"use server";

import { requireStaff } from "@/lib/auth";
import type { ReminderRule, ReminderTarget, ReminderTrigger } from "@/lib/reminder-types";
import type { AppointmentKind } from "@/lib/appointment-types";
import type { MessageChannel } from "@/lib/messaging-types";
import { createClient } from "@/lib/supabase/server";
import { staffWrite } from "./rpc";

// Pages whose booking dialogs offer a confirmation once a rule exists.
const PATHS = ["/drips", "/appointments", "/schedule"];

/** The company's confirmations first, then reminders furthest ahead first. */
export async function getReminderRules(): Promise<ReminderRule[]> {
  await requireStaff();
  const supabase = await createClient();
  // Managers of several companies read every one's rules; the web admin acts in its home company.
  const [home, rules] = await Promise.all([
    supabase.rpc("get_home_company"),
    supabase
      .from("reminder_rules")
      .select("id,org_id,target,appointment_kind,trigger,offset_minutes,channel,subject,body,is_enabled")
      .order("created_at"),
  ]);
  if (home.error) throw new Error(`get_home_company: ${home.error.message}`);
  if (rules.error) throw new Error(`reminder_rules: ${rules.error.message}`);
  const company = (home.data as { id: string } | null)?.id;
  return (rules.data ?? [])
    .filter((row) => row.org_id === company)
    .map((row) => ({
      id: row.id,
      target: row.target,
      appointmentKind: row.appointment_kind,
      trigger: row.trigger,
      offsetMinutes: row.offset_minutes,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      enabled: row.is_enabled,
    }))
    .sort((a, b) => (a.trigger === b.trigger ? b.offsetMinutes - a.offsetMinutes : a.trigger === "confirmation" ? -1 : 1));
}

export async function saveReminderRule(input: {
  id: string;
  target: ReminderTarget;
  appointmentKind: AppointmentKind | null;
  trigger: ReminderTrigger;
  offsetMinutes: number;
  channel: MessageChannel;
  subject: string;
  body: string;
  enabled: boolean;
}) {
  if (!input.body.trim()) return { ok: false, error: "Write a message to send." };
  if (input.channel === "email" && !input.subject.trim()) return { ok: false, error: "Add a subject." };
  return staffWrite(
    "save_reminder_rule",
    {
      requested_id: input.id,
      requested_target: input.target,
      requested_appointment_kind: input.appointmentKind,
      requested_trigger: input.trigger,
      requested_offset_minutes: input.offsetMinutes,
      requested_channel: input.channel,
      requested_subject: input.subject,
      requested_body: input.body,
      requested_enabled: input.enabled,
    },
    PATHS,
  );
}

export async function deleteReminderRule(id: string) {
  return staffWrite("delete_reminder_rule", { requested_id: id }, PATHS);
}
