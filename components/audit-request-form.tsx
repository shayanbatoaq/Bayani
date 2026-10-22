"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Building2, Check, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, Landmark, Loader2, Mail, Phone, Send, ShieldCheck, Target } from "lucide-react"

import { CompanyPicker, Loading, NoData, useTaxData } from "@/components/tax-workbench"
import { Button } from "@/components/ui/button"
import { AUDIT_PURPOSES, auditRequestInputSchema, auditYearOptions, contactKind, type AuditRequest } from "@/lib/audit-request"
import { cn } from "@/lib/utils"

const PURPOSE_HINT: Record<(typeof AUDIT_PURPOSES)[number], string> = {
  "License renewal": "Audited accounts requested by the licensing authority or free zone",
  "Corporate Tax": "Required where revenue exceeds AED 50 million or for a Qualifying Free Zone Person",
  "Management review": "Independent assurance for owners and management",
  "Bank Facility": "Audited statements for a loan, overdraft or credit line",
  Others: "Tell us what the audit is for",
}

export function AuditRequestForm() {
  const data = useTaxData()
  const { company, companyRecords } = data
  const [years, setYears] = useState<number[]>([])
  const [purpose, setPurpose] = useState<string>("")
  const [otherPurpose, setOtherPurpose] = useState("")
  const [contact, setContact] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<AuditRequest | null>(null)
  const [history, setHistory] = useState<AuditRequest[]>([])

  const options = useMemo(() => auditYearOptions(companyRecords.map((r) => r.year)), [companyRecords])
  const saved = useMemo(() => new Set(companyRecords.map((r) => r.year)), [companyRecords])

  useEffect(() => {
    fetch("/api/audit-requests", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => setHistory(body.requests ?? []))
      .catch(() => undefined)
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!company) return
    setError("")
    const parsed = auditRequestInputSchema.safeParse({ companyId: company.id, years, purpose: purpose || undefined, otherPurpose, contact, notes })
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    setSending(true)
    try {
      const response = await fetch("/api/audit-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "The request could not be sent.")
      setDone(body.request)
      setHistory((list) => [body.request, ...list])
      setYears([])
      setPurpose("")
      setOtherPurpose("")
      setNotes("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be sent.")
    } finally {
      setSending(false)
    }
  }

  if (data.loading) return <Loading />
  if (!company) return <NoData title="No company yet" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />

  const kind = contact ? contactKind(contact.trim()) : null
  return (
    <div className="grid gap-6 pb-24 xl:grid-cols-[1.4fr_1fr]">
      <form onSubmit={submit} className="panel space-y-6 p-5 sm:p-7" noValidate>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-[var(--cobalt)] to-[var(--lagoon)] text-white">
              <ClipboardCheck className="size-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold">Request an audit quote</h2>
              <p className="text-sm text-muted-foreground">{company.name}</p>
            </div>
          </div>
          <CompanyPicker companies={data.companies} companyId={data.companyId} onChange={data.setCompanyId} />
        </header>

        {done && (
          <div className="note note-good flex items-start gap-3 text-sm" role="status">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>
              Request received for {done.years.join(", ")} ({done.purpose === "Others" ? done.otherPurpose : done.purpose}). The audit team will send a quotation to {done.contact}.
            </span>
          </div>
        )}

        <Field step={1} label="Year of audit" hint="Select one or more financial years">
          <YearSelect options={options} saved={saved} value={years} onChange={setYears} />
        </Field>

        <Field step={2} label="Purpose of audit">
          <div className="relative">
            <Target className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <select className="h-11 w-full appearance-none rounded-xl border bg-white pl-9 pr-9 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Purpose of audit">
              <option value="">Select a purpose</option>
              {AUDIT_PURPOSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {purpose && <p className="mt-1.5 text-xs text-muted-foreground">{PURPOSE_HINT[purpose as keyof typeof PURPOSE_HINT]}</p>}
          {purpose === "Others" && (
            <input className="mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm" placeholder="Purpose of the audit" maxLength={200} value={otherPurpose} onChange={(e) => setOtherPurpose(e.target.value)} aria-label="Other purpose" />
          )}
        </Field>

        <Field step={3} label="Contact number or email" hint="Where the quotation should be sent">
          <div className="relative">
            {kind === "email" ? <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /> : <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
            <input className="h-11 w-full rounded-xl border bg-white pl-9 pr-3 text-sm" placeholder="+971 50 123 4567 or name@company.ae" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} aria-label="Contact number or email" autoComplete="email" />
          </div>
        </Field>

        <Field step={4} label="Anything else" hint="Optional">
          <textarea className="min-h-20 w-full rounded-xl border bg-white px-3 py-2 text-sm" maxLength={1000} placeholder="Deadline, group structure, previous auditor..." value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
        </Field>

        {error && (
          <p className="note note-alert text-sm" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={sending} className="w-full sm:w-auto">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Request quote
        </Button>
      </form>

      <aside className="space-y-5">
        <section className="insight-panel space-y-4 p-5 text-white">
          <h3 className="font-display font-semibold">What happens next</h3>
          {[
            { icon: Send, text: "Your request reaches the audit team with the company details already on file." },
            { icon: Building2, text: "They review the size of the business from the figures you have saved." },
            { icon: Clock3, text: "A quotation is sent to the phone number or email you give." },
            { icon: ShieldCheck, text: "The request is kept with your company records so you can track it here." },
          ].map((item, i) => (
            <div key={i} className="flex gap-3 text-sm text-white/80">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/10">
                <item.icon className="size-4" />
              </span>
              {item.text}
            </div>
          ))}
        </section>
        <section className="panel p-5">
          <h3 className="mb-3 flex items-center gap-2 font-display font-semibold">
            <Landmark className="size-4 text-[var(--cobalt)]" /> Your requests
          </h3>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {history.slice(0, 8).map((item) => (
                <li key={item.id} className="rounded-2xl border bg-secondary/30 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.companyName}</span>
                    <span className="rounded-full bg-[var(--cobalt-wash)] px-2 py-0.5 text-[10px] font-semibold text-[var(--cobalt)]">{item.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.years.join(", ")} · {item.purpose === "Others" ? item.otherPurpose : item.purpose} · {new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  )
}

function Field({ step, label, hint, children }: { step: number; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--ink)] font-display text-xs font-semibold text-white">{step}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
        {!hint && <div className="mb-2" />}
        {children}
      </div>
    </div>
  )
}

/** Multi-select dropdown of financial years. */
function YearSelect({ options, saved, value, onChange }: { options: number[]; saved: Set<number>; value: number[]; onChange: (years: number[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])
  const toggle = (year: number) => onChange(value.includes(year) ? value.filter((y) => y !== year) : [...value, year].sort((a, b) => a - b))
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-left text-sm">
        {value.length === 0 ? (
          <span className="text-muted-foreground">Select years</span>
        ) : (
          value.map((year) => (
            <span key={year} className="inline-flex items-center gap-1 rounded-full bg-[var(--cobalt-wash)] px-2.5 py-0.5 text-xs font-semibold text-[var(--cobalt)]">
              {year}
            </span>
          ))
        )}
        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul role="listbox" aria-multiselectable="true" aria-label="Year of audit" className="absolute z-20 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border bg-white p-1.5 shadow-lg">
          {options.map((year) => {
            const selected = value.includes(year)
            return (
              <li key={year}>
                <button type="button" role="option" aria-selected={selected} onClick={() => toggle(year)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-secondary", selected && "bg-[var(--cobalt-wash)]")}>
                  <span className={cn("grid size-4 place-items-center rounded border", selected ? "border-[var(--cobalt)] bg-[var(--cobalt)] text-white" : "bg-white")}>{selected && <Check className="size-3" />}</span>
                  <span className="flex-1 text-left">Financial year {year}</span>
                  {saved.has(year) && <span className="text-[10px] text-muted-foreground">figures saved</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
