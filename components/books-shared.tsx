"use client"

import { Children, cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { emptyBooks, type Books, type BooksAction, type Party } from "@/lib/books"
import type { Company } from "@/lib/company"
import { categoryOf } from "@/lib/financial-statements"
import { fetchRate } from "@/lib/fx"
import { ledgerHeads } from "@/lib/ledger-heads"
import { cn } from "@/lib/utils"

export const aed = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const uid = () => crypto.randomUUID()
export const today = () => new Date().toISOString().slice(0, 10)
export const shortDate = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "")
export const addDays = (d: string, days: number) => {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + days)
  return x.toISOString().slice(0, 10)
}

const COMPANY_KEY = "bayani-company"

/** The companies, the chosen company's books, and a way to change them. */
export function useBooks() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyIdState] = useState("")
  const [books, setBooks] = useState<Books>(emptyBooks())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const revision = useRef(0)

  useEffect(() => {
    fetch("/api/companies", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error)
        setCompanies(data.companies)
        let saved = ""
        try {
          saved = localStorage.getItem(COMPANY_KEY) ?? ""
        } catch {}
        const first = data.companies.find((c: Company) => c.id === saved) ?? data.companies[0]
        if (first) setCompanyIdState(first.id)
        else setLoading(false)
      })
      .catch((cause) => {
        setError(cause.message)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/books?companyId=${companyId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.error) throw new Error(data.error)
        revision.current = data.books.revision
        setBooks(data.books)
      })
      .catch((cause) => !cancelled && setError(cause.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [companyId])

  function setCompanyId(id: string) {
    setLoading(true)
    setCompanyIdState(id)
    try {
      localStorage.setItem(COMPANY_KEY, id)
    } catch {}
  }

  /** Saves one change; throws the message to show when it cannot be made. */
  async function change(action: BooksAction): Promise<Books> {
    const response = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, revision: revision.current, change: action }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "This change could not be saved.")
    revision.current = data.books.revision
    setBooks(data.books)
    return data.books
  }

  const company = companies.find((c) => c.id === companyId)
  return { companies, company, companyId, setCompanyId, books, change, loading, error }
}

