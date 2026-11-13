import type { NextRequest, NextResponse } from "next/server";
import { settingsHref } from "@/lib/settings-pages";

// Shared by the connect and callback routes. Each person connects their own
// Google Calendar; the refresh token is stored by save_my_calendar_connection
// and the calendar-sync function uses it to push events.

// Events on calendars the person owns: enough to add ServiceFlow's events to
// their primary calendar and read its busy times, without access to calendars
// shared with them.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";

const STATE_COOKIE = "sf_google_calendar_state";
// Where to land afterwards when connecting from somewhere other than Settings.
const RETURN_COOKIE = "sf_google_calendar_return";
const COOKIE_PATH = "/api/google-calendar";

export function googleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Must match on the authorization request and the code exchange. */
export function redirectUri(request: NextRequest): string {
  return `${request.nextUrl.origin}/api/google-calendar/callback`;
}

/** Back to the Google Calendar section of Settings (or Appointment workflows' settings) with the outcome. */
export function settingsUrl(request: NextRequest, outcome: "connected" | "error"): URL {
  if (request.cookies.get(RETURN_COOKIE)?.value === "workflows") {
    return new URL(`/workflows?tab=settings&calendar=${outcome}`, request.nextUrl.origin);
  }
  const [path, hash] = settingsHref("calendar").split("#");
  return new URL(`${path}?calendar=${outcome}#${hash}`, request.nextUrl.origin);
}

export function readState(request: NextRequest): string | undefined {
  return request.cookies.get(STATE_COOKIE)?.value;
}

/** The OAuth state, and where to return (null clears both). */
export function setState(request: NextRequest, response: NextResponse, state: string | null, back: "workflows" | null = null) {
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: COOKIE_PATH,
  };
  response.cookies.set(STATE_COOKIE, state ?? "", { ...options, maxAge: state ? 600 : 0 });
  response.cookies.set(RETURN_COOKIE, state && back ? back : "", { ...options, maxAge: state && back ? 600 : 0 });
}
