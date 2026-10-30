import type { MessagingSettings } from "@/lib/messaging-types";
import { EmailSettingsFields } from "./messaging-settings-fields";
import { QuoSection } from "./quo-section";

/** Texting (Quo) and email settings. Email replies reach the Inbox when
 * INBOUND_EMAIL_DOMAIN is set, here and where send-messages runs. */
export function MessagingSettingsForm({ settings }: { settings: MessagingSettings }) {
  return (
    <>
      <QuoSection settings={settings} />
      <EmailSettingsFields settings={settings} inboundEmailDomain={process.env.INBOUND_EMAIL_DOMAIN?.trim() || null} />
    </>
  );
}