export function CompanySwitch({ companies, companyId, onChange }: { companies: Company[]; companyId: string; onChange: (id: string) => void }) {
  if (companies.length < 2) return null
  return (
    <select aria-label="Company" className="h-10 rounded-md border bg-white px-3 text-sm" value={companyId} onChange={(e) => onChange(e.target.value)}>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

/** A centred dialog on desktop, a sheet from the bottom on phones. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const id = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(13,27,46,.45)] backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className={cn("flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-4xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2 id={id} className="font-display text-lg font-semibold">
            {title}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

/** A label tied to its control (the control gets the label's id unless it has its own). */
export function Field({ label, children, hint, required }: { label: string; children: React.ReactNode; hint?: string; required?: boolean }) {
  const generated = useId()
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as React.ReactElement<{ id?: string }>) : null
  const id = only?.props.id ?? generated
  const tieable = only && typeof only.type === "string" ? true : only && (only.type as { displayName?: string }) === Input
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-[13px]" htmlFor={tieable ? id : undefined}>
        {label}
        {required && <span className="text-[var(--danger)]"> *</span>}
      </Label>
      {tieable && only ? cloneElement(only, { id }) : children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export const selectClass = "h-10 w-full rounded-md border bg-white px-3 text-sm"

/** Name, TRN, address, email: entered once, then chosen from the list. */
export function PartyForm({ kind, initial, onSave, onCancel }: { kind: "client" | "vendor"; initial?: Partial<Party>; onSave: (party: Party) => Promise<void>; onCancel: () => void }) {
  const [party, setParty] = useState<Party>({ id: initial?.id ?? uid(), name: initial?.name ?? "", trn: initial?.trn ?? "", address: initial?.address ?? "", email: initial?.email ?? "", phone: initial?.phone ?? "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const set = (k: keyof Party, v: string) => setParty((p) => ({ ...p, [k]: v }))
  const trnBad = party.trn && !/^\d{15}$/.test(party.trn.replace(/\s/g, ""))
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!party.name.trim()) return setError("Enter the name.")
        if (trnBad) return setError("A TRN has 15 digits.")
        setSaving(true)
        setError("")
        try {
          await onSave({ ...party, trn: party.trn.replace(/\s/g, "") })
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save.")
        } finally {
          setSaving(false)
        }
      }}
    >
      <Field label={kind === "client" ? "Client name" : "Supplier name"} required>
        <Input autoFocus value={party.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="VAT TRN" hint={kind === "client" ? "Needed on a tax invoice when the client is VAT registered" : undefined}>
          <Input inputMode="numeric" value={party.trn} onChange={(e) => set("trn", e.target.value)} aria-invalid={Boolean(trnBad)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={party.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
      </div>
      <Field label="Address">
        <textarea className="min-h-16 w-full rounded-md border px-3 py-2 text-sm" value={party.address} onChange={(e) => set("address", e.target.value)} />
      </Field>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save {kind === "client" ? "client" : "supplier"}
        </Button>
      </div>
    </form>
  )
}

export type HeadOption = { name: string; scheduleKey: string; group: string; key?: string }

/**
 * A searchable list: typing "capital" shows every head containing "capital".
 * Optionally offers to create the typed name as a new head.
 */
export function HeadPicker({
  value,
  options,
  onChange,
  label,
  placeholder = "Search heads",
  onCreate,
  className,
  emptyLabel = "Choose a head",
}: {
  emptyLabel?: string
  value: string
  options: HeadOption[]
  onChange: (option: HeadOption) => void
  label: string
  placeholder?: string
  onCreate?: (name: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const listId = useId()
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.name.toLowerCase().includes(q) || o.group.toLowerCase().includes(q)) : options
  }, [options, query])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  const pick = (o: HeadOption) => {
    onChange(o)
    setOpen(false)
    setQuery("")
  }
  const groups = [...new Set(matches.map((m) => m.group))]
  const exact = options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase())
  return (
    <div ref={box} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-left text-sm", !value && "text-muted-foreground")}
      >
        <span className="truncate">{value || emptyLabel}</span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 min-w-[16rem] rounded-lg border bg-white shadow-xl">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              role="combobox"
              aria-controls={listId}
              aria-expanded
              aria-label={`Search ${label.toLowerCase()}`}
              className="h-10 w-full bg-transparent text-sm outline-none"
              placeholder={placeholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, matches.length - 1))
                } else if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, 0))
                } else if (e.key === "Enter") {
                  e.preventDefault()
                  if (matches[active]) pick(matches[active])
                  else if (onCreate && query.trim()) {
                    onCreate(query.trim())
                    setOpen(false)
                  }
                } else if (e.key === "Escape") setOpen(false)
              }}
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1 text-sm">
            {groups.map((g) => (
              <li key={g}>
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground">{g}</p>
                <ul>
                  {matches
                    .filter((m) => m.group === g)
                    .map((m) => {
                      const i = matches.indexOf(m)
                      return (
                        <li
                          key={`${m.group}-${m.name}`}
                          role="option"
                          aria-selected={m.name === value}
                          onMouseEnter={() => setActive(i)}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            pick(m)
                          }}
                          className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5", i === active && "bg-[var(--cobalt-wash)]")}
                        >
                          <span className="truncate">{m.name}</span>
                          {m.name === value && <Check className="size-4 text-[var(--cobalt)]" />}
                        </li>
                      )
                    })}
                </ul>
              </li>
            ))}
            {!matches.length && <li className="px-3 py-2 text-muted-foreground">No head contains “{query}”.</li>}
            {onCreate && query.trim() && !exact && (
              <li>
                <button
                  type="button"
                  className="w-full border-t px-3 py-2 text-left font-medium text-[var(--cobalt)] hover:bg-[var(--cobalt-wash)]"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onCreate(query.trim())
                    setOpen(false)
                  }}
                >
                  + Add “{query.trim()}” as a new head
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const style: Record<string, string> = {
    paid: "bg-[var(--lagoon-wash)] text-[var(--evergreen)]",
    partial: "bg-[var(--saffron-wash)] text-[var(--warning-text)]",
    unpaid: "bg-[var(--cobalt-wash)] text-[var(--info-text)]",
    overdue: "bg-[var(--danger-subtle)] text-[var(--danger)]",
    credited: "bg-muted text-muted-foreground",
  }
  const label: Record<string, string> = { paid: "Paid", partial: "Part paid", unpaid: "Unpaid", overdue: "Overdue", credited: "Credited" }
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", style[status])}>{label[status] ?? status}</span>
}

