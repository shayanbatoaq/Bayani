"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** One click into the workspace; no credentials are asked for. */
export function QuickLogin({ className, size = "lg", label = "Log in" }: { className?: string; size?: "lg" | "default"; label?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size={size}
      className={cn(className)}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        router.push("/dashboard")
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
      {!busy && <ArrowRight className="size-4" />}
    </Button>
  )
}
