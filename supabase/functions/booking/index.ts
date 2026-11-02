import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { addDays, isDay, wall } from "../_shared/zoned.ts";
import { addressKey, type Booked, type Candidate, type Context, openTimes, openWindows, type Preference } from "./slots.ts";

// Suggested times for the appointment dialog. A manager (Bearer JWT) sends
//   {"address", "minutes", "userId"?, "appointmentId"?, "days"?: ["2026-11-03"],
//    "window"?: "any" | "morning" | "afternoon"}
// with the days and part of the day the customer asked for, the person (or
// anyone who takes appointments) and the visit being moved. Open times are
// each person's hours minus their appointments, Google busy times, the break
// between visits and the drive to and from each one. The reply groups them
// into each person's free stretches, ranked against the request (see
// openWindows). Drive times and distances come from Google's Routes API
// (GOOGLE_MAPS_API_KEY) and are cached; without it, the company's fallback
// drive time. Deploy with --no-verify-jwt.

type BookingContext = Context & { travelMinutes: number; appointments: Booked[] };

type Distances = (from: string | null, to: string | null) => { minutes: number; meters: number | null };

const SEARCH_DAYS = 21;
const MAX_WINDOWS = 24;
const MAX_DESTINATIONS = 100;
const ROUTES = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "Missing booking environment" }, 500);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const user = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: org, error: orgError } = await user.rpc("booking_staff_org");
  if (orgError || typeof org !== "string") return json({ error: orgError?.message ?? "Not allowed" }, 403);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Send JSON." }, 400);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    return json(await suggest(admin, org, body));
  } catch (reason) {
    console.error(JSON.stringify({ message: "suggest failed", error: String(reason) }));
    return json({ error: "Times couldn't load. Try again." }, 500);
  }
});

async function suggest(admin: SupabaseClient, org: string, body: Record<string, unknown>) {
  const address = text(body.address, 300);
  const minutes = typeof body.minutes === "number" && body.minutes >= 15 && body.minutes <= 480 ? Math.round(body.minutes) : 60;
  const userId = typeof body.userId === "string" && UUID.test(body.userId) ? body.userId : null;
  const exclude = typeof body.appointmentId === "string" && UUID.test(body.appointmentId) ? body.appointmentId : null;
  const window = body.window === "morning" || body.window === "afternoon" ? body.window : "any";
  const asked = Array.isArray(body.days) ? [...new Set(body.days.filter(isDay))].sort().slice(0, 14) : [];

  // Read a month from yesterday (UTC); the company's own today is within it.
  const utcToday = new Date().toISOString().slice(0, 10);
  const context = await rpc<BookingContext>(admin, "booking_context", {
    requested_org: org,
    requested_from: `${addDays(utcToday, -2)}T00:00:00Z`,
    requested_to: `${addDays([utcToday, ...asked].sort().at(-1)!, SEARCH_DAYS + 2)}T00:00:00Z`,
    requested_user: userId,
    requested_exclude: exclude,
  });
  const zone = context.timezone;
  const today = wall(Date.now(), zone).day;
  const days = asked.filter((day) => day >= today);
  const preference: Preference = { days, window };
  // From a few days before the first asked-for day to a week past the last.
  const from = days.length ? [addDays(days[0], -3), today].sort().at(-1)! : today;
  const to = [addDays(from, SEARCH_DAYS - 1), days.length ? addDays(days.at(-1)!, 7) : addDays(today, 13)].sort()[0];

  const reply = {
    timezone: zone,
    minutes,
    windows: [] as Record<string, unknown>[],
    // Read by the site deployed before free stretches; remove once the new panel is live.
    best: [] as Record<string, unknown>[],
    other: [] as Record<string, unknown>[],
    driveTimes: Boolean(Deno.env.get("GOOGLE_MAPS_API_KEY")),
    fallbackDriveMinutes: context.travelMinutes,
  };
  if (!context.people.length) return { ...reply, reason: "no_hours" };

  const distances = await travelTimes(admin, address, context.appointments.map((item) => item.location), context.travelMinutes);
  const travel = (a: string | null, b: string | null) => distances(a, b).minutes;
  const open = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    open.push({ day, times: openTimes(context, day, minutes, address, Date.now(), travel) });
  }
  const windows = openWindows(open, preference, zone, context.travelMinutes).slice(0, MAX_WINDOWS);
  const names = new Map(context.people.map((person) => [person.id, person.name]));
  const iso = (ms: number) => new Date(ms).toISOString();
  // The visit just before the stretch and the one just after it, that day.
  const visit = (location: string | null, drive: number | null) =>
    location !== null && drive !== null ? { address: location, minutes: drive, meters: distances(address, location).meters } : null;
  const described = windows.map((window) => {
    const first = window.starts[0];
    const last = window.starts.at(-1)!;
    return {
      date: window.day,
      userId: window.userId,
      name: names.get(window.userId) ?? null,
      start: iso(first.start),
      end: iso(last.end),
      starts: window.starts.map((candidate) => iso(candidate.start)),
      suggested: iso(window.suggested.start),
      matchesDay: window.matchesDay,
      matchesTime: window.matchesTime,
      daysAway: window.daysAway,
      before: visit(first.beforeLocation, first.driveBefore),
      after: visit(last.afterLocation, last.driveAfter),
    };
  });
  // The old panel's rows: each stretch's suggested start.
  const legacy = windows.map((window, index) => {
    const pick: Candidate = window.suggested;
    const near = described[index].before ?? described[index].after;
    return {
      start: iso(pick.start),
      end: iso(pick.end),
      date: window.day,
      userId: window.userId,
      name: names.get(window.userId) ?? null,
      matchesDay: window.matchesDay,
      matchesTime: window.matchesTime,
      daysAway: window.daysAway,
      nearby: near ? { ...near, side: described[index].before ? "before" : "after" } : null,
    };
  });
  return { ...reply, windows: described, best: legacy };
}

