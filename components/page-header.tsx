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
    <div className={cn("flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="text-[13px] font-medium text-subtle-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-[1.75rem] sm:leading-9">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm leading-[22px] text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
