const OTTAWA_TZ = "America/Toronto";

export function fmtHours(hours: number): string {
  if (!Number.isFinite(hours)) return "0h";
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  if (whole === 0) return `${mins}m`;
  if (mins === 0) return `${whole}h`;
  return `${whole}h ${mins}m`;
}

export function fmtHoursDecimal(hours: number): string {
  if (!Number.isFinite(hours)) return "0.0";
  return hours.toFixed(1);
}

export function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function fmtCurrencyTotals(
  totals: Partial<Record<"CAD" | "USD", number>>,
): string {
  const parts = (["CAD", "USD"] as const)
    .filter((currency) => Number(totals[currency] ?? 0) !== 0)
    .map((currency) =>
      new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(totals[currency])),
    );
  return parts.length ? parts.join(" + ") : "—";
}

export function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-CA", {
    timeZone: OTTAWA_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-CA", {
    timeZone: OTTAWA_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value,
  );
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-CA", {
    timeZone: OTTAWA_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function fmtRelativeTime(value: string | null, now = Date.now()): string {
  if (!value) return "unknown";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const ageMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Local (Ottawa) day key YYYY-MM-DD for grouping entries by day. */
export function dayKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "unknown";
  // en-CA formats as YYYY-MM-DD in the target timezone.
  return d.toLocaleDateString("en-CA", { timeZone: OTTAWA_TZ });
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