/** Download a file from an API route that answers with a PDF. */
export async function downloadFile(url: string, filename: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Download failed.")
  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = href
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
  return blob
}

/** Heads a cost can be booked to: expenses, cost of sales and fixed assets (standard and the company's own). */
export function costHeads(customHeads: { name: string; scheduleKey: string }[]): HeadOption[] {
  const out: HeadOption[] = []
  const seen = new Set<string>()
  const groupOf = (key: string) => (key === "costOfSales" ? "Cost of sales" : key === "ppe" ? "Fixed assets" : categoryOf(key)?.statement === "P&L" ? "Expenses" : "")
  for (const h of [...ledgerHeads, ...customHeads]) {
    const group = groupOf(h.scheduleKey)
    if (!group || /allowance|accumulated|depreciation expense/i.test(h.name) || seen.has(h.name.toLowerCase())) continue
    if (["sales", "otherIncome", "exchange"].includes(h.scheduleKey)) continue
    seen.add(h.name.toLowerCase())
    out.push({ name: h.name, scheduleKey: h.scheduleKey, group })
  }
  const order = ["Expenses", "Cost of sales", "Fixed assets"]
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name))
}

/** Costs usually paid ahead for a period: offered to be spread over the months they cover. */
export const SPREADABLE = /\b(rent|insurance|licen[cs]e|ejari|lease|subscription)\b/i
export const SPREAD_TERMS = [
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
  { months: 36, label: "3 years" },
]
export const ASSET_LIVES = [
  { months: 36, label: "3 years (computers, phones)" },
  { months: 48, label: "4 years (vehicles)" },
  { months: 60, label: "5 years (furniture, equipment)" },
  { months: 120, label: "10 years (fit-out, machinery)" },
]

/**
 * "Expense in full, or spread?" for rent, insurance and licences, and the useful life of an asset.
 * months null = expense in full.
 */
export function SpreadChoice({ kind, months, onChange, amount }: { kind: "prepaid" | "asset"; months: number | null; onChange: (months: number | null) => void; amount?: number }) {
  const presets = kind === "asset" ? ASSET_LIVES : SPREAD_TERMS
  const [custom, setCustom] = useState(months && !presets.some((p) => p.months === months) ? String(months) : "")
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {kind === "prepaid" && (
          <button type="button" aria-pressed={months === null} className={cn("rounded-full border px-3 py-1.5 text-sm", months === null && "border-[var(--cobalt)] bg-[var(--cobalt-wash)] font-semibold text-[var(--cobalt)]")} onClick={() => onChange(null)}>
            Expense in full
          </button>
        )}
        {presets.map((p) => (
          <button
            key={p.months}
            type="button"
            aria-pressed={months === p.months}
            className={cn("rounded-full border px-3 py-1.5 text-sm", months === p.months && "border-[var(--cobalt)] bg-[var(--cobalt-wash)] font-semibold text-[var(--cobalt)]")}
            onClick={() => {
              setCustom("")
              onChange(p.months)
            }}
          >
            {kind === "prepaid" ? `Spread over ${p.label}` : p.label}
          </button>
        ))}
        <label className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
          <span className="text-muted-foreground">Other</span>
          <input
            inputMode="numeric"
            aria-label="Number of months"
            className="w-12 bg-transparent text-right outline-none"
            value={custom}
            placeholder="0"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 3)
              setCustom(v)
              if (Number(v) >= 1) onChange(Number(v))
            }}
          />
          <span className="text-muted-foreground">months</span>
        </label>
      </div>
      {months && amount ? (
        <p className="text-xs text-muted-foreground">
          {kind === "asset" ? "Depreciation" : "Expense"} of {aed(amount / months)} a month for {months} months, posted automatically.
        </p>
      ) : null}
    </div>
  )
}

