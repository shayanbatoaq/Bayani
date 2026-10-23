"use client"

import { useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Info,
  Loader2,
  Lightbulb,
  PencilLine,
  RefreshCw,
  Save,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react"

import { CompanyPicker, Loading, NoData, useTaxData } from "@/components/tax-workbench"
import { VatReturnBuilder } from "@/components/vat-return-builder"
import { Button } from "@/components/ui/button"
import { monthNames } from "@/lib/company"
import { readDocument, type ReadProgress } from "@/lib/document-reader"
import {
  BOXES,
  analyse,
  filingFor,
  parseVat201,
  readFilings,
  taxYearStartMonth,
  totals,
  vatYears,
  withTotals,
  type BoxKey,
  type Column,
  type Insight,
  type VatFiling,
  type VatPeriodSlot,
  type VatSettings,
} from "@/lib/vat-filings"
import { cn } from "@/lib/utils"

const aed = (n: number | undefined) => (Math.round((n ?? 0) * 100) / 100 || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = (n: number) => Math.round(n).toLocaleString("en-US")
const dmy = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "")
const today = () => new Date().toISOString().slice(0, 10)

export function VatWorkbench() {
  const data = useTaxData()
  const { company, setCompanies } = data
  const [yearKey, setYearKey] = useState("")
  const [slotId, setSlotId] = useState("")
  const [draft, setDraft] = useState<{ slotId: string; filing: VatFiling; warnings: string[] } | null>(null)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  const filings = useMemo(() => readFilings(company?.vatFilings), [company])
  const settings: VatSettings = useMemo(() => company?.vatSettings ?? {}, [company])
  const years = useMemo(() => (company ? vatYears(company, settings, filings) : []), [company, settings, filings])
  const year = years.find((y) => y.key === yearKey) ?? years.at(-1)
  const analysis = useMemo(() => (company && year ? analyse(company, years, filings, year.key) : null), [company, years, filings, year])
  const slot = year?.periods.find((p) => p.id === slotId) ?? year?.periods.find((p) => p.registered && !filingFor(p, filings) && p.end < today()) ?? year?.periods.find((p) => p.registered) ?? year?.periods[0]

  async function persist(patch: { vatFilings?: Record<string, VatFiling>; vatSettings?: VatSettings }) {
    if (!company) return false
    setError("")
    const response = await fetch("/api/companies/extras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: company.id, ...patch }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body.error ?? "Could not save.")
      return false
    }
    setCompanies((list) => list.map((item) => (item.id === company.id ? body.company : item)))
    return true
  }

  if (data.loading) return <Loading />
  if (!company) return <NoData title="No company yet" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />
  if (!company.vat.trn)
    return <NoData title="Not VAT registered" text="Add the VAT TRN, effective date and return period from the VAT certificate on the Dashboard to keep your VAT returns here." href="/dashboard" action="Update company" />
  if (!year || !slot) return null

  const filing = filingFor(slot, filings)
  const startMonth = taxYearStartMonth(company, settings)

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3 text-sm">
          <Fact label="Company" value={company.name} />
          <Fact label="VAT TRN" value={company.vat.trn} />
          <Fact label="Returns" value={company.vat.frequency === "monthly" ? "Monthly" : "Quarterly"} />
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Tax year starts in</span>
            <select
              className="h-9 rounded-lg border bg-card px-2 text-sm font-medium"
              value={startMonth}
              onChange={async (e) => {
                setBusy("settings")
                await persist({ vatSettings: { taxYearStartMonth: Number(e.target.value) } })
                setBusy("")
                setYearKey("")
                setSlotId("")
              }}
            >
              {monthNames.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <CompanyPicker companies={data.companies} companyId={data.companyId} onChange={data.setCompanyId} />
      </div>

      <div role="tablist" aria-label="Tax year" className="track">
        {years.map((y) => (
          <button
            key={y.key}
            role="tab"
            type="button"
            aria-selected={y.key === year.key}
            className="track-item"
            onClick={() => {
              setYearKey(y.key)
              setSlotId("")
              setDraft(null)
            }}
          >
            {y.label}
          </button>
        ))}
      </div>

      {analysis && <Insights analysis={analysis} yearLabel={year.label} />}

      <div className={cn("grid gap-3", year.periods.length > 4 ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" : "grid-cols-2 lg:grid-cols-4")}>
        {year.periods.map((p) => (
          <QuarterTile
            key={p.id}
            slot={p}
            filing={filingFor(p, filings)}
            active={p.id === slot.id}
            onClick={() => {
              setSlotId(p.id)
              setDraft(null)
              setError("")
            }}
          />
        ))}
      </div>

      <section className="panel space-y-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">{slot.label}</h2>
            <p className="text-sm text-muted-foreground">
              {dmy(slot.start)} – {dmy(slot.end)} · due {dmy(slot.dueDate)}
            </p>
          </div>
          {filing && !draft && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft({ slotId: slot.id, filing, warnings: [] })}>
                <PencilLine className="size-4" /> Edit
              </Button>
              <UploadButton
                label="Replace"
                icon={<RefreshCw className="size-4" />}
                onRead={(parsed) => setDraft({ slotId: slot.id, ...prepare(parsed, slot) })}
                onError={setError}
              />
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={busy === "delete"}
                onClick={async () => {
                  setBusy("delete")
                  const next = { ...filings }
                  for (const [id, f] of Object.entries(next)) if (id === slot.id || f.periodEnd === slot.end) delete next[id]
                  await persist({ vatFilings: next })
                  setBusy("")
                }}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          )}
        </div>

        {!slot.registered && <p className="text-sm text-muted-foreground">The company was not yet VAT registered in this period.</p>}

        {slot.registered && !draft && (
          <VatReturnBuilder
            key={slot.id}
            company={company}
            slot={slot}
            periods={years.flatMap((y) => y.periods)}
            onUse={(prepared) => setDraft({ slotId: slot.id, filing: { ...prepared, ...(filing ? { reference: filing.reference, submittedOn: filing.submittedOn } : {}) }, warnings: filing ? ["These figures replace the saved return for this period when you save."] : [] })}
          />
        )}

        {slot.registered && !filing && !draft && (
          <div className="grid gap-4 md:grid-cols-2">
            <UploadZone onRead={(parsed) => setDraft({ slotId: slot.id, ...prepare(parsed, slot) })} onError={setError} />
            <button
              type="button"
              onClick={() => setDraft({ slotId: slot.id, filing: emptyFiling(slot), warnings: [] })}
              className="choice group"
            >
              <PencilLine className="size-7 text-primary" strokeWidth={1.5} />
              <span className="font-display text-lg font-semibold">Enter manually</span>
              <span className="text-sm text-muted-foreground">Type the figures from your VAT 201 return into the form.</span>
            </button>
          </div>
        )}

        {draft && draft.slotId === slot.id && (
          <FilingForm
            initial={draft.filing}
            warnings={draft.warnings}
            saving={busy === "save"}
            onCancel={() => setDraft(null)}
            onSave={async (f) => {
              setBusy("save")
              const next = { ...filings }
              for (const [id, old] of Object.entries(next)) if (id === slot.id || old.periodEnd === slot.end) delete next[id]
              next[slot.id] = { ...withTotals(f), savedAt: new Date().toISOString() }
              if (await persist({ vatFilings: next })) setDraft(null)
              setBusy("")
            }}
          />
        )}

        {filing && !draft && <FilingView filing={filing} />}
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </section>
    </div>
  )
}

function prepare(parsed: ReturnType<typeof parseVat201> & { filename: string }, slot: VatPeriodSlot) {
  const warnings = [...parsed.warnings]
  if (parsed.filing.periodEnd && parsed.filing.periodEnd !== slot.end)
    warnings.unshift(`This file is the return for ${dmy(parsed.filing.periodStart)} – ${dmy(parsed.filing.periodEnd)}, not ${slot.label}. Check you picked the right quarter.`)
  return {
    filing: {
      ...parsed.filing,
      source: "upload" as const,
      filename: parsed.filename,
      periodStart: parsed.filing.periodStart ?? slot.start,
      periodEnd: parsed.filing.periodEnd ?? slot.end,
    } as VatFiling,
    warnings,
  }
}

function emptyFiling(slot: VatPeriodSlot): VatFiling {
  return { periodStart: slot.start, periodEnd: slot.end, source: "manual", profitMarginScheme: false, boxes: {} }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  )
}

