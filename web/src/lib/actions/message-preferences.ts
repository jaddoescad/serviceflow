"use server";

import type { MessagePreferences, PreferenceChoice } from "@/lib/inbox-types";
import { createClient } from "@/lib/supabase/server";

// From the link at the bottom of a customer's email or text; the message id
// is the only credential.

const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function getMessagePreferences(messageId: string): Promise<MessagePreferences | null> {
  if (!isId(messageId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_message_preferences", { requested_message: messageId });
  if (error) throw new Error(`get_message_preferences: ${error.message}`);
  return (data as MessagePreferences | null) ?? null;
}

export async function saveMessagePreferences(
  messageId: string,
  preferences: { email?: PreferenceChoice; sms?: PreferenceChoice },
): Promise<{ company?: string; error?: string }> {
  if (!isId(messageId)) return { error: "This link is no longer valid." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_message_preferences", {
    requested_message: messageId,
    requested_preferences: preferences,
  });
  if (error) return { error: "Could not update your preferences. Try again." };
  if (!data) return { error: "This link is no longer valid." };
  return { company: data as string };
}
