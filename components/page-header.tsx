import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type PageHeaderProps = {
  /** Short context shown above the title, in sentence case. */
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, description, action, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--cobalt)]">
            <span aria-hidden className="h-[3px] w-6 rounded-full bg-gradient-to-r from-[var(--cobalt)] to-[var(--lagoon)]" />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 font-display text-3xl font-semibold text-foreground sm:text-[2.4rem] sm:leading-tight">{title}</h1>
        {description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