function QuarterTile({ slot, filing, active, onClick }: { slot: VatPeriodSlot; filing: VatFiling | null; active: boolean; onClick: () => void }) {
  const t = filing ? totals(filing) : null
  const overdue = slot.registered && !filing && slot.dueDate < today()
  const open = slot.registered && !filing && slot.end >= today()
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("tile text-left", active && "tile-active")}>
      <span className="block font-display text-[15px] font-semibold">{slot.label}</span>
      <span className="mt-2 flex items-center gap-1.5 text-xs">
        {!slot.registered ? (
          <span className="text-muted-foreground">Not registered</span>
        ) : filing ? (
          <>
            <CheckCircle2 className="size-3.5 text-[var(--lagoon)]" />
            {filing.source === "upload" ? "Return uploaded" : "Entered"}
          </>
        ) : overdue ? (
          <>
            <AlertTriangle className="size-3.5 text-[var(--saffron)]" /> Not recorded · due {dmy(slot.dueDate)}
          </>
        ) : open ? (
          <span className="text-muted-foreground">Period in progress</span>
        ) : (
          <span className="text-muted-foreground">Due {dmy(slot.dueDate)}</span>
        )}
      </span>
      {t && (
        <span className="mt-3 block font-display text-lg font-semibold tabular-nums">
          {t.payable >= 0 ? "" : "−"}AED {whole(Math.abs(t.payable))}
          <span className="ml-1 text-xs font-normal text-muted-foreground">{t.payable >= 0 ? "payable" : "refund"}</span>
        </span>
      )}
    </button>
  )
}

