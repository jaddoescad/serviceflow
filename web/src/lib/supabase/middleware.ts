import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = ["/login", "/auth"];

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  let userId: string | null = null;
  let staleSession = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) throw error;
    userId = data?.claims.sub ?? null;
  } catch (error) {
    const authError = error as { code?: string; status?: number };
    if (
      authError.code !== "over_request_rate_limit" &&
      authError.status !== 429
    ) {
      // A revoked or expired session (e.g. refresh_token_not_found) means
      // signed out, not a server error: drop its cookies and send to login.
      if (!(error as { __isAuthError?: boolean }).__isAuthError) throw error;
      staleSession = true;
    } else {
      // Older sessions can still carry a symmetric JWT after a project moves to
      // asymmetric signing. Refresh once so subsequent getClaims calls validate
      // locally with the project's cached ES256 JWKS instead of hitting Auth.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) {
        const { data, error: claimsError } = await supabase.auth.getClaims();
        if (!claimsError) userId = data?.claims.sub ?? null;
      }
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "Supabase Auth rate-limit recovery",
          path,
          recovered: Boolean(userId),
        }),
      );
    }
  }

  const isAuthenticated = Boolean(userId);

  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!isAuthenticated && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    const redirectResponse = NextResponse.redirect(url);
    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
    if (staleSession) clearAuthCookies(request, redirectResponse);
    return redirectResponse;
  }
  if (staleSession) clearAuthCookies(request, response);

  const sharedPage =
    path === "/" ||
    /^\/(projects(?:\/.*)?|photos|labels|contacts(?:\/.*)?|employees|jobs\/[0-9a-f-]+)$/.test(
      path,
    );
  if (
    isAuthenticated &&
    !isPublic &&
    !path.startsWith("/api/") &&
    path !== "/not-authorized" &&
    !sharedPage
  ) {
    const { data: profile } = await supabase
      .from("employees")
      .select("role,is_active")
      .eq("id", userId!)
      .maybeSingle();
    if (!profile?.is_active || !["admin", "manager"].includes(profile.role)) {
      const url = request.nextUrl.clone();
      url.pathname = "/not-authorized";
      const denied = NextResponse.redirect(url);
      response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
      return denied;
    }
  }
  return response;
}

/** Expire the Supabase session cookies (`sb-*-auth-token`, including chunks). */
function clearAuthCookies(request: NextRequest, response: NextResponse) {
  for (const { name } of request.cookies.getAll()) {
    if (name.startsWith("sb-") && name.includes("-auth-token")) {
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
  }
}
