/** One row from get_my_notifications. `kind` stays open: other features add
 * their own (message_received, appointment_request, payment) and unknown kinds show a plain bell. */
export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  recordId: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationKind =
  | "proposal_viewed"
  | "proposal_accepted"
  | "proposal_declined"
  | "change_order_accepted"
  | "change_order_declined"
  | "invoice_viewed"
  | "invoice_paid"
  | "payment"
  | "new_lead"
  | "appointment_request"
  | "message_received";
