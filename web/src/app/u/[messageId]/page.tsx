import type { Metadata } from "next";
import { getMessagePreferences } from "@/lib/actions/message-preferences";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Message preferences", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Linked from every automated email and text: the customer picks, per
 * channel, what the company may still send them. */
export default async function MessagePreferencesPage({ params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const preferences = await getMessagePreferences(decodeURIComponent(messageId)).catch(() => null);
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f4f6] px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
        {preferences ? (
          <>
            <h1 className="text-[18px] font-semibold text-[var(--color-heading)]">Message preferences</h1>
            <p className="mt-1 text-[13px] text-[var(--color-muted)]">Choose what {preferences.company} sends you.</p>
            <PreferencesForm messageId={decodeURIComponent(messageId)} preferences={preferences} />
          </>
        ) : (
          <>
            <h1 className="text-[18px] font-semibold text-[var(--color-heading)]">This link is no longer valid</h1>
            <p className="mt-1 text-[13px] text-[var(--color-muted)]">Reply to the message you received to change what you get.</p>
          </>
        )}
      </div>
    </main>
  );
}
