"use client"

import { useState } from "react"
import { Dialog } from "radix-ui"
import { Handshake, Mail, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function AmaReviewPopup({ contactUrl }: { contactUrl: string | null }) {
  const [open, setOpen] = useState(true)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline">
          <Handshake className="size-4" />
          Contact AMA for expert review
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-6 shadow-xl focus:outline-none">
          <div className="mb-5 flex size-12 items-center justify-center rounded-md bg-emerald-50 text-emerald-800">
            <Handshake className="size-6" />
          </div>
          <Dialog.Title className="pr-6 text-xl font-semibold">
            Have your financials reviewed by experts
          </Dialog.Title>
          <Dialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">
            For an expert review of your audit, Corporate Tax, or VAT, contact
            AMA.
          </Dialog.Description>
          <div className="mt-6 flex flex-wrap gap-3">
            {contactUrl ? (
              <Button asChild>
                <a
                  href={contactUrl}
                  target={
                    contactUrl.startsWith("https:") ? "_blank" : undefined
                  }
                  rel="noopener noreferrer"
                >
                  <Mail className="size-4" />
                  Contact AMA
                </a>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                AMA contact details will be available shortly.
              </p>
            )}
            <Dialog.Close asChild>
              <Button variant="outline">Not now</Button>
            </Dialog.Close>
          </div>
          <Dialog.Close asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close expert review popup"
              className="absolute right-3 top-3"
            >
              <X className="size-4" />
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
