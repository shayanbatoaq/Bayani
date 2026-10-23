import Image from "next/image"
import Link from "next/link"

import { cn } from "@/lib/utils"

type BrandLogoProps = {
  className?: string
  imageClassName?: string
  href?: string
  priority?: boolean
  /** "light" for dark backgrounds. */
  tone?: "dark" | "light"
}

export function BrandLogo({
  className,
  imageClassName,
  href = "/",
  priority = false,
  tone = "dark",
}: BrandLogoProps) {
  const logo = (
    <Image
      src="/bayani-logo.png"
      alt="Bayani"
      width={760}
      height={315}
      priority={priority}
      className={cn("h-12 w-auto object-contain", tone === "light" && "brightness-0 invert", imageClassName)}
    />
  )

  return (
    <Link
      href={href}
      className={cn("inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40", className)}
    >
      {logo}
    </Link>
  )
}
