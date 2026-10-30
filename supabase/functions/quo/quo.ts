// Shapes from Quo's API that the import reads.

export type QuoConversation = {
  id: string;
  name: string | null;
  participants: string[] | null;
  phoneNumberId: string | null;
};

export type QuoMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  from: string | null;
  to: string[] | null;
  text: string | null;
  media?: { url: string; type: string | null }[] | null;
  createdAt: string;
};

export type QuoCall = {
  id: string;
  direction: "incoming" | "outgoing";
  status: string | null;
  duration: number | null;
  answeredAt: string | null;
  createdAt: string;
};

export type ImportedMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  from: string | null;
  to: string | null;
  text: string;
  media: { url: string; type: string | null }[];
  createdAt: string;
};

/** The one other number in a conversation, or null for group texts. */
export function conversationPartner(conversation: QuoConversation, ownNumber: string): string | null {
  const others = (conversation.participants ?? []).filter((participant) => participant && participant !== ownNumber);
  return others.length === 1 ? others[0] : null;
}

/** What the import stores for one text: the customer's number on the other end. */
export function importableMessage(message: QuoMessage): ImportedMessage | null {
  if (!message?.id || !message.createdAt) return null;
  const media = (message.media ?? []).filter((item) => item?.url);
  if (!message.text?.trim() && !media.length) return null;
  return {
    id: message.id,
    direction: message.direction === "incoming" ? "incoming" : "outgoing",
    from: message.from ?? null,
    to: message.to?.[0] ?? null,
    text: message.text ?? "",
    media,
    createdAt: message.createdAt,
  };
}

export type ImportedCall = {
  id: string;
  direction: "incoming" | "outgoing";
  from: string;
  to: string;
  status: string | null;
  duration: number;
  answered: boolean;
  createdAt: string;
  voicemail?: { duration: number | null; transcript: string | null };
};

/** What the import stores for one call with `partner`. */
export function importableCall(call: QuoCall, ownNumber: string, partner: string): ImportedCall | null {
  if (!call?.id || !call.createdAt) return null;
  const incoming = call.direction === "incoming";
  return {
    id: call.id,
    direction: incoming ? "incoming" : "outgoing",
    from: incoming ? partner : ownNumber,
    to: incoming ? ownNumber : partner,
    status: call.status ?? null,
    duration: Math.max(0, Math.round(call.duration ?? 0)),
    answered: Boolean(call.answeredAt),
    createdAt: call.createdAt,
  };
}
