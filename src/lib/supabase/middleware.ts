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
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error) throw error;
    userId = data?.claims.sub ?? null;
  } catch (error) {
    const authError = error as { code?: string; status?: number };
    if (authError.code !== "over_request_rate_limit" && authError.status !== 429) {
      throw error;
    }

    // Older sessions can still carry a symmetric JWT after a project moves to
    // asymmetric signing. Refresh once so subsequent getClaims calls validate
    // locally with the project's cached ES256 JWKS instead of hitting Auth.
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError) {
      const { data, error: claimsError } = await supabase.auth.getClaims();
      if (!claimsError) userId = data?.claims.sub ?? null;
    }
    console.warn(JSON.stringify({
      level: "warn",
      message: "Supabase Auth rate-limit recovery",
      path,
      recovered: Boolean(userId),
    }));
  }

  const isAuthenticated = Boolean(userId);

  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!isAuthenticated && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return response;
}
