"use client";

import { queueCustomerMessage } from "@/lib/actions/messaging";
import type { PipelineCard } from "@/lib/pipeline-types";
import { ProjectModal } from "../project-profile-panel";
import { Composer, ThreadMessages, ThreadScroller } from "./thread";
import { useContactThread } from "./use-contact-thread";

/** Texting (or emailing) a deal's customer from the pipeline: their latest
 * messages above the composer, without leaving the board. */
export function MessageCustomerDialog({
  card,
  onClose,
}: {
  card: Pick<PipelineCard, "id" | "name" | "contactId">;
  onClose: () => void;
}) {
  const { thread, error, reload } = useContactThread(card.contactId);
  const recent = thread?.messages.slice(-20) ?? [];
  return (
    <ProjectModal title={card.name} onClose={onClose}>
      <ThreadScroller scrollKey={recent[recent.length - 1]?.id} className="max-h-[50vh] px-5 py-4">
        {recent.length ? (
          <ThreadMessages messages={recent} />
        ) : (
          <p className="py-6 text-center text-[13px] text-[var(--color-muted)]">
            {error || (thread ? "No messages yet." : "Loading…")}
          </p>
        )}
      </ThreadScroller>
      {thread ? (
        <div className="border-t border-[var(--color-border)] px-5 py-4">
          <Composer
            thread={thread}
            send={(input) => queueCustomerMessage({ recordId: card.id, ...input })}
            onSent={() => void reload()}
          />
        </div>
      ) : null}
    </ProjectModal>
  );
}
