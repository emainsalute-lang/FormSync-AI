import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  supabaseConfigured,
  supabasePublicConfig,
} from "./lib/supabase/config";

export async function proxy(request: NextRequest) {
  if (!supabaseConfigured()) return NextResponse.next();
  const { url, key } = supabasePublicConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) console.error("Supabase session verification failed", error);
  const pathname = request.nextUrl.pathname;
  const publicRoute =
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/api/share/") ||
    (pathname.startsWith("/api/calendar/") &&
      pathname !== "/api/calendar/feed") ||
    pathname === "/api/webhooks/stripe" ||
    pathname === "/api/health" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.svg" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icons/");
  if (!user && !publicRoute) {
    if (pathname.startsWith("/api/"))
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const login = request.nextUrl.clone();
    login.pathname = "/auth";
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  if (user && pathname === "/auth") {
    const next = request.nextUrl.searchParams.get("next");
    const invite = request.nextUrl.searchParams.get("invite");
    const fallback = invite
      ? `/training?invite=${encodeURIComponent(invite)}`
      : "/training";
    let safeDestination = fallback;
    try {
      const candidate = new URL(next || fallback, request.url);
      if (candidate.origin === request.nextUrl.origin)
        safeDestination =
          candidate.pathname + candidate.search + candidate.hash;
    } catch {}
    const destination = new URL(safeDestination, request.url);
    return NextResponse.redirect(destination);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
