import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CALENDAR_SCOPE, googleCredentials, readState, redirectUri, setState, settingsUrl } from "../oauth";

type TokenResponse = { refresh_token?: string; scope?: string; id_token?: string };

/** The email Google signed into; the token came straight from Google over TLS. */
function emailFromIdToken(idToken: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken?.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

async function exchangeCode(request: NextRequest, code: string): Promise<TokenResponse | null> {
  const credentials = googleCredentials();
  if (!credentials) return null;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectUri(request),
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as TokenResponse) : null;
  } catch {
    return null;
  }
}

/** Google returns here after the person allows (or refuses) calendar access. */
export async function GET(request: NextRequest) {
  await requireStaff();
  const params = request.nextUrl.searchParams;
  const expected = readState(request);
  const code = params.get("code");

  async function connect(): Promise<boolean> {
    if (!expected || params.get("state") !== expected || !code) return false;
    const tokens = await exchangeCode(request, code);
    // Without the calendar permission (it can be unticked) sync would fail.
    if (!tokens?.refresh_token || !tokens.scope?.split(" ").includes(CALENDAR_SCOPE)) return false;
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_my_calendar_connection", {
      requested_refresh_token: tokens.refresh_token,
      requested_google_email: emailFromIdToken(tokens.id_token),
    });
    return !error;
  }

  const response = NextResponse.redirect(settingsUrl(request, (await connect()) ? "connected" : "error"));
  setState(request, response, null);
  return response;
}
