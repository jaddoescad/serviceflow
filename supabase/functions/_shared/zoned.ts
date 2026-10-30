// Wall-clock days and times in a company's time zone, whatever zone the
// function runs in. Days are "YYYY-MM-DD"; times are minutes after midnight.

const formats = new Map<string, Intl.DateTimeFormat>();

function format(timeZone: string): Intl.DateTimeFormat {
  let found = formats.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formats.set(timeZone, found);
  }
  return found;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The wall clock of an instant: its day and minutes after midnight. */
export function wall(ms: number, timeZone: string): { day: string; minutes: number } {
  const parts: Record<string, number> = {};
  for (const part of format(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { day: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, minutes: (parts.hour % 24) * 60 + parts.minute };
}

/** The instant a wall-clock day and minute fall on (24:00 is the next midnight). */
export function instant(day: string, minutes: number, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year, month - 1, date, 0, minutes);
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = wall(guess, timeZone);
    const [y, m, d] = shown.day.split("-").map(Number);
    guess += target - Date.UTC(y, m - 1, d, 0, shown.minutes);
  }
  return guess;
}

export function addDays(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}

/** 0 is Sunday. */
export function weekday(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

export const isDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