function Insights({ analysis, yearLabel }: { analysis: NonNullable<ReturnType<typeof analyse>>; yearLabel: string }) {
  const max = Math.max(1, ...analysis.series.map((s) => s.sales))
  const t = analysis.yearTotals
  const s12 = analysis.taxableSupplies12m
  const scaleMax = Math.max(500_000, (s12 ?? 0) * 1.15)
  const pos = (n: number) => `${Math.min(100, (n / scaleMax) * 100)}%`
  return (
    <section className="insight-panel grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-[13px] font-medium text-subtle-foreground">
          <Lightbulb className="size-4" /> VAT insights · {yearLabel}
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ["Taxable supplies", t.taxableSupplies],
              ["VAT due", t.outputVat],
              ["VAT recovered", t.recoverable],
              [t.net >= 0 ? "Net VAT paid" : "Net refund", Math.abs(t.net)],
            ] as [string, number][]
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] tabular-nums">{whole(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="flex h-28 items-end gap-3" aria-label="Taxable supplies by period">
          {analysis.series.map((s) => (
            <div key={s.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className="text-[11px] tabular-nums text-muted-foreground">{s.sales ? whole(s.sales / 1000) + "k" : "—"}</span>
              <div className="w-full rounded-t-[4px] bg-primary" style={{ height: `${Math.max(3, (s.sales / max) * 72)}px`, opacity: s.sales ? 1 : 0.25 }} />
              <span className="w-full truncate text-center text-[11px] text-muted-foreground">{s.label.replace(/ \d{4}(\/\d{4})?$/, "")}</span>
            </div>
          ))}
        </div>
        {s12 !== null && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Taxable supplies, last 12 months{analysis.annualised ? ` (annualised from ${analysis.months12} months)` : ""}: <span className="font-semibold text-foreground">AED {whole(s12)}</span>
            </p>
            <div className="relative h-1.5 rounded-full bg-[var(--surface-hover)]">
              <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: pos(s12) }} />
              {[187_500, 375_000].map((mark) => (
                <span key={mark} className="absolute -top-1 h-3.5 w-px bg-[var(--text-tertiary)]" style={{ left: pos(mark) }} />
              ))}
            </div>
            <div className="relative h-4 text-[10px] text-subtle-foreground">
              <span className="absolute -translate-x-1/2" style={{ left: pos(187_500) }}>187.5k voluntary</span>
              <span className="absolute -translate-x-1/2" style={{ left: pos(375_000) }}>375k mandatory</span>
            </div>
          </div>
        )}
      </div>
      <ul>
        {analysis.insights.length === 0 && <li className="text-sm text-muted-foreground">Upload or enter a return to see the analysis.</li>}
        {analysis.insights.map((insight) => (
          <InsightItem key={insight.title} insight={insight} />
        ))}
      </ul>
    </section>
  )
}

