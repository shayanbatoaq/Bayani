"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Building2, CreditCard, Download, FilePlus2, Loader2, Pencil, Plus, ReceiptText, Search, Settings2, Share2, Trash2, Undo2, Users } from "lucide-react"

import {
  CompanySwitch,
  DocumentCurrency,
  Field,
  Modal,
  PartyForm,
  StatusPill,
  addDays,
  aed,
  downloadFile,
  selectClass,
  shortDate,
  today,
  uid,
  useBooks,
} from "@/components/books-shared"
import { Loading, NoData } from "@/components/tax-workbench"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  VAT_TREATMENTS,
  documentTotals,
  lineTotals,
  nextCreditNumber,
  nextInvoiceNumber,
  round2,
  type Books,
  type BooksAction,
  type BooksSettings,
  type Invoice,
  type Line,
  type VatTreatment,
} from "@/lib/books"
import { findParty, invoiceStatus } from "@/lib/books-engine"
import type { Company } from "@/lib/company"
import { cn } from "@/lib/utils"

type Change = (action: BooksAction) => Promise<Books>

const isOverdue = (books: Books, inv: Invoice) => {
  const st = invoiceStatus(books, inv)
  return st.due > 0 && Boolean(inv.dueDate) && inv.dueDate < today()
}
const statusOf = (books: Books, inv: Invoice) => (isOverdue(books, inv) ? "overdue" : invoiceStatus(books, inv).status)

