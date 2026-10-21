import { NextResponse } from "next/server"
import { getSupabaseServerClient } from "@/lib/supabase/server"

/** OAuth and email-link sign-in land here; the code is exchanged for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const requested = url.searchParams.get("next") ?? "/profile"
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/profile"
  const supabase = await getSupabaseServerClient()
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, url.origin))
  }
  const login = new URL("/login", url.origin)
  login.searchParams.set("error", "Sign-in link is invalid or has expired. Request a new one.")
  return NextResponse.redirect(login)
}
