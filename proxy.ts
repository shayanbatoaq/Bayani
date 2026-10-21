import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const protectedPrefixes = [
  "/dashboard",
  "/profile",
  "/regulatory",
  "/data-input",
  "/reports",
  "/vat",
  "/corporate-tax",
  "/audit",
  "/valuation",
  "/final-report",
  "/admin",
]

export function proxy(request: NextRequest) {
  const authConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  if (!authConfigured) {
    return NextResponse.next()
  }

  const pathname = request.nextUrl.pathname
  const protectedRoute = protectedPrefixes.some((prefix) => pathname.startsWith(prefix))

  if (!protectedRoute) {
    return NextResponse.next()
  }

  const hasSupabaseSession = request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith("sb-") || cookie.name.includes("supabase"))

  if (!hasSupabaseSession) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/profile/:path*",
    "/regulatory/:path*",
    "/data-input/:path*",
    "/reports/:path*",
    "/vat/:path*",
    "/corporate-tax/:path*",
    "/audit/:path*",
    "/valuation/:path*",
    "/final-report/:path*",
    "/admin/:path*",
  ],
}
