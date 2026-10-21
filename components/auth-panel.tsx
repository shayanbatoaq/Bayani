"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertCircle, ArrowRight, Loader2, Mail, MailCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { countries, priorityCountries } from "@/lib/countries"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"

type Provider = "google" | "facebook" | "apple"
const providers: { id: Provider; label: string }[] = [
  { id: "google", label: "Continue with Google" },
  { id: "facebook", label: "Continue with Facebook" },
  { id: "apple", label: "Continue with Apple" },
]

export function AuthPanel({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get("next"))
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [country, setCountry] = useState("United Arab Emirates")
  const [busy, setBusy] = useState<Provider | "email" | null>(null)
  const [sentTo, setSentTo] = useState("")
  const [error, setError] = useState(params.get("error") ?? "")
  const supabase = getSupabaseBrowserClient()
  const callback = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSubmit = emailValid && (mode === "login" || (name.trim().length >= 2 && country))

  async function emailSignIn(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setError("")
    if (!supabase) {
      router.push(next)
      return
    }
    setBusy("email")
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: callback(),
        shouldCreateUser: mode === "signup",
        data: mode === "signup" ? { name: name.trim(), country } : undefined,
      },
    })
    setBusy(null)
    if (error) {
      setError(
        mode === "login" && /signups not allowed|not found/i.test(error.message)
          ? "No account found for this email. Sign up first."
          : error.message
      )
      return
    }
    setSentTo(email.trim())
  }

  async function oauth(provider: Provider) {
    setError("")
    if (!supabase) {
      router.push(next)
      return
    }
    setBusy(provider)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback() },
    })
    if (error) {
      setBusy(null)
      setError(error.message)
    }
  }

  if (sentTo)
    return (
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-8 text-center shadow-sm">
        <MailCheck className="mx-auto size-10 text-emerald-700" />
        <h2 className="text-xl font-semibold">Check your email</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{sentTo}</span>.
          Open it on this device to continue.
        </p>
        <Button variant="outline" onClick={() => setSentTo("")}>
          Use a different email
        </Button>
      </div>
    )

  return (
    <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-2xl font-semibold">
        {mode === "signup" ? "Create your account" : "Log in"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "signup"
          ? "Free for one company. No card required."
          : "We'll email you a secure sign-in link."}
      </p>

      <div className="mt-6 grid gap-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            className="h-11 justify-center"
            disabled={busy !== null}
            onClick={() => oauth(provider.id)}
          >
            {busy === provider.id && <Loader2 className="size-4 animate-spin" />}
            {provider.label}
          </Button>
        ))}
      </div>

      <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or with email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form className="space-y-4" onSubmit={emailSignIn} noValidate>
        {mode === "signup" && (
          <div className="space-y-2">
            <Label htmlFor="auth-name">Full name</Label>
            <Input
              id="auth-name"
              autoComplete="name"
              className="h-11"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="auth-email">Email</Label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="email"
            className="h-11"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {mode === "signup" && (
          <div className="space-y-2">
            <Label htmlFor="auth-country">Country</Label>
            <select
              id="auth-country"
              autoComplete="country-name"
              className="h-11 w-full rounded-md border bg-white px-3 text-sm"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            >
              <optgroup label="GCC">
                {priorityCountries.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </optgroup>
              <optgroup label="All countries">
                {countries
                  .filter((name) => !(priorityCountries as readonly string[]).includes(name))
                  .map((name) => (
                    <option key={name}>{name}</option>
                  ))}
              </optgroup>
            </select>
          </div>
        )}
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        <Button type="submit" className="h-11 w-full" disabled={!canSubmit || busy !== null}>
          {busy === "email" ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          {mode === "signup" ? "Sign up with email" : "Email me a sign-in link"}
        </Button>
      </form>

      {!supabase && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Demo mode: authentication is not configured, so any option opens the workspace directly.
        </p>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "signup" ? "Already have an account? " : "New to FinScope? "}
        <Link href={mode === "signup" ? "/login" : "/"} className="font-medium text-primary">
          {mode === "signup" ? "Log in" : "Create an account"}
          <ArrowRight className="ml-1 inline size-3.5" />
        </Link>
      </p>
    </div>
  )
}

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/profile"
}
