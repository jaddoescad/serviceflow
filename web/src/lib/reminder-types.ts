import type { AppointmentKind } from "./appointment-types";
import type { MessageChannel } from "./messaging-types";

export type ReminderTarget = "appointment" | "job";
export type ReminderTrigger = "confirmation" | "reminder";

/** A confirmation (on booking) or reminder (before the start) for appointments or job dates. */
export type ReminderRule = {
  id: string;
  target: ReminderTarget;
  /** Appointments only; null means every type. */
  appointmentKind: AppointmentKind | null;
  trigger: ReminderTrigger;
  /** Reminders go out this long before the start. */
  offsetMinutes: number;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  enabled: boolean;
};

/** Where confirmations and reminders are set up. */
export const REMINDERS_HREF = "/drips?view=reminders";

/** Whether booking `target` (of appointment type `kind`) can send the customer a confirmation. */
export const sendsConfirmation = (rules: ReminderRule[], target: ReminderTarget, kind?: AppointmentKind) =>
  rules.some(
    (rule) =>
      rule.enabled &&
      rule.trigger === "confirmation" &&
      rule.target === target &&
      (rule.appointmentKind === null || rule.appointmentKind === kind),
  );
