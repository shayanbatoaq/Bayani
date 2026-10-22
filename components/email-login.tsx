"use client"

import { useState, type FormEvent } from "react"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"

export function EmailLogin() {
  const [email, setEmail] = useState("")
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
      const { error } = await Promise.race([
        supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          },
        }),
        timeout,
      ])

      if (error) {
        setNotice({ type: "error", message: error.message })
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
          {busy ? "Sending link..." : "Email me a sign-in link"}
        </Button>
      </form>
    </div>
  )
}
