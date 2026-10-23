"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, ClipboardList, Loader2, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { emptyBooks, type Books, type BooksAction } from "@/lib/books"
import type { BankSession } from "@/lib/bank-session"
import type { Company } from "@/lib/company"
import type { VatFiling, VatPeriodSlot } from "@/lib/vat-filings"
import { docKey, filingFrom, periodOf, vatItems, type BankVatItem, type VatItem } from "@/lib/vat-return"
import { cn } from "@/lib/utils"

const fmt = (n: number) => (Math.round(n * 100) / 100 || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = (iso: string) => iso.split("-").reverse().join("/")

/**
 * The VAT return for a period, prepared from invoices, credit notes, bills and the bank lines
 * marked as including VAT. Any item can be left out with one click (an invoice not yet paid, a
 * bill not yet paid); items left out stay listed until they are put into a later return.
 */
export function VatReturnBuilder({ company, slot, periods, onUse }: { company: Company; slot: VatPeriodSlot; periods: VatPeriodSlot[]; onUse: (filing: VatFiling) => void }) {
  const base = company.baseCurrency ?? "AED"
  const [books, setBooks] = useState<Books | null>(null)
  const [revision, setRevision] = useState(0)
  const [bank, setBank] = useState<BankVatItem[]>([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState<"AED" | "base">("AED")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const first = Number((periods[0]?.start ?? slot.start).slice(0, 4))
    const last = new Date().getFullYear() + 1
    const years = Array.from({ length: Math.max(1, last - first + 1) }, (_, i) => first + i)
    Promise.all([
      fetch(`/api/books?companyId=${company.id}`, { cache: "no-store" }).then((r) => r.json()),
      ...years.map((y) => fetch(`/api/bank-statements?companyId=${company.id}&year=${y}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({}))),
    ])
      .then(([b, ...sessions]) => {
        if (cancelled) return
        const loaded = (b.books as Books) ?? emptyBooks()
        setBooks(loaded)
        setRevision(loaded.revision)
        const seen = new Set<string>()
        const items: BankVatItem[] = []
        for (const s of sessions as { session?: BankSession | null }[])
          for (const item of s.session?.vatItems ?? [])
            if (!seen.has(item.id)) {
              seen.add(item.id)
              items.push(item)
            }
        setBank(items)
      })
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : "Could not load."))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [company.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => (books ? vatItems(books, bank, base, company.emirate) : []), [books, bank, base, company.emirate])
  const assignments = books?.vatAssignments ?? {}
  const here = all.filter((i) => periodOf(i, assignments, periods) === slot.id)
  // Left out of earlier returns (or dated in an earlier period with no return): offered here.
  const waiting = all.filter((i) => periodOf(i, assignments, periods) === "none" && i.date <= slot.end)
  const neverIncluded = all.filter((i) => periodOf(i, assignments, periods) === "none")

  async function assign(keys: string[], period: string | null) {
    if (!books) return
    setBusy(keys[0])
    setError("")
    try {
      const response = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id, revision, change: { action: "vatAssign", keys: [...new Set(keys.map(docKey))], period } satisfies BooksAction }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setBooks(data.books)
      setRevision(data.books.revision)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.")
    } finally {
      setBusy("")
    }
  }

  const naturalPeriod = (i: VatItem) => periods.find((p) => i.date >= p.start && i.date <= p.end)?.id
  const net = (i: VatItem) => (currency === "AED" ? i.netAed : i.net)
  const vat = (i: VatItem) => (currency === "AED" ? i.vatAed : i.vat)
  const shown = currency === "AED" ? "AED" : base
  const outputVat = here.filter((i) => i.kind === "output").reduce((t, i) => t + vat(i), 0)
  const inputVat = here.filter((i) => i.kind === "input").reduce((t, i) => t + vat(i), 0)
  const missingAed = here.some((i) => i.noAedRate)

  if (loading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Gathering invoices, bills and bank lines…
      </p>
    )

  const table = (items: VatItem[], mode: "here" | "waiting") =>
    items.length ? (
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b bg-secondary/50 text-left text-xs text-muted-foreground">
              <th className="w-10 px-3 py-2">{mode === "here" ? "In" : ""}</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">From</th>
              <th className="px-2 py-2">Details</th>
              <th className="px-2 py-2">Box</th>
              <th className="px-2 py-2 text-right">Amount ({shown})</th>
              <th className="px-3 py-2 text-right">VAT ({shown})</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.key} className="border-b last:border-0">
                <td className="px-3 py-1.5">
                  {mode === "here" ? (
                    <input
                      type="checkbox"
                      aria-label={`Include ${i.description}`}
                      checked
                      disabled={Boolean(busy)}
                      onChange={() => void assign([i.key], "none")}
                      className="size-4 accent-[var(--cobalt)]"
                    />
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={Boolean(busy)} onClick={() => void assign([i.key], naturalPeriod(i) === slot.id ? null : slot.id)}>
                      Add
                    </Button>
                  )}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{dmy(i.date)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{i.source}</td>
                <td className="max-w-72 truncate px-2 py-1.5" title={i.description}>
                  {i.description}
                  {i.noAedRate && <span className="ml-1 text-xs text-[#b42318]">(no AED rate)</span>}
                  {mode === "here" && naturalPeriod(i) !== slot.id && <span className="ml-1 text-xs text-muted-foreground">(brought into this return)</span>}
                </td>
                <td className="px-2 py-1.5">{i.box}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(net(i))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{["4", "5"].includes(i.box) ? "-" : fmt(vat(i))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">{mode === "here" ? "Nothing in this period." : "Nothing waiting."}</p>
    )

  return (
    <section className="space-y-4 rounded-xl border border-[var(--cobalt)]/30 bg-[var(--cobalt-wash)]/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <ClipboardList className="size-5 text-[var(--cobalt)]" /> Prepared from Bayani
          </h3>
          <p className="text-sm text-muted-foreground">Invoices, credit notes, bills and the bank lines you marked as including VAT. Untick anything that should not go in this return; it stays listed until you add it to a later one.</p>
        </div>
        {base !== "AED" && (
          <div role="tablist" aria-label="Currency" className="track">
            {(["AED", "base"] as const).map((c) => (
              <button key={c} type="button" role="tab" aria-selected={currency === c} className="track-item" onClick={() => setCurrency(c)}>
                {c === "AED" ? "AED (for filing)" : base}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="note note-alert text-sm">{error}</p>}
      {!all.length && (
        <p className="text-sm text-muted-foreground">
          Nothing to prepare from yet. Issue invoices, post bills, or mark bank lines as including VAT in{" "}
          <Link href="/data-input" className="text-[var(--cobalt)] underline">
            Data Input
          </Link>
          .
        </p>
      )}
      {all.length > 0 && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-semibold">VAT on sales and other outputs</p>
            {table(
              here.filter((i) => i.kind === "output"),
              "here",
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">VAT on expenses and other inputs</p>
            {table(
              here.filter((i) => i.kind === "input"),
              "here",
            )}
          </div>
          {waiting.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Undo2 className="size-4" /> Not in any return yet ({waiting.length})
              </p>
              <p className="text-xs text-muted-foreground">Left out of an earlier return, or dated in a period with no return. Add them here when they should be declared.</p>
              {table(waiting, "waiting")}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["Output VAT", outputVat],
                ["Input VAT", inputVat],
                [outputVat - inputVat >= 0 ? "Payable" : "Refundable", Math.abs(outputVat - inputVat)],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-white p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-display text-lg font-semibold tabular-nums">
                  {shown} {fmt(value)}
                </p>
              </div>
            ))}
          </div>
          {missingAed && (
            <p className="note note-warning text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Some documents in another currency have no AED rate. Open them in Invoices or Bills and enter the AED rate.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!here.length || missingAed} onClick={() => onUse(filingFrom(here, slot))}>
              Use these figures for the return <ArrowRight className="size-4" />
            </Button>
            {neverIncluded.length > 0 && (
              <span className={cn("text-sm", neverIncluded.length ? "text-[#6b4500]" : "text-muted-foreground")}>
                {neverIncluded.length} item{neverIncluded.length === 1 ? "" : "s"} marked with VAT are not in any return yet.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  )
}
