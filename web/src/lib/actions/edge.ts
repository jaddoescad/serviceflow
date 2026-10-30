import { getSessionToken } from "@/lib/auth";

const FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ||
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;

/**
 * Calls a Supabase edge function with the signed-in admin/manager's JWT. The
 * function (admin-time-entries / project-assignments / quo / booking) re-verifies the
 * caller's role server-side before doing anything.
 */
export async function callEdge<T = unknown>(
  fn: "admin-time-entries" | "project-assignments" | "quo" | "booking",
  body: Record<string, unknown>,
): Promise<T> {
  const token = await getSessionToken();
  if (!token) throw new Error("Not signed in");

  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(json?.error || `${fn} failed (${res.status})`);
  return json as T;
}
