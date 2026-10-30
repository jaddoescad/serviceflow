import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth";
import { CALENDAR_SCOPE, googleCredentials, redirectUri, setState, settingsUrl } from "../oauth";

/** Sends the signed-in person to Google to let ServiceFlow manage their calendar events. */
export async function GET(request: NextRequest) {
  await requireStaff();
  const credentials = googleCredentials();
  if (!credentials) return NextResponse.redirect(settingsUrl(request, "error"));

  const state = randomBytes(32).toString("base64url");
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: `openid email ${CALENDAR_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();

  const response = NextResponse.redirect(google);
  setState(request, response, state);
  return response;
}
