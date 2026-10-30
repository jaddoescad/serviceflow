import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Unread inbox conversations in the signed-in manager's company, for the
 * sidebar badge. Server components only; 0 for crew or on any error, so it
 * never breaks the layout. */
export const getUnreadConversationCount = cache(async function getUnreadConversationCount(): Promise<number> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_unread_conversation_count");
    return error ? 0 : Number(data) || 0;
  } catch {
    return 0;
  }
});
