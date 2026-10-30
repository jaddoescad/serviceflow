import { callEdge } from "@/lib/actions/edge";

export const dynamic = "force-dynamic";

const CALL_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A Quo call's recording or voicemail for the thread's audio player. Quo's
 * links may not last, so each play asks the quo function (which checks the
 * caller manages the company) for a fresh one and sends the player there. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!CALL_ID.test(id)) return new Response("Not found", { status: 404 });
  try {
    const { url } = await callEdge<{ url: string | null }>("quo", { action: "call-audio", callId: id });
    if (!url?.startsWith("https://")) return new Response("Not found", { status: 404 });
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  } catch (reason) {
    return new Response(reason instanceof Error ? reason.message : "Could not reach Quo.", { status: 502 });
  }
}
