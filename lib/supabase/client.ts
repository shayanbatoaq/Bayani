"use client"

import { createBrowserClient } from "@supabase/ssr"

type BrowserClient = ReturnType<typeof createBrowserClient>

let supabaseBrowserClient: BrowserClient | null = null

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    return null
  }

  if (!supabaseBrowserClient) {
    supabaseBrowserClient = createBrowserClient(url, anonKey)
  }

  return supabaseBrowserClient
}