/** Adds one change to a company's books from a page that does not hold them (reads the revision first). */
export async function changeBooks(companyId: string, action: BooksAction) {
  const current = await fetch(`/api/books?companyId=${companyId}`, { cache: "no-store" }).then((r) => r.json())
  if (current.error) throw new Error(current.error)
  const response = await fetch("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId, revision: current.books.revision, change: action }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Could not save.")
  return data.books as Books
}

/**
 * The currency of an invoice or bill, with the rate into the base currency and (for UAE tax
 * invoices) into AED, fetched for the document date and editable.
 */
export function DocumentCurrency({
  base,
  value,
  date,
  onChange,
  label = "Currency",
}: {
  base: string
  value: { currency: string; rate: number; aedRate?: number }
  date: string
  onChange: (next: { currency: string; rate: number; aedRate?: number }) => void
  label?: string
}) {
  const [doneKey, setDoneKey] = useState("")
  const [note, setNote] = useState("")
  const key = `${value.currency}|${date}|${base}`
  const busy = doneKey !== key && !(value.currency === base && base === "AED")
  const fetched = useRef("")
  useEffect(() => {
    if (fetched.current === key) return
    fetched.current = key
    if (value.currency === base && base === "AED") {
      if (value.rate !== 1 || value.aedRate !== undefined) onChange({ currency: value.currency, rate: 1, aedRate: undefined })
      return
    }
    let cancelled = false
    Promise.all([fetchRate(value.currency, base, date), value.currency === "AED" ? null : fetchRate(value.currency, "AED", date)])
      .then(([toBase, toAed]) => {
        if (cancelled) return
        onChange({ currency: value.currency, rate: toBase.rate || value.rate, aedRate: toAed ? toAed.rate : undefined })
        setNote(toBase.source === "fallback" || toAed?.source === "fallback" ? "Approximate rate: check it." : toBase.source === "peg" && (!toAed || toAed.source === "peg") ? "Fixed peg rate." : `ECB rate for ${toBase.date}.`)
      })
      .catch(() => !cancelled && setNote("No rate could be fetched: type it."))
      .finally(() => !cancelled && setDoneKey(key))
    return () => {
      cancelled = true
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const options = [...new Set([base, "AED", "USD", "EUR", "GBP"])]
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1.5">
          <span className="block text-[13px] font-medium">{label}</span>
          <select aria-label={label} className="h-10 rounded-md border bg-white px-3 text-sm" value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })}>
            {options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {value.currency !== base && (
          <label className="space-y-1.5">
            <span className="block text-[13px] font-medium">
              1 {value.currency} = … {base}
            </span>
            <Input inputMode="decimal" className="w-32" aria-label={`Rate ${value.currency} to ${base}`} value={String(value.rate)} onChange={(e) => onChange({ ...value, rate: Number(e.target.value) || 0 })} />
          </label>
        )}
        {value.currency !== "AED" && base !== "AED" && (
          <label className="space-y-1.5">
            <span className="block text-[13px] font-medium">1 {value.currency} = … AED</span>
            <Input inputMode="decimal" className="w-32" aria-label={`Rate ${value.currency} to AED`} value={String(value.aedRate ?? "")} onChange={(e) => onChange({ ...value, aedRate: Number(e.target.value) || undefined })} />
          </label>
        )}
        {busy && <Loader2 className="mb-3 size-4 animate-spin text-muted-foreground" />}
      </div>
      {(value.currency !== base || (value.currency !== "AED" && base !== "AED")) && note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