export function InvoicesWorkbench() {
  const { companies, company, companyId, setCompanyId, books, change, loading, error } = useBooks()
  const [tab, setTab] = useState<"invoices" | "customers" | "settings">("invoices")
  const [editing, setEditing] = useState<Invoice | "new" | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [clientFilter, setClientFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [query, setQuery] = useState("")

  if (loading) return <Loading />
  if (!company) return <NoData title="No company yet" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />

  const base = company.baseCurrency ?? "AED"
  const year = String(new Date().getFullYear())
  const totals = books.invoices.reduce(
    (t, inv) => {
      const st = invoiceStatus(books, inv)
      // In the base currency, at each invoice's own rate.
      const r = inv.rate ?? 1
      if (inv.date.startsWith(year)) t.invoiced += (st.total - st.credited) * r
      t.outstanding += st.due * r
      if (isOverdue(books, inv)) t.overdue += st.due * r
      t.received += inv.date.startsWith(year) ? st.paid * r : 0
      return t
    },
    { invoiced: 0, outstanding: 0, overdue: 0, received: 0 },
  )
  const list = books.invoices
    .filter((inv) => !clientFilter || inv.clientId === clientFilter)
    .filter((inv) => !statusFilter || statusOf(books, inv) === statusFilter || (statusFilter === "open" && invoiceStatus(books, inv).due > 0))
    .filter((inv) => {
      if (!query) return true
      const client = books.clients.find((c) => c.id === inv.clientId)?.name ?? ""
      return `${inv.number} ${client} ${inv.lines.map((l) => `${l.item} ${l.description}`).join(" ")}`.toLowerCase().includes(query.toLowerCase())
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
  const setupNeeded = !books.settings.bank.iban && !books.settings.bank.accountNumber && !books.settings.address
  const current = viewing ? books.invoices.find((i) => i.id === viewing) : null

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Company</p>
            <p className="mt-1 text-lg font-semibold">{company.name}</p>
            <p className="text-xs text-muted-foreground">{company.vat.trn ? `VAT registered · TRN ${company.vat.trn} · issues tax invoices` : "Not VAT registered · issues invoices without VAT"}</p>
          </div>
          <CompanySwitch companies={companies} companyId={companyId} onChange={setCompanyId} />
        </div>
        <Button onClick={() => setEditing("new")}>
          <FilePlus2 className="size-4" /> New invoice
        </Button>
      </div>
      {error && <p className="note note-alert text-sm">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile currency={base} label={`Invoiced in ${year}`} value={totals.invoiced} />
        <Tile currency={base} label={`Received in ${year}`} value={totals.received} tone="good" />
        <Tile currency={base} label="Outstanding" value={totals.outstanding} />
        <Tile currency={base} label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? "alert" : undefined} />
      </div>

      {setupNeeded && (
        <div className="note note-info items-start text-sm">
          <Settings2 className="mt-0.5 size-4 shrink-0" />
          <span>
            Add your address and bank details once, and they appear on every invoice.{" "}
            <button type="button" className="font-semibold underline" onClick={() => setTab("settings")}>
              Invoice settings
            </button>
            {!company.logo && (
              <>
                {" "}
                · Your logo is added from the{" "}
                <Link className="font-semibold underline" href="/dashboard">
                  company profile
                </Link>
                .
              </>
            )}
          </span>
        </div>
      )}

      <div className="track" role="tablist" aria-label="Invoices">
        {(
          [
            ["invoices", "Invoices"],
            ["customers", "Customers"],
            ["settings", "Settings"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className="track-item" onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "invoices" && (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b p-4">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search number, client or item" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search invoices" />
            </div>
            <select aria-label="Client" className={cn(selectClass, "w-auto")} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">All clients</option>
              {books.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select aria-label="Status" className={cn(selectClass, "w-auto")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Any status</option>
              <option value="open">Not fully paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Part paid</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          {list.length ? (
            <InvoiceTable books={books} list={list} onOpen={setViewing} base={base} />
          ) : (
            <div className="space-y-3 p-10 text-center">
              <ReceiptText className="mx-auto size-8 text-muted-foreground" />
              <p className="font-medium">{books.invoices.length ? "No invoice matches these filters." : "No invoices yet"}</p>
              {!books.invoices.length && <p className="text-sm text-muted-foreground">Each invoice updates sales, receivables and VAT in your reports straight away.</p>}
            </div>
          )}
        </div>
      )}

      {tab === "customers" && (
        <Customers
          base={base}
          books={books}
          change={change}
          onShow={(id) => {
            setClientFilter(id)
            setTab("invoices")
          }}
        />
      )}
      {tab === "settings" && <InvoiceSettings company={company} books={books} change={change} />}

      {editing && (
        <Modal title={editing === "new" ? "New invoice" : `Edit invoice ${editing.number}`} onClose={() => setEditing(null)} wide>
          <InvoiceForm
            company={company}
            books={books}
            change={change}
            initial={editing === "new" ? null : editing}
            onDone={(id) => {
              setEditing(null)
              setViewing(id)
            }}
          />
        </Modal>
      )}
      {current && !editing && (
        <InvoiceView
          company={company}
          books={books}
          change={change}
          invoice={current}
          onClose={() => setViewing(null)}
          onEdit={() => setEditing(current)}
        />
      )}
    </div>
  )
}

function Tile({ label, value, tone, currency }: { label: string; value: number; tone?: "good" | "alert"; currency: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-xl font-semibold tabular-nums", tone === "good" && "text-[var(--evergreen)]", tone === "alert" && "text-[var(--danger)]")}>{currency} {aed(value)}</p>
    </div>
  )
}

function InvoiceTable({ books, list, onOpen, base }: { books: Books; list: Invoice[]; onOpen: (id: string) => void; base: string }) {
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5">Number</th>
            <th className="px-4 py-2.5">Date</th>
            <th className="px-4 py-2.5">Client</th>
            <th className="px-4 py-2.5 text-right">Total</th>
            <th className="px-4 py-2.5 text-right">Due</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((inv) => {
            const st = invoiceStatus(books, inv)
            return (
              <tr key={inv.id} className="cursor-pointer border-b last:border-0 hover:bg-[var(--cobalt-wash)]/40" onClick={() => onOpen(inv.id)}>
                <td className="px-4 py-3 font-medium">
                  <button type="button" className="hover:underline" onClick={() => onOpen(inv.id)}>
                    {inv.number}
                  </button>
                </td>
                <td className="px-4 py-3">{shortDate(inv.date)}</td>
                <td className="px-4 py-3">{books.clients.find((c) => c.id === inv.clientId)?.name}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {inv.currency && inv.currency !== base ? <span className="mr-1 text-xs text-muted-foreground">{inv.currency}</span> : null}
                  {aed(st.total)}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{aed(st.due)}</td>
                <td className="px-4 py-3">
                  <StatusPill status={statusOf(books, inv)} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ul className="divide-y md:hidden">
        {list.map((inv) => {
          const st = invoiceStatus(books, inv)
          return (
            <li key={inv.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={() => onOpen(inv.id)}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{books.clients.find((c) => c.id === inv.clientId)?.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {inv.number} · {shortDate(inv.date)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-medium tabular-nums">
                    {inv.currency && inv.currency !== base ? `${inv.currency} ` : ""}
                    {aed(st.due || st.total)}
                  </span>
                  <StatusPill status={statusOf(books, inv)} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/* ---------------- form ---------------- */

const blankLine = (vat: VatTreatment): Line => ({ id: uid(), item: "", description: "", quantity: 1, rate: 0, vat })

export function LinesEditor({
  lines,
  onChange,
  items,
  vatRegistered,
  treatments,
}: {
  lines: Line[]
  onChange: (lines: Line[]) => void
  items: Books["items"]
  vatRegistered: boolean
  treatments: readonly { key: string; label: string }[]
}) {
  const set = (id: string, patch: Partial<Line>) => onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const listId = "bayani-items"
  return (
    <div className="space-y-2">
      <datalist id={listId}>
        {items.map((i) => (
          <option key={i.name} value={i.name} />
        ))}
      </datalist>
      {lines.map((line, n) => {
        const t = lineTotals(line)
        return (
          <div key={line.id} className="rounded-xl border bg-muted/20 p-3">
            <div className="grid gap-2 sm:grid-cols-[1.3fr_2fr]">
              <Field label={`Item or service ${n + 1}`}>
                <Input
                  list={listId}
                  value={line.item}
                  placeholder="Type or choose"
                  onChange={(e) => {
                    const known = items.find((i) => i.name.toLowerCase() === e.target.value.toLowerCase())
                    set(line.id, known ? { item: known.name, description: line.description || known.description, rate: line.rate || known.rate, vat: vatRegistered ? known.vat : line.vat } : { item: e.target.value })
                  }}
                />
              </Field>
              <Field label="Description">
                <Input value={line.description} onChange={(e) => set(line.id, { description: e.target.value })} />
              </Field>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[0.7fr_1fr_1.4fr_1fr_auto]">
              <Field label="Quantity">
                <Input inputMode="decimal" value={String(line.quantity)} onChange={(e) => set(line.id, { quantity: Math.max(0, Number(e.target.value) || 0) })} />
              </Field>
              <Field label="Rate">
                <Input inputMode="decimal" value={line.rate ? String(line.rate) : ""} placeholder="0.00" onChange={(e) => set(line.id, { rate: Number(e.target.value.replace(/,/g, "")) || 0 })} />
              </Field>
              {vatRegistered ? (
                <Field label="VAT">
                  <select className={selectClass} value={line.vat} onChange={(e) => set(line.id, { vat: e.target.value as VatTreatment })}>
                    {treatments.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <div className="hidden sm:block" />
              )}
              <div className="space-y-1.5 text-right">
                <p className="text-[13px] font-medium">Amount</p>
                <p className="pt-2 text-sm font-semibold tabular-nums">{aed(t.total)}</p>
                {vatRegistered && t.vat > 0 && <p className="text-xs text-muted-foreground">incl. VAT {aed(t.vat)}</p>}
              </div>
              <div className="flex items-end justify-end">
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${n + 1}`} disabled={lines.length === 1} onClick={() => onChange(lines.filter((l) => l.id !== line.id))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, blankLine(vatRegistered ? "standard" : "outOfScope")])}>
        <Plus className="size-4" /> Add line
      </Button>
    </div>
  )
}

/** What an invoice made from a bank receipt starts with. */
export type InvoicePrefill = { clientId?: string; clientName?: string; date: string; currency: string; lines: Line[]; notes?: string }

export function InvoiceForm({
  company,
  books,
  change,
  initial,
  onDone,
  prefill,
}: {
  company: Company
  books: Books
  change: Change
  initial: Invoice | null
  onDone: (id: string, invoice: Invoice) => void | Promise<void>
  prefill?: InvoicePrefill
}) {
  const vatRegistered = Boolean(company.vat.trn)
  const base = company.baseCurrency ?? "AED"
  const auto = books.settings.numbering === "auto"
  // A receipt from a client already on the list picks that client.
  const matched = prefill && !prefill.clientId && prefill.clientName ? findParty(books.clients, prefill.clientName) : undefined
  const [clientId, setClientId] = useState(initial?.clientId ?? prefill?.clientId ?? matched?.id ?? "")
  const [addingClient, setAddingClient] = useState(!books.clients.length || Boolean(prefill && !prefill.clientId && !matched && prefill.clientName))
  const [date, setDate] = useState(initial?.date ?? prefill?.date ?? today())
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? (prefill ? prefill.date : addDays(today(), books.settings.paymentDays)))
  const [number, setNumber] = useState(initial?.number ?? (auto ? nextInvoiceNumber(books) : ""))
  const [lines, setLines] = useState<Line[]>(initial?.lines ?? prefill?.lines ?? [blankLine(vatRegistered ? "standard" : "outOfScope")])
  const [fx, setFx] = useState<{ currency: string; rate: number; aedRate?: number }>({ currency: initial?.currency ?? prefill?.currency ?? base, rate: initial?.rate ?? 1, aedRate: initial?.aedRate })
  const [notes, setNotes] = useState(initial?.notes ?? prefill?.notes ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const totals = documentTotals(lines)
  const client = books.clients.find((c) => c.id === clientId)

  async function save() {
    setError("")
    if (!clientId) return setError("Choose the client.")
    if (!number.trim()) return setError("Enter the invoice number.")
    const used = lines.filter((l) => l.quantity && (l.rate || l.item || l.description))
    if (!used.length || totals.total <= 0) return setError("Add at least one line with an amount.")
    if (fx.currency !== base && !(fx.rate > 0)) return setError(`Enter the rate from ${fx.currency} to ${base}.`)
    setSaving(true)
    try {
      const invoice: Invoice = {
        id: initial?.id ?? uid(),
        number: number.trim(),
        date,
        dueDate,
        clientId,
        lines: used,
        notes,
        createdAt: initial?.createdAt ?? new Date().toISOString(),
        currency: fx.currency,
        rate: fx.currency === base ? 1 : fx.rate,
        aedRate: fx.currency === "AED" ? undefined : (fx.aedRate ?? (base === "AED" ? fx.rate : undefined)),
      }
      await change({ action: "invoice", invoice })
      await onDone(invoice.id, invoice)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <p className="note note-info text-sm">
        {vatRegistered
          ? "Your company has a VAT TRN, so this is a tax invoice: your TRN, the client's TRN (if registered) and the VAT on each line are shown."
          : "Your company has no VAT TRN on its profile, so this invoice carries no VAT. Add the TRN on the Dashboard to issue tax invoices."}
      </p>
      {addingClient ? (
        <div className="rounded-xl border p-4">
          {books.clients.length > 0 && (
            <div className="mb-4 space-y-1.5">
              <p className="text-[13px] font-medium">Choose a client already on your list</p>
              <select
                aria-label="Existing client"
                className={selectClass}
                value=""
                onChange={(e) => {
                  if (!e.target.value) return
                  setClientId(e.target.value)
                  setAddingClient(false)
                }}
              >
                <option value="">Choose…</option>
                {books.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="pt-2 text-xs text-muted-foreground">or add a new client:</p>
            </div>
          )}
          <p className="mb-3 font-medium">New client</p>
          <PartyForm
            kind="client"
            initial={prefill?.clientName ? { name: prefill.clientName } : undefined}
            onCancel={() => setAddingClient(false)}
            onSave={async (party) => {
              // Already on the list: use it rather than adding it twice.
              const known = findParty(books.clients, party.name)
              if (known) {
                setClientId(known.id)
                setAddingClient(false)
                return
              }
              await change({ action: "party", kind: "client", party })
              setClientId(party.id)
              setAddingClient(false)
            }}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client" required>
            <select
              className={selectClass}
              value={clientId}
              onChange={(e) => {
                if (e.target.value === "__new") setAddingClient(true)
                else setClientId(e.target.value)
              }}
            >
              <option value="">Choose a client</option>
              {books.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new">+ New client…</option>
            </select>
          </Field>
          <DocumentCurrency base={base} value={fx} date={date} onChange={setFx} label="Invoice currency" />
          {client && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {client.trn ? `TRN ${client.trn}` : "No TRN"}
              {client.email ? ` · ${client.email}` : ""}
              {client.address ? ` · ${client.address}` : ""}
            </p>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Invoice number" required hint={auto && !initial ? "Bayani numbering. Change it in Settings to type your own." : undefined}>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} readOnly={auto && !initial} className={cn(auto && !initial && "bg-muted/50")} />
        </Field>
        <Field label="Invoice date" required>
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              if (!initial) setDueDate(addDays(e.target.value, books.settings.paymentDays))
            }}
          />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <LinesEditor lines={lines} onChange={setLines} items={books.items} vatRegistered={vatRegistered} treatments={VAT_TREATMENTS.filter((t) => t.invoice)} />
      <div className="ml-auto grid max-w-xl gap-4 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">{fx.currency}</p>
          <Row label="Total excluding VAT" value={totals.net} />
          {vatRegistered && <Row label="VAT" value={totals.vat} />}
          <Row label="Total with VAT" value={totals.total} strong />
        </div>
        {fx.currency !== "AED" && (fx.aedRate ?? (base === "AED" ? fx.rate : 0)) > 0 && (
          <div className="space-y-1 rounded-lg bg-muted/40 p-2">
            <p className="text-xs font-semibold text-muted-foreground">AED (shown on the invoice, as UAE law requires)</p>
            <Row label="Total excluding VAT" value={totals.net * (fx.aedRate ?? fx.rate)} />
            {vatRegistered && <Row label="VAT" value={totals.vat * (fx.aedRate ?? fx.rate)} />}
            <Row label="Total with VAT" value={totals.total * (fx.aedRate ?? fx.rate)} strong />
          </div>
        )}
        {fx.currency !== base && base !== "AED" && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Booked in {base}: {aed(totals.total * fx.rate)} at 1 {fx.currency} = {fx.rate} {base}.
          </p>
        )}
      </div>
      <Field label="Notes on the invoice">
        <textarea className="min-h-16 w-full rounded-md border px-3 py-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t bg-white px-5 py-3">
        <Button onClick={() => void save()} disabled={saving || addingClient}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {initial ? "Save changes" : "Create invoice"}
        </Button>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", strong && "border-t pt-1 font-semibold")}>
      <span>{label}</span>
      <span className="tabular-nums">{aed(value)}</span>
    </div>
  )
}

/* ---------------- view ---------------- */

function InvoiceView({ company, books, change, invoice, onClose, onEdit }: { company: Company; books: Books; change: Change; invoice: Invoice; onClose: () => void; onEdit: () => void }) {
  const st = invoiceStatus(books, invoice)
  const cur = invoice.currency ?? company.baseCurrency ?? "AED"
  const client = books.clients.find((c) => c.id === invoice.clientId)
  const payments = books.payments.filter((p) => p.kind === "invoice" && p.docId === invoice.id)
  const notes = books.creditNotes.filter((c) => c.invoiceId === invoice.id)
  const [mode, setMode] = useState<"view" | "pay" | "credit">("view")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const pdfUrl = (kind: "invoice" | "credit", id: string) => `/api/books/pdf?companyId=${company.id}&id=${id}&kind=${kind}`

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setError("")
    try {
      await fn()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.")
    } finally {
      setBusy("")
    }
  }

  async function share() {
    const response = await fetch(pdfUrl("invoice", invoice.id))
    if (!response.ok) throw new Error("The PDF could not be made.")
    const file = new File([await response.blob()], `Invoice-${invoice.number}.pdf`, { type: "application/pdf" })
    const text = `Invoice ${invoice.number} from ${company.name}: ${cur} ${aed(st.due)} due${invoice.dueDate ? ` by ${shortDate(invoice.dueDate)}` : ""}.`
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `Invoice ${invoice.number}`, text })
    else {
      await downloadFile(pdfUrl("invoice", invoice.id), file.name)
      window.location.assign(`mailto:${encodeURIComponent(client?.email ?? "")}?subject=${encodeURIComponent(`Invoice ${invoice.number} from ${company.name}`)}&body=${encodeURIComponent(`${text}\n\nThe invoice is attached.`)}`)
    }
  }

  return (
    <Modal title={`Invoice ${invoice.number}`} onClose={onClose} wide>
      {mode === "pay" ? (
        <PaymentForm
          due={st.due}
          after={invoice.date}
          onCancel={() => setMode("view")}
          onSave={async (payment) => {
            await change({ action: "payment", payment: { ...payment, kind: "invoice", docId: invoice.id } })
            setMode("view")
          }}
        />
      ) : mode === "credit" ? (
        <CreditNoteForm company={company} books={books} invoice={invoice} onCancel={() => setMode("view")} change={change} onDone={() => setMode("view")} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{client?.name}</p>
              <p className="text-sm text-muted-foreground">
                {shortDate(invoice.date)}
                {invoice.dueDate ? ` · due ${shortDate(invoice.dueDate)}` : ""}
              </p>
            </div>
            <div className="text-right">
              <StatusPill status={statusOf(books, invoice)} />
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {cur} {aed(st.due)}
              </p>
              <p className="text-xs text-muted-foreground">due of {aed(st.total)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={Boolean(busy)} onClick={() => run("pdf", () => downloadFile(pdfUrl("invoice", invoice.id), `Invoice-${invoice.number}.pdf`))}>
              {busy === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} PDF
            </Button>
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run("share", share)}>
              {busy === "share" ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />} Share
            </Button>
            {st.due > 0 && (
              <Button size="sm" variant="outline" onClick={() => setMode("pay")}>
                <CreditCard className="size-4" /> Record payment
              </Button>
            )}
            {st.total - st.credited > 0 && (
              <Button size="sm" variant="outline" onClick={() => setMode("credit")}>
                <Undo2 className="size-4" /> Credit note
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--danger)]"
              disabled={Boolean(busy)}
              onClick={() => {
                if (window.confirm(`Delete invoice ${invoice.number}? Its sales, VAT and receivable are removed from your reports.`))
                  void run("delete", async () => {
                    await change({ action: "deleteInvoice", id: invoice.id })
                    onClose()
                  })
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
          {error && <p className="note note-alert text-sm">{error}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Rate</th>
                <th className="py-2 text-right">VAT</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => {
                const t = lineTotals(l)
                return (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="py-2">
                      <span className="font-medium">{l.item || l.description}</span>
                      {l.item && l.description && <span className="block text-xs text-muted-foreground">{l.description}</span>}
                    </td>
                    <td className="py-2 text-right">{l.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{aed(l.rate)}</td>
                    <td className="py-2 text-right tabular-nums">{aed(t.vat)}</td>
                    <td className="py-2 text-right tabular-nums">{aed(t.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(payments.length > 0 || notes.length > 0) && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Payments and credit notes</p>
              <ul className="divide-y rounded-xl border text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      {shortDate(p.date)} · {p.method === "bankLine" ? `Bank statement: ${p.bankLine?.description.slice(0, 60)}` : p.method === "cash" ? "Cash" : p.method === "card" ? "Card" : "Bank transfer"}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">{aed(p.amount)}</span>
                      <Button size="icon" variant="ghost" aria-label="Remove payment" onClick={() => run("rm", () => change({ action: "deletePayment", id: p.id }))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </span>
                  </li>
                ))}
                {notes.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      {shortDate(n.date)} · Credit note {n.number}
                      {n.reason ? ` · ${n.reason}` : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="font-medium tabular-nums">({aed(documentTotals(n.lines).total)})</span>
                      <Button size="icon" variant="ghost" aria-label="Download credit note" onClick={() => run("cn", () => downloadFile(pdfUrl("credit", n.id), `Credit-Note-${n.number}.pdf`))}>
                        <Download className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Delete credit note" onClick={() => window.confirm(`Delete credit note ${n.number}?`) && run("rm", () => change({ action: "deleteCreditNote", id: n.id }))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {st.due > 0 && <p className="text-xs text-muted-foreground">Upload bank statements in Data Input: a receipt of this amount or naming this client is offered as a match, and linking it marks the invoice paid.</p>}
        </div>
      )}
    </Modal>
  )
}

export function PaymentForm({
  due,
  after,
  onSave,
  onCancel,
}: {
  due: number
  after: string
  onSave: (payment: { id: string; date: string; amount: number; method: "bank" | "cash" | "card"; bankLine: null; note: string }) => Promise<void>
  onCancel: () => void
}) {
  const [date, setDate] = useState(today() < after ? after : today())
  const [amount, setAmount] = useState(String(due))
  const [method, setMethod] = useState<"bank" | "cash" | "card">("bank")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        const value = round2(Number(amount.replace(/,/g, "")))
        if (!(value > 0)) return setError("Enter the amount.")
        setSaving(true)
        setError("")
        try {
          await onSave({ id: uid(), date, amount: value, method, bankLine: null, note })
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save.")
        } finally {
          setSaving(false)
        }
      }}
    >
      <p className="note note-info text-sm">For money that will not appear on an uploaded bank statement. Payments on a statement are linked from Data Input, so they are not counted twice.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date">
          <Input type="date" value={date} min={after} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Paid by">
          <select className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="bank">Bank transfer / cheque</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
          </select>
        </Field>
      </div>
      <Field label="Note">
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />} Save payment
        </Button>
      </div>
    </form>
  )
}

function CreditNoteForm({ company, books, invoice, change, onCancel, onDone }: { company: Company; books: Books; invoice: Invoice; change: Change; onCancel: () => void; onDone: () => void }) {
  const vatRegistered = Boolean(company.vat.trn)
  const st = invoiceStatus(books, invoice)
  const [lines, setLines] = useState<Line[]>(invoice.lines.map((l) => ({ ...l, id: uid() })))
  const [date, setDate] = useState(today() < invoice.date ? invoice.date : today())
  const [reason, setReason] = useState("")
  const [number, setNumber] = useState(nextCreditNumber(books))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const total = documentTotals(lines).total
  return (
    <div className="space-y-4">
      <p className="note note-info text-sm">
        A credit note reduces this invoice: sales, the VAT due and what the client owes all fall by its amount. Up to {invoice.currency ?? company.baseCurrency ?? "AED"} {aed(st.total - st.credited)} can still be credited. Edit the lines to credit part of the invoice.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Credit note number">
          <Input value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" min={invoice.date} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Reason">
          <Input value={reason} placeholder="Discount, return, error…" onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <LinesEditor lines={lines} onChange={setLines} items={books.items} vatRegistered={vatRegistered} treatments={VAT_TREATMENTS.filter((t) => t.invoice)} />
      <p className="text-right text-sm font-semibold">
        Credit {invoice.currency ?? company.baseCurrency ?? "AED"} {aed(total)}
      </p>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Back
        </Button>
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            setError("")
            try {
              await change({ action: "creditNote", creditNote: { id: uid(), number: number.trim(), date, invoiceId: invoice.id, lines: lines.filter((l) => l.quantity && l.rate), reason, createdAt: new Date().toISOString() } })
              onDone()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not save.")
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving && <Loader2 className="size-4 animate-spin" />} Issue credit note
        </Button>
      </div>
    </div>
  )
}

/* ---------------- customers and settings ---------------- */

function Customers({ books, change, onShow, base }: { books: Books; change: Change; onShow: (id: string) => void; base: string }) {
  const [editing, setEditing] = useState<string | null>(null)
  const rows = books.clients
    .map((c) => {
      const mine = books.invoices.filter((i) => i.clientId === c.id)
      const t = mine.reduce((s, i) => {
        const st = invoiceStatus(books, i)
        const r = i.rate ?? 1
        return { invoiced: s.invoiced + (st.total - st.credited) * r, paid: s.paid + st.paid * r, due: s.due + st.due * r }
      }, { invoiced: 0, paid: 0, due: 0 })
      return { c, count: mine.length, ...t }
    })
    .sort((a, b) => b.due - a.due || a.c.name.localeCompare(b.c.name))
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b p-4">
        <p className="flex items-center gap-2 font-semibold">
          <Users className="size-4" /> Customers and balances
        </p>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add client
        </Button>
      </div>
      {rows.length ? (
        <ul className="divide-y">
          {rows.map(({ c, count, invoiced, paid, due }) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.trn ? `TRN ${c.trn} · ` : ""}
                  {count} invoice{count === 1 ? "" : "s"} · invoiced {aed(invoiced)} · received {aed(paid)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("font-semibold tabular-nums", due > 0 && "text-[var(--cobalt)]")}>{base} {aed(due)}</span>
                <Button size="sm" variant="outline" onClick={() => onShow(c.id)}>
                  Invoices
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c.id)}>
                  <Pencil className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-8 text-center text-sm text-muted-foreground">Clients are added once, the first time you invoice them.</p>
      )}
      {editing && (
        <Modal title={editing === "new" ? "Add client" : "Edit client"} onClose={() => setEditing(null)}>
          <PartyForm
            kind="client"
            initial={books.clients.find((c) => c.id === editing)}
            onCancel={() => setEditing(null)}
            onSave={async (party) => {
              await change({ action: "party", kind: "client", party })
              setEditing(null)
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function InvoiceSettings({ company, books, change }: { company: Company; books: Books; change: Change }) {
  const [s, setS] = useState<BooksSettings>(books.settings)
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle")
  const [error, setError] = useState("")
  const set = <K extends keyof BooksSettings>(k: K, v: BooksSettings[K]) => {
    setS((x) => ({ ...x, [k]: v }))
    setState("idle")
  }
  const setBank = (k: keyof BooksSettings["bank"], v: string) => {
    setS((x) => ({ ...x, bank: { ...x.bank, [k]: v } }))
    setState("idle")
  }
  const preview = useMemo(() => `${s.prefix}${s.nextNumber}`, [s.prefix, s.nextNumber])
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="panel space-y-4 p-5">
        <p className="flex items-center gap-2 font-semibold">
          <Building2 className="size-4" /> On every invoice
        </p>
        <div className="flex items-center gap-3 rounded-xl border p-3">
          {company.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/companies/logo?id=${company.id}&v=${encodeURIComponent(company.logo.updatedAt)}`} alt="" className="h-10 w-20 object-contain" />
          ) : (
            <span className="flex h-10 w-20 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">No logo</span>
          )}
          <p className="text-sm text-muted-foreground">
            Logo, company name and TRN come from the{" "}
            <Link href="/dashboard" className="font-medium text-[var(--cobalt)] underline">
              company profile
            </Link>
            .
          </p>
        </div>
        <Field label="Address">
          <textarea className="min-h-16 w-full rounded-md border px-3 py-2 text-sm" value={s.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <Input value={s.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={s.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
        </div>
        <Field label="Footer line" hint="For example your terms or a thank-you line">
          <Input value={s.footer} onChange={(e) => set("footer", e.target.value)} />
        </Field>
      </div>
      <div className="panel space-y-4 p-5">
        <p className="font-semibold">Bank details for payment</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Account name">
            <Input value={s.bank.accountName} onChange={(e) => setBank("accountName", e.target.value)} />
          </Field>
          <Field label="Bank">
            <Input value={s.bank.bankName} onChange={(e) => setBank("bankName", e.target.value)} />
          </Field>
          <Field label="IBAN">
            <Input value={s.bank.iban} onChange={(e) => setBank("iban", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Account number">
            <Input value={s.bank.accountNumber} onChange={(e) => setBank("accountNumber", e.target.value)} />
          </Field>
          <Field label="SWIFT">
            <Input value={s.bank.swift} onChange={(e) => setBank("swift", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Payment terms (days)">
            <Input inputMode="numeric" value={String(s.paymentDays)} onChange={(e) => set("paymentDays", Math.min(365, Math.max(0, Number(e.target.value) || 0)))} />
          </Field>
        </div>
        <p className="pt-2 font-semibold">Invoice numbers</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["auto", "Bayani numbering", `Next: ${preview}`],
              ["manual", "I type my own", "Any number, checked for repeats"],
            ] as const
          ).map(([key, title, text]) => (
            <label key={key} className={cn("tile cursor-pointer p-3", s.numbering === key && "tile-active")}>
              <input type="radio" className="sr-only" checked={s.numbering === key} onChange={() => set("numbering", key)} />
              <span className="block text-sm font-semibold">{title}</span>
              <span className="text-xs text-muted-foreground">{text}</span>
            </label>
          ))}
        </div>
        {s.numbering === "auto" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prefix">
              <Input value={s.prefix} onChange={(e) => set("prefix", e.target.value)} />
            </Field>
            <Field label="Next number">
              <Input inputMode="numeric" value={String(s.nextNumber)} onChange={(e) => set("nextNumber", Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </Field>
          </div>
        )}
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end">
          <Button
            disabled={state === "saving"}
            onClick={async () => {
              setState("saving")
              setError("")
              try {
                await change({ action: "settings", settings: s })
                setState("saved")
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not save.")
                setState("idle")
              }
            }}
          >
            {state === "saving" && <Loader2 className="size-4 animate-spin" />}
            {state === "saved" ? "Saved" : "Save settings"}
          </Button>
        </div>
      </div>
    </div>
  )
}
