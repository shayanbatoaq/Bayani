"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"

/**
 * A number typed as text: "12.", "0.5" or "1,234.50" stay as typed while the number they read
 * as is passed on (undefined when empty), and the field shows value again when it loses focus.
 */
function DecimalInput({
  value,
  onValueChange,
  onBlur,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & { value: string; onValueChange: (value: number | undefined) => void }) {
  const [text, setText] = React.useState<string | null>(null)
  return (
    <Input
      inputMode="decimal"
      {...props}
      value={text ?? value}
      onChange={(event) => {
        setText(event.target.value)
        const raw = event.target.value.replace(/,/g, "").trim()
        if (!raw) onValueChange(undefined)
        else if (Number.isFinite(Number(raw))) onValueChange(Number(raw))
      }}
      onBlur={(event) => {
        setText(null)
        onBlur?.(event)
      }}
    />
  )
}

export { DecimalInput }
