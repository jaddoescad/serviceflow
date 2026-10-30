import type { NextRequest, NextResponse } from "next/server";

// Shared by the connect and callback routes. Each person connects their own
// Google Calendar; the refresh token is stored by save_my_calendar_connection
// and the calendar-sync function uses it to push events.

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const STATE_COOKIE = "sf_google_calendar_state";
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

/** Back to the Google Calendar section of Settings with the outcome. */
export function settingsUrl(request: NextRequest, outcome: "connected" | "error"): URL {
  return new URL(`/settings?calendar=${outcome}#calendar`, request.nextUrl.origin);
}

export function readState(request: NextRequest): string | undefined {
  return request.cookies.get(STATE_COOKIE)?.value;
}

export function setState(request: NextRequest, response: NextResponse, state: string | null) {
  response.cookies.set(STATE_COOKIE, state ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: COOKIE_PATH,
    maxAge: state ? 600 : 0,
  });
}
