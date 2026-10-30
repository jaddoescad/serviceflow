import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Shared by the server action modules. Not a "use server" file, so nothing
// here is callable from the browser on its own.

export type ActionResult = { ok: boolean; error?: string };

function revalidate(paths: string[]) {
  for (const path of paths) revalidatePath(path, "layout");
}

async function write(fn: string, args: Record<string, unknown>, paths: string[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  revalidate(paths);
  return { ok: true };
}

/** Runs a staff-only RPC and refreshes `paths` on success. */
export async function staffWrite(fn: string, args: Record<string, unknown>, paths: string[]): Promise<ActionResult> {
  await requireStaff();
  return write(fn, args, paths);
}

/** A customer's action from a private link or public form; the token or slug is the only credential. */
export async function publicWrite(fn: string, args: Record<string, unknown>, paths: string[] = []): Promise<ActionResult> {
  return write(fn, args, paths);
}

/** Staff-only read. Failures throw to the route's error boundary. */
export async function staffRead<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