function InsightItem({ insight }: { insight: Insight }) {
  const Icon = insight.level === "alert" || insight.level === "warning" ? AlertTriangle : insight.level === "good" ? CheckCircle2 : Info
  return (
    <li className={cn("insight", `insight-${insight.level}`)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{insight.title}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{insight.text}</p>
        {insight.law && <p className="mt-1 text-[11px] text-subtle-foreground">{insight.law}</p>}
      </div>
    </li>
  )
}

type Parsed = ReturnType<typeof parseVat201> & { filename: string }

async function readReturn(file: File, onProgress: (p: ReadProgress | null) => void): Promise<Parsed> {
  const text = await readDocument(file, onProgress)
  onProgress(null)
  return { ...parseVat201(text), filename: file.name }
}

function UploadZone({ onRead, onError }: { onRead: (parsed: Parsed) => void; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<ReadProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  async function handle(file?: File) {
    if (!file) return
    setBusy(true)
    onError("")
    try {
      onRead(await readReturn(file, setProgress))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "The file could not be read.")
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        handle(e.dataTransfer.files?.[0])
      }}
      className={cn("choice", over && "choice-over")}
    >
      {busy ? <Loader2 className="size-7 animate-spin text-primary" /> : <UploadCloud className="size-7 text-primary" strokeWidth={1.5} />}
      <span className="font-display text-lg font-semibold">Upload VAT 201 return</span>
      <span className="text-sm text-muted-foreground">
        {busy ? (progress ? `Reading page ${progress.page} of ${progress.pages}${progress.ocr ? " (scanned)" : ""}…` : "Reading the return…") : "The PDF downloaded from EmaraTax. Drop it here or browse."}
      </span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        <FileUp className="size-4" /> Browse
      </Button>
      <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" aria-label="VAT 201 return file" className="hidden" onChange={(e) => {
        handle(e.target.files?.[0])
        e.target.value = ""
      }} />
    </div>
  )
}

function UploadButton({ label, icon, onRead, onError }: { label: string; icon: React.ReactNode; onRead: (parsed: Parsed) => void; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : icon} {label}
      </Button>
      <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ""
        if (!file) return
        setBusy(true)
        try {
          onRead(await readReturn(file, () => {}))
        } catch (cause) {
          onError(cause instanceof Error ? cause.message : "The file could not be read.")
        } finally {
          setBusy(false)
        }
      }} />
    </>
  )
}

const SECTIONS: { key: "output" | "input" | "net"; title: string }[] = [
  { key: "output", title: "VAT on sales and all other outputs" },
  { key: "input", title: "VAT on expenses and all other inputs" },
  { key: "net", title: "Net VAT due" },
]

