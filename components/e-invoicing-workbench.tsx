"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, BadgeCheck, CalendarClock, CheckCircle2, ExternalLink, Gavel, Loader2, Network, Send, ShieldCheck } from "lucide-react"

import { Field, aed, selectClass, shortDate, today } from "@/components/books-shared"
import { CompanyPicker, Loading, NoData, useTaxData } from "@/components/tax-workbench"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Books } from "@/lib/books"
import { PENALTIES, RULES, SOURCES, THRESHOLD, WAVES, assess, type AspRequest } from "@/lib/e-invoicing"
import { scheduleValue } from "@/lib/financial-statements"
import { fetchRate } from "@/lib/fx"
import { cn } from "@/lib/utils"

export function EInvoicingWorkbench() {
  const data = useTaxData()
  const { company, companyRecords } = data
  const [books, setBooks] = useState<Books | null>(null)
  const [requests, setRequests] = useState<AspRequest[]>([])

  useEffect(() => {
    if (!company) return
    fetch(`/api/books?companyId=${company.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.books && setBooks(d.books))
      .catch(() => {})
    fetch("/api/e-invoicing", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.requests && setRequests(d.requests))
      .catch(() => {})
  }, [company])

  // The latest year with sales (a year made only of a schedule's last months has none).
  const latest = useMemo(() => [...companyRecords].sort((a, b) => b.year - a.year).find((r) => scheduleValue(r.statements, "sales") !== 0), [companyRecords])
  // The threshold is in AED: revenue in another base currency is converted at the year's average rate.
  const [aedPer, setAedPer] = useState(1)
  const base = company?.baseCurrency ?? "AED"
  useEffect(() => {
    if (base === "AED" || !latest) return
    fetchRate(base, "AED", `${latest.year}-12-31`, `${latest.year}-01-01`)
      .then((q) => setAedPer(q.rate || 1))
      .catch(() => {})
  }, [base, latest])
  const revenue = latest ? Math.abs(scheduleValue(latest.statements, "sales")) * (base === "AED" ? 1 : aedPer) : null
  const now = today()
  const a = assess(revenue, now)
  // Last 12 months of documents, as a starting point for the quote.
  const yearAgo = `${Number(now.slice(0, 4)) - 1}${now.slice(4)}`
  const invoices = books?.invoices.filter((i) => i.date >= yearAgo).length ?? 0
  const bills = books?.bills.filter((b) => b.date >= yearAgo).length ?? 0

  if (data.loading) return <Loading />
  if (!company) return <NoData title="No company yet" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Company</p>
          <p className="mt-1 text-lg font-semibold">{company.name}</p>
        </div>
        <CompanyPicker companies={data.companies} companyId={data.companyId} onChange={data.setCompanyId} />
      </div>

      <div className={cn("note items-start", a.level === "alert" ? "note-alert" : a.level === "warning" ? "note-warning" : "note-info")}>
        {a.level === "info" ? <CalendarClock className="mt-0.5 size-5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0" />}
        <div className="space-y-1 text-sm">
          {a.wave ? (
            <>
              <p className="font-semibold">
                {company.name}: revenue of AED {aed(revenue!)} in {latest!.year}, {revenue! >= THRESHOLD ? "AED 50 million or more" : "below AED 50 million"}.
              </p>
              <p>
                Appoint an accredited service provider by <strong>{shortDate(a.wave.asp)}</strong>
                {a.aspDays! >= 0 ? ` (${a.aspDays} days left)` : ` (${-a.aspDays!} days ago: a penalty of AED 5,000 a month applies until one is appointed)`}. E-invoicing becomes mandatory on{" "}
                <strong>{shortDate(a.wave.live)}</strong>
                {a.liveDays! >= 0 ? ` (${a.liveDays} days)` : ""}.
              </p>
              {revenue! < THRESHOLD && revenue! > THRESHOLD * 0.8 && <p>Revenue is close to AED 50 million. If it passes the threshold, the earlier dates apply.</p>}
            </>
          ) : (
            <p>Save a year of figures in Data Input to see which deadlines apply to {company.name}. Businesses with revenue of AED 50 million or more go first.</p>
          )}
          {books && (
            <p className="text-xs opacity-80">
              Last 12 months in Bayani: {invoices} invoice{invoices === 1 ? "" : "s"} and {bills} bill{bills === 1 ? "" : "s"}. Once e-invoicing applies, each B2B invoice and credit note must also go through your provider.
            </p>
          )}
        </div>
      </div>

      <section className="panel p-5">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
          <CalendarClock className="size-5 text-[var(--cobalt)]" /> Deadlines
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {WAVES.map((w) => (
            <div key={w.key} className={cn("tile p-4", a.wave?.key === w.key && "tile-active")}>
              <p className="text-sm font-semibold">{w.label}</p>
              <p className="mt-2 text-xs text-muted-foreground">Appoint an ASP by</p>
              <p className="font-medium">{shortDate(w.asp)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Mandatory from</p>
              <p className="font-medium">{shortDate(w.live)}</p>
              {a.wave?.key === w.key && <p className="mt-2 text-xs font-semibold text-[var(--cobalt)]">Applies to you</p>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Voluntary adoption has been open since 1 July 2026. Revenue is based on the latest saved year; the FTA may refer to a specific period, so confirm with your provider.</p>
      </section>

      <section className="panel p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
          <ShieldCheck className="size-5 text-[var(--lagoon)]" /> The rules
        </h2>
        <ul className="space-y-2 text-sm">
          {RULES.map((r) => (
            <li key={r} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--lagoon)]" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel overflow-hidden">
        <h2 className="flex items-center gap-2 border-b p-5 font-display text-lg font-semibold">
          <Gavel className="size-5 text-[var(--danger)]" /> Fines and penalties
        </h2>
        <ul className="divide-y text-sm">
          {PENALTIES.map((p) => (
            <li key={p.what} className="grid gap-1 px-5 py-3 sm:grid-cols-[1fr_16rem] sm:gap-4">
              <span>{p.what}</span>
              <span className="font-semibold sm:text-right">{p.amount}</span>
            </li>
          ))}
        </ul>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">Cabinet Decision 106 of 2025. Ministerial Decisions 243 and 244 of 2025, amended by Ministerial Decision 66 of 2026.</p>
      </section>

      <AspRequestForm companyId={company.id} invoices={invoices} bills={bills} requests={requests} onSent={(r) => setRequests((x) => [r, ...x])} />

      <section className="text-xs text-muted-foreground">
        <p className="mb-1 font-medium">Sources</p>
        <ul className="space-y-1">
          {SOURCES.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                {s.title} <ExternalLink className="size-3" />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function AspRequestForm({ companyId, invoices, bills, requests, onSent }: { companyId: string; invoices: number; bills: number; requests: AspRequest[]; onSent: (r: AspRequest) => void }) {
  const [invoicesPerYear, setInvoices] = useState("")
  const [billsPerYear, setBills] = useState("")
  const [integration, setIntegration] = useState<"system" | "manual">("manual")
  const [software, setSoftware] = useState("")
  const [contact, setContact] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [notes, setNotes] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const sent = requests[0]
  return (
    <section className="panel p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Network className="size-5 text-[var(--cobalt)]" /> Enrol with an accredited service provider
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Tell us your volumes and how you invoice today, and get quotes from FTA-accredited providers.</p>
      {sent && (
        <p className="note note-good mt-4 text-sm">
          <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          Quote request sent {shortDate(sent.createdAt.slice(0, 10))}: {sent.invoicesPerYear.toLocaleString()} invoices and {sent.billsPerYear.toLocaleString()} bills a year, {sent.integration === "system" ? "system integration" : "manual / portal"}. You can send another below.
        </p>
      )}
      <form
        className="mt-4 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setSending(true)
          setError("")
          try {
            const response = await fetch("/api/e-invoicing", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                companyId,
                invoicesPerYear: Math.round(Number(invoicesPerYear || invoices) || 0),
                billsPerYear: Math.round(Number(billsPerYear || bills) || 0),
                integration,
                software,
                contact,
                email,
                phone,
                notes,
              }),
            })
            const d = await response.json()
            if (!response.ok) throw new Error(d.error)
            onSent(d.request)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not send.")
          } finally {
            setSending(false)
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sales invoices a year" hint={`Bayani has ${invoices} in the last 12 months`}>
            <Input inputMode="numeric" placeholder={String(invoices)} value={invoicesPerYear} onChange={(e) => setInvoices(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Purchase bills a year" hint={`Bayani has ${bills} in the last 12 months`}>
            <Input inputMode="numeric" placeholder={String(bills)} value={billsPerYear} onChange={(e) => setBills(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["system", "System integration", "Your accounting or ERP system sends invoices to the provider automatically (API)."],
              ["manual", "Manual", "You enter or upload invoices on the provider's portal."],
            ] as const
          ).map(([key, title, text]) => (
            <label key={key} className={cn("tile cursor-pointer p-3", integration === key && "tile-active")}>
              <input type="radio" className="sr-only" checked={integration === key} onChange={() => setIntegration(key)} />
              <span className="block text-sm font-semibold">{title}</span>
              <span className="text-xs text-muted-foreground">{text}</span>
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Accounting software today">
            <select className={selectClass} value={software} onChange={(e) => setSoftware(e.target.value)}>
              <option value="">Choose</option>
              {["Bayani", "Zoho Books", "QuickBooks", "Xero", "Tally", "Odoo", "SAP", "Microsoft Dynamics", "Excel / Word", "Other"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Contact name" required>
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field label="Email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Anything else">
          <textarea className="min-h-16 w-full rounded-md border px-3 py-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={sending}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Get quotes
          </Button>
        </div>
      </form>
    </section>
  )
}
