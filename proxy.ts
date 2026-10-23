import { createServerClient } from "@supabase/ssr"
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
  "/invoices",
  "/bills",
  "/adjustments",
  "/e-invoicing",
  "/activity",
]

export async function proxy(request: NextRequest) {
  // Log in is a single click into the workspace; sign-in is only enforced when required.
  const authConfigured =
    process.env.FINSCOPE_REQUIRE_LOGIN === "true" &&
    Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    )

  if (!authConfigured) {
    return NextResponse.next()
  }

  const pathname = request.nextUrl.pathname
  const protectedRoute = protectedPrefixes.some((prefix) => pathname.startsWith(prefix))
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, value)
          )
        },
      },
    }
  )

  let response = NextResponse.next({ request })
  const { data } = await supabase.auth.getClaims()

  if (protectedRoute && !data?.claims) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("next", pathname)
    const redirect = NextResponse.redirect(loginUrl)
    response.cookies.getAll().forEach(({ name, value, ...options }) =>
      redirect.cookies.set(name, value, options)
    )
    return redirect
  }

  return response
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
    "/invoices/:path*",
    "/bills/:path*",
    "/adjustments/:path*",
    "/e-invoicing/:path*",
    "/activity/:path*",
  ],
}
