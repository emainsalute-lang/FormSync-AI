import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  try {
    const target = new URL(value || "/training", "https://formsync.invalid");
    if (target.origin === "https://formsync.invalid")
      return target.pathname + target.search + target.hash;
  } catch {
    return "/training";
  }
  return "/training";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/auth", request.url));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Supabase email verification failed", error);
    return NextResponse.redirect(
      new URL("/auth?error=verification_failed", request.url),
    );
  }
  const destination = new URL(
    safeNext(request.nextUrl.searchParams.get("next")),
    request.url,
  );
  const invite = request.nextUrl.searchParams.get("invite");
  if (invite) destination.searchParams.set("invite", invite);
  return NextResponse.redirect(destination);
}
