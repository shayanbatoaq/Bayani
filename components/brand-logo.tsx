import Image from "next/image"
import Link from "next/link"

import { cn } from "@/lib/utils"

type BrandLogoProps = {
  className?: string
  imageClassName?: string
  href?: string
  priority?: boolean
  /** "light" uses the reversed lockup, for the forest ground only. */
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
      src={tone === "light" ? "/bayani-logo-reversed.png" : "/bayani-logo.png"}
      alt="Bayani"
      width={1682}
      height={642}
      priority={priority}
      className={cn("h-10 w-auto object-contain", imageClassName)}
    />
  )

  return (
    <Link
      href={href}
      className={cn("inline-flex items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}
    >
      {logo}
    </Link>
  )
}