/**
 * Drive minutes and metres between `address` and the appointments'
 * addresses: cached, else from Google, else the company's fallback minutes.
 * Same address: no drive. Driving is taken to be the same both ways.
 */
async function travelTimes(
  admin: SupabaseClient,
  address: string | null,
  locations: (string | null)[],
  fallback: number,
): Promise<Distances> {
  const known = new Map<string, { seconds: number; meters: number | null }>();
  const pair = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
  const origin = address ? addressKey(address) : null;
  const others = new Map<string, string>();
  for (const location of locations) {
    if (location && addressKey(location) !== origin) others.set(addressKey(location), location);
  }

  if (address && origin && others.size) {
    const keys = [...others.keys()].slice(0, MAX_DESTINATIONS);
    const cached = await rpc<{ from: string; to: string; seconds: number; meters: number | null }[]>(
      admin,
      "cached_travel_times",
      { requested_pairs: keys.flatMap((key) => [{ from_key: origin, to_key: key }, { from_key: key, to_key: origin }]) },
    );
    for (const row of cached) known.set(pair(row.from, row.to), { seconds: row.seconds, meters: row.meters });
    const missing = keys.filter((key) => !known.has(pair(origin, key)));
    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (missing.length && apiKey) {
      const fetched = await routeMatrix(apiKey, address, missing.map((key) => others.get(key)!));
      const rows = missing.flatMap((key) => {
        const route = fetched.get(others.get(key)!);
        if (!route) return [];
        known.set(pair(origin, key), route);
        return [{ from_key: origin, to_key: key, seconds: route.seconds, meters: route.meters }];
      });
      if (rows.length) await rpc(admin, "save_travel_times", { requested_rows: rows });
    }
  }

  return (from, to) => {
    if (!from || !to) return { minutes: fallback, meters: null };
    const a = addressKey(from);
    const b = addressKey(to);
    if (a === b) return { minutes: 0, meters: 0 };
    const route = known.get(pair(a, b));
    return route ? { minutes: Math.ceil(route.seconds / 60), meters: route.meters } : { minutes: fallback, meters: null };
  };
}

/** The drive from `origin` to each destination Google found a route to. */
async function routeMatrix(
  apiKey: string,
  origin: string,
  destinations: string[],
): Promise<Map<string, { seconds: number; meters: number | null }>> {
  const result = new Map<string, { seconds: number; meters: number | null }>();
  // Google takes at most 50 addresses per request.
  for (let index = 0; index < destinations.length; index += 49) {
    const chunk = destinations.slice(index, index + 49);
    try {
      const response = await fetch(ROUTES, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "destinationIndex,duration,distanceMeters,condition",
        },
        body: JSON.stringify({
          origins: [{ waypoint: { address: origin } }],
          destinations: chunk.map((address) => ({ waypoint: { address } })),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        console.error(JSON.stringify({ message: "routes failed", status: response.status, body: await response.text() }));
        break;
      }
      const elements = (await response.json()) as {
        destinationIndex?: number;
        duration?: string;
        distanceMeters?: number;
        condition?: string;
      }[];
      for (const element of elements) {
        const seconds = Number.parseInt(element.duration ?? "", 10);
        // Google leaves out a zero index.
        const destination = chunk[element.destinationIndex ?? 0];
        if (element.condition === "ROUTE_EXISTS" && Number.isFinite(seconds) && destination) {
          result.set(destination, { seconds, meters: element.distanceMeters ?? null });
        }
      }
    } catch (reason) {
      console.error(JSON.stringify({ message: "routes failed", error: String(reason) }));
      break;
    }
  }
  return result;
}

async function rpc<T = unknown>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