function FilingForm({ initial, warnings, saving, onSave, onCancel }: { initial: VatFiling; warnings: string[]; saving: boolean; onSave: (f: VatFiling) => void; onCancel: () => void }) {
  const [filing, setFiling] = useState<VatFiling>(initial)
  const computed = withTotals(filing)
  const set = (key: BoxKey, column: Column, value: number | undefined) =>
    setFiling((f) => ({ ...f, boxes: { ...f.boxes, [key]: { ...f.boxes[key], [column]: value } } }))
  return (
    <div className="space-y-5">
      {initial.source === "upload" && (
        <p className="flex items-start gap-2 rounded-lg bg-[var(--lagoon-wash)] px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--lagoon)]" />
          Read from {initial.filename}. Check the figures against the return, then save.
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-lg bg-[var(--saffron-wash)] px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--saffron)]" /> {w}
        </p>
      ))}
      {SECTIONS.map((section) => (
        <div key={section.key} className="overflow-x-auto rounded-xl border">
          <h3 className="border-b bg-secondary/60 px-4 py-2.5 text-sm font-semibold">{section.title}</h3>
          <div className="min-w-[40rem]">
            {section.key !== "net" && (
              <div className="grid grid-cols-[2.5rem_1fr_9rem_9rem_9rem] gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                <span />
                <span>Description</span>
                <span className="text-right">Amount (AED)</span>
                <span className="text-right">VAT amount (AED)</span>
                <span className="text-right">Adjustment (AED)</span>
              </div>
            )}
            {BOXES.filter((b) => b.section === section.key).map((box) => (
              <div key={box.key} className={cn("grid items-center gap-2 border-b px-4 py-1.5 text-sm last:border-0", section.key === "net" ? "grid-cols-[2.5rem_1fr_11rem]" : "grid-cols-[2.5rem_1fr_9rem_9rem_9rem]", box.computed && "bg-secondary/40 font-semibold")}>
                <span className="text-muted-foreground">{box.key}</span>
                <span>{box.label}</span>
                {(section.key === "net" ? (["amount"] as Column[]) : (["amount", "vat", "adjustment"] as Column[])).map((column) =>
                  !box.columns.includes(column) ? (
                    <span key={column} />
                  ) : box.computed ? (
                    <span key={column} className="text-right tabular-nums">
                      {aed(computed.boxes[box.key]?.[column])}
                    </span>
                  ) : (
                    <Amount key={column} value={filing.boxes[box.key]?.[column]} onChange={(v) => set(box.key, column, v)} hint={column === "vat" && /^1[a-g]$|^3$|^6$/.test(box.key) ? (filing.boxes[box.key]?.amount ?? 0) * 0.05 : undefined} />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="rounded-xl border px-4 py-3 text-sm">
        <p>Did you apply the profit margin scheme in respect of any supplies made during the tax period?</p>
        <div className="mt-2 flex gap-5">
          {[true, false].map((option) => (
            <label key={String(option)} className="flex items-center gap-2">
              <input type="radio" className="size-4 accent-[var(--cobalt)]" checked={filing.profitMarginScheme === option} onChange={() => setFiling((f) => ({ ...f, profitMarginScheme: option }))} />
              {option ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => onSave(filing)} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save return
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          <X className="size-4" /> Cancel
        </Button>
        <span className="ml-auto text-sm font-semibold">
          {computed.boxes["14"]?.amount && computed.boxes["14"].amount < 0 ? "Refundable" : "Payable"}: AED {aed(Math.abs(computed.boxes["14"]?.amount ?? 0))}
        </span>
      </div>
    </div>
  )
}

function Amount({ value, onChange, hint }: { value: number | undefined; onChange: (v: number | undefined) => void; hint?: number }) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (value === undefined ? "" : String(value))
  return (
    <input
      inputMode="decimal"
      placeholder={hint ? aed(hint) : "0.00"}
      title={hint ? `5% of the amount is ${aed(hint)}` : undefined}
      className="h-8 w-full rounded-md border bg-card px-2 text-right text-sm tabular-nums"
      value={shown}
      onChange={(e) => {
        setText(e.target.value)
        const raw = e.target.value.replace(/,/g, "").trim()
        if (!raw) onChange(undefined)
        else if (Number.isFinite(Number(raw))) onChange(Number(raw))
      }}
      onBlur={() => setText(null)}
    />
  )
}

function FilingView({ filing }: { filing: VatFiling }) {
  const full = withTotals(filing)
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {filing.source === "upload" ? `Uploaded from ${filing.filename ?? "the return"}` : "Entered manually"}
        {filing.submittedOn ? ` · submitted ${dmy(filing.submittedOn)}` : ""}
        {filing.reference ? ` · reference ${filing.reference}` : ""}
        {filing.savedAt ? ` · saved ${dmy(filing.savedAt.slice(0, 10))}` : ""}
      </p>
      {SECTIONS.map((section) => (
        <div key={section.key} className="overflow-x-auto rounded-xl border">
          <h3 className="border-b bg-secondary/60 px-4 py-2.5 text-sm font-semibold">{section.title}</h3>
          <table className="w-full min-w-[40rem] text-sm">
            <tbody>
              {BOXES.filter((b) => b.section === section.key).map((box) => (
                <tr key={box.key} className={cn("border-b last:border-0", box.computed && "bg-secondary/40 font-semibold")}>
                  <td className="w-10 px-4 py-1.5 text-muted-foreground">{box.key}</td>
                  <td className="py-1.5">{box.label}</td>
                  {(section.key === "net" ? (["amount"] as Column[]) : (["amount", "vat", "adjustment"] as Column[])).map((column) => (
                    <td key={column} className="w-36 px-3 py-1.5 text-right tabular-nums">
                      {box.columns.includes(column) ? aed(full.boxes[box.key]?.[column]) : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="text-sm">Profit margin scheme applied: {filing.profitMarginScheme ? "Yes" : "No"}</p>
    </div>
  )
}

