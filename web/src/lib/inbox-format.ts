import { dayKey } from "./format";

const TZ = "America/Toronto";

/** "+16135550199" → "(613) 555-0199"; other numbers and addresses as given. */
export function fmtHandle(value: string | null | undefined): string {
  if (!value) return "Unknown sender";
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!value.includes("@") && local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return value;
}

/** Inbox list time: "2:14 PM" today, "Mon" this week, "Oct 21" before that. */
export function fmtListTime(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (dayKey(date) === dayKey(now)) {
    return date.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  }
  const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (ageDays < 6) return date.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
  return date.toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    ...(ageDays > 300 ? { year: "numeric" } : {}),
  });
}

/** Thread day divider: "Today", "Yesterday" or "Mon, Oct 21". */
export function fmtDayLabel(value: string, now = new Date()): string {
  const key = dayKey(value);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  const date = new Date(value);
  return date.toLocaleDateString("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(now.getTime() - date.getTime() > 300 * 86_400_000 ? { year: "numeric" } : {}),
  });
}

export function fmtClock(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

export function fmtBytes(size: number | null): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const LINK_PLACEHOLDERS: Record<string, string> = {
  proposal_link: "[proposal link]",
  document_link: "[document link]",
  portal_link: "[customer portal link]",
  review_link: "[review link]",
};

/** Stored messages keep link placeholders until they're sent; show them as readable labels. */
export function fmtMessageBody(body: string): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => LINK_PLACEHOLDERS[key] ?? match);
}
