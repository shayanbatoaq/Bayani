"use client"

import { useRouter } from "next/navigation"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function QuickLogin({
  className,
  size = "lg",
  label = "Log in",
}: {
  className?: string
  size?: "lg" | "default"
  label?: string
}) {
  const router = useRouter()

  return (
    <Button
      size={size}
      className={cn(className)}
      onClick={() => router.push("/login")}
    >
      {label}
      <ArrowRight className="size-4" />
    </Button>
  )
}
