"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"

type LoginMode = "password" | "email"

export function EmailLogin() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState<LoginMode>("password")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice(null)

    const supabase = getSupabaseBrowserClient()
    if (!supabase) {
      setNotice({
        type: "error",
        message: "Sign-in is not configured. Please contact the FinScope administrator.",
      })
      return
    }

    setBusy(true)
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("The sign-in request timed out. Please try again.")),
          15000
        )
      })
      const request =
        mode === "password"
          ? supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            })
          : supabase.auth.signInWithOtp({
              email: email.trim(),
              options: {
                emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
              },
            })
      const { error } = await Promise.race([request, timeout])

      if (error) {
        setNotice({ type: "error", message: error.message })
      } else if (mode === "password") {
        router.replace("/dashboard")
        router.refresh()
      } else {
        setNotice({
          type: "success",
          message: "Check your inbox for a secure sign-in link. It may take a minute to arrive.",
        })
      }
    } catch (error) {
      setNotice({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn't start sign-in. Please try again.",
      })
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 w-full">
      <form className="space-y-4 text-left" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="login-email">Email address</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
          />
        </div>
        {mode === "password" ? (
          <div className="space-y-2">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
          </div>
        ) : null}
        {notice ? (
          <Alert variant={notice.type === "error" ? "destructive" : "default"}>
            {notice.type === "error" ? (
              <AlertCircle className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            <AlertTitle>
              {notice.type === "error" ? "Sign-in failed" : "Link requested"}
            </AlertTitle>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button className="w-full" type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy
            ? mode === "password"
              ? "Signing in..."
              : "Sending link..."
            : mode === "password"
              ? "Log in"
              : "Email me a sign-in link"}
        </Button>
      </form>
      <button
        className="mt-4 text-sm font-medium text-primary underline-offset-4 hover:underline"
        type="button"
        onClick={() => {
          setNotice(null)
          setMode(mode === "password" ? "email" : "password")
        }}
      >
        {mode === "password" ? "Use an email sign-in link instead" : "Use a password instead"}
      </button>
    </div>
  )
}
