"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, FileDown, FileSpreadsheet, Info, Loader2, Save } from "lucide-react"

import { CompanyPicker, Loading, NoData, useTaxData } from "@/components/tax-workbench"
import { useTranslatedRecords } from "@/components/use-aed-records"
import { Button } from "@/components/ui/button"
import { formatLongDate, type Company } from "@/lib/company"
import {
  ctAnswersSchema,
  ctReturns,
  readAnswerStore,
  type CtAnswers,
  type CtAnswerStore,
  type CtReturn,
  type FormRow,
  type FormSection,
} from "@/lib/ct-return"
import { cn } from "@/lib/utils"

const fmt = (n: number | null | undefined) => {
  if (n === null || n === undefined) return ""
  const v = Math.round(n) || 0
  return v < 0 ? `(${Math.abs(v).toLocaleString("en-US")})` : v.toLocaleString("en-US")
}
const DEFAULTS = ctAnswersSchema.parse({})
const dmy = (iso: string) => iso.split("-").reverse().join("/")

type Tab = "commentary" | "summary" | number

export function CtWorkbench() {
  const data = useTaxData()
  const { company, setCompanies } = data
  // Corporate tax is computed and returned in AED: books in another currency are translated.
  const translated = useTranslatedRecords(company, data.companyRecords, "AED")
  const companyRecords = translated.records
  const [year, setYear] = useState<number | null>(null)
  const [edits, setEdits] = useState<{ companyId: string; store: CtAnswerStore } | null>(null)
  const [tab, setTab] = useState<Tab>("commentary")
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState<"" | "pdf" | "excel">("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const savedStore = useMemo(() => readAnswerStore(company?.ctAnswers), [company])
  const store = edits && edits.companyId === company?.id ? edits.store : savedStore
  const dirty = Boolean(edits && edits.companyId === company?.id && JSON.stringify(edits.store) !== JSON.stringify(savedStore))
  const returns = useMemo(() => (company ? ctReturns(company, companyRecords, store) : []), [company, companyRecords, store])
  const years = returns.map((r) => r.year).sort((a, b) => b - a)
  const selected = year && years.includes(year) ? year : (returns.filter((r) => r.inScope).at(-1)?.year ?? years[0] ?? null)
  const ret = returns.find((r) => r.year === selected) ?? null

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  function setAnswer(key: keyof CtAnswers, value: CtAnswers[keyof CtAnswers]) {
    if (!company || !selected) return
    const current = { ...(store[String(selected)] ?? {}), [key]: value }
    setEdits({ companyId: company.id, store: { ...store, [String(selected)]: current } })
    setMessage("")
  }

  async function save(): Promise<Company | null> {
    if (!company) return null
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/companies/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: company.id, ctAnswers: store }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setCompanies((list) => list.map((item) => (item.id === company.id ? body.company : item)))
      setEdits(null)
      setMessage("Answers saved.")
      return body.company
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.")
      return null
    } finally {
      setSaving(false)
    }
  }

  async function download(kind: "pdf" | "excel") {
    if (!company || !selected) return
    if (dirty && !(await save())) return
    setDownloading(kind)
    setError("")
    try {
      const response = await fetch(`/api/corporate-tax/${kind}?companyId=${company.id}&year=${selected}`)
      if (!response.ok) throw new Error((await response.json()).error)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-Corporate-Tax-Return-${selected}.${kind === "pdf" ? "pdf" : "xlsx"}`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.")
    } finally {
      setDownloading("")
    }
  }

  if (data.loading || translated.loading) return <Loading />
  if (!company) return <NoData title="No data" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />
  if (translated.error) return <NoData title="Exchange rates unavailable" text={`Corporate tax is computed in AED and the rates from ${company.baseCurrency} could not be fetched. Try again shortly.`} href="/corporate-tax" action="Retry" />
  if (!companyRecords.length)
    return <NoData title="No corporate tax data" text="No trial balance has been saved yet. Save a year in Data Input." href="/data-input" action="Go to Data Input" />
  if (!ret) return null

  return (
    <div className="space-y-6 pb-24">
      {translated.rates.length > 0 && (
        <p className="note note-info text-sm">
          Your books are kept in {company.baseCurrency}; corporate tax is computed and returned in AED, so these figures are translated: {translated.rates
            .filter((r) => r.year === ret.year)
            .map((r) => `balance sheet at 1 ${company.baseCurrency} = ${r.closing} AED, profit and loss at the year's average ${r.average}`)
            .join("")}
          .
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Company</p>
            <p className="mt-1 text-lg font-semibold">{company.name}</p>
            <p className="text-xs text-muted-foreground">CT TRN {company.ct.trn || "not recorded"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tax year</p>
            <div role="tablist" aria-label="Tax year" className="track mt-1">
              {years.map((option) => (
                <button key={option} type="button" role="tab" aria-selected={option === selected} className="track-item" onClick={() => setYear(option)}>
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CompanyPicker companies={data.companies} companyId={data.companyId} onChange={data.setCompanyId} />
          <Button onClick={() => download("pdf")} disabled={Boolean(downloading) || !ret.inScope}>
            {downloading === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            Return PDF
          </Button>
          <Button variant="outline" onClick={() => download("excel")} disabled={Boolean(downloading) || !ret.inScope}>
            {downloading === "excel" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
            Return Excel
          </Button>
        </div>
      </div>

      <Header ret={ret} />

      {ret.inScope && (
        <>
          <Notices ret={ret} />
          <nav aria-label="Return steps" className="track">
            <TabButton active={tab === "commentary"} onClick={() => setTab("commentary")}>
              Computation &amp; commentary
            </TabButton>
            {ret.steps.map((step) => (
              <TabButton key={step.number} active={tab === step.number} onClick={() => setTab(step.number)}>
                <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-black/10 text-[11px] font-semibold">{step.number}</span>
                {step.title}
              </TabButton>
            ))}
            <TabButton active={tab === "summary"} onClick={() => setTab("summary")}>
              Tax summary
            </TabButton>
          </nav>

          {tab === "commentary" && <Commentary ret={ret} />}
          {tab === "summary" && <Summary ret={ret} />}
          {typeof tab === "number" &&
            ret.steps
              .filter((step) => step.number === tab)
              .map((step) => (
                <div key={step.number} className="space-y-5">
                  {step.sections.map((section) => (
                    <Section key={section.title} section={section} answers={store[String(ret.year)] ?? {}} onChange={setAnswer} />
                  ))}
                  <div className="flex justify-between">
                    <Button variant="outline" disabled={step.number === 1} onClick={() => setTab(step.number - 1)}>
                      Previous Step
                    </Button>
                    <Button onClick={() => setTab(step.number === 7 ? "summary" : step.number + 1)}>
                      {step.number === 7 ? "Tax summary" : "Next Step"}
                    </Button>
                  </div>
                </div>
              ))}

          <div className="fixed inset-x-4 bottom-20 z-20 flex flex-wrap items-center gap-3 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur lg:left-[19rem] lg:bottom-4">
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save answers
            </Button>
            <span className="text-sm text-muted-foreground">{dirty ? "Unsaved answers — figures above already reflect them." : "Answers saved."}</span>
            {message && <span className="text-sm text-emerald-800">{message}</span>}
            {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
            <span className="ml-auto text-sm font-semibold">
              CT payable {ret.year}: AED {fmt(ret.payable)}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "step" : undefined} className="track-item flex items-center">
      {children}
    </button>
  )
}

function Header({ ret }: { ret: CtReturn }) {
  const facts: [string, string][] = [
    ["Corporate Tax Return Period", `${dmy(ret.periodStart)} - ${dmy(ret.periodEnd)}`],
    ["Corporate Tax Return Due Date", dmy(ret.dueDate)],
    ["Corporate Tax Year End", dmy(ret.periodEnd)],
  ]
  return (
    <div className="panel overflow-hidden">
      <div className="grid sm:grid-cols-4">
        <div className="flex flex-col justify-center gap-1 bg-[var(--ink)] px-5 py-4 text-white">
          <span className="text-sm font-semibold">Filing Period</span>
          <span className="text-xs text-white/75">{ret.regime}</span>
        </div>
        {facts.map(([label, value]) => (
          <div key={label} className="border-l px-5 py-4">
            <p className="text-xs font-semibold">{label}</p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>
      {ret.inScope ? (
        <div className="grid border-t sm:grid-cols-4">
          <Metric label="Taxable income" value={ret.summary[22].amount} />
          <Metric label="Corporate tax liability" value={ret.liability} />
          <Metric label="Corporate tax payable" value={ret.payable} strong />
          <div className="border-l px-5 py-4">
            <p className="text-xs text-muted-foreground">Review status</p>
            <p className={cn("mt-1 flex items-center gap-1.5 text-sm font-semibold", ret.status === "Ready for filing review" ? "text-emerald-700" : "text-amber-700")}>
              {ret.status === "Ready for filing review" ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
              {ret.status}
            </p>
          </div>
        </div>
      ) : (
        <p className="border-t px-5 py-4 text-sm">{ret.scopeReason}</p>
      )}
    </div>
  )
}

function Metric({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="border-l px-5 py-4 first:border-l-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-lg tabular-nums", strong && "text-xl font-semibold")}>AED {fmt(value)}</p>
    </div>
  )
}

function Notices({ ret }: { ret: CtReturn }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      {ret.blockers.map((text) => (
        <p key={text} className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {text}
        </p>
      ))}
      {ret.warnings.map((text) => (
        <p key={text} className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {text}
        </p>
      ))}
      {ret.assumptions.length > 0 && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950">
          <button type="button" className="flex w-full items-center gap-2 text-left font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
            <Info className="size-4 shrink-0" />
            {ret.assumptions.length} assumption{ret.assumptions.length === 1 ? "" : "s"} used because a question is not answered yet
            <span className="ml-auto text-xs underline">{open ? "Hide" : "Show"}</span>
          </button>
          {open && (
            <ul className="mt-2 list-disc space-y-1 pl-8">
              {ret.assumptions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Commentary({ ret }: { ret: CtReturn }) {
  const computation: [string, number, boolean?][] = [
    ["Accounting income (net profit before tax)", ret.accountingIncome],
    ...ret.summary
      .filter((line) => line.no >= 2 && line.no <= 18 && line.amount !== 0)
      .map((line) => [line.label, line.amount] as [string, number]),
    ["Taxable income before tax losses", ret.taxableBeforeLosses, true],
    ["Tax losses used (max 75%)", -ret.lossesUsed],
    ["Taxable income for the tax period", ret.summary[22].amount, true],
    ["Corporate tax liability", ret.liability, true],
    ["Tax credits", -ret.credits],
    ["Corporate tax payable", ret.payable, true],
  ]
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-6">
        {ret.commentary.map((block) => (
          <section key={block.title} className="rounded-xl border bg-white p-6">
            <h3 className="font-semibold">{block.title}</h3>
            <div className="mt-2 space-y-2 text-sm leading-6">
              {block.paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </div>
          </section>
        ))}
        <section className="rounded-xl border bg-white p-6">
          <h3 className="font-semibold">Disclosures, schedules and records</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <tbody>
                {ret.disclosures.map((item) => (
                  <tr key={item.item} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3 font-medium">{item.item}</td>
                    <td className="w-28 py-2 pr-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          item.status === "Required" && "bg-primary/10 text-primary",
                          item.status === "Check" && "bg-amber-100 text-amber-900",
                          item.status === "Not required" && "bg-secondary text-muted-foreground"
                        )}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <aside className="h-fit rounded-xl border bg-white p-5 xl:sticky xl:top-4">
        <h3 className="font-semibold">Computation (AED)</h3>
        {ret.regime === "Small Business Relief" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Small Business Relief elected: the return reports nil. Standard computation for comparison: taxable income {fmt(ret.ordinary.taxableIncome)}, tax {fmt(ret.ordinary.liability)}.
          </p>
        )}
        <table className="mt-3 w-full text-sm">
          <tbody>
            {computation.map(([label, amount, strong]) => (
              <tr key={label} className={cn(strong && "border-t font-semibold")}>
                <td className="py-1.5 pr-2">{label}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">{fmt(amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-4 space-y-1 border-t pt-3 text-xs text-muted-foreground">
          <div className="flex justify-between"><dt>Revenue</dt><dd className="font-mono">{fmt(ret.revenue)}</dd></div>
          <div className="flex justify-between"><dt>Losses carried forward</dt><dd className="font-mono">{fmt(ret.lossesCarriedForward)}</dd></div>
          <div className="flex justify-between"><dt>Return and payment due</dt><dd>{formatLongDate(ret.dueDate)}</dd></div>
        </dl>
      </aside>
    </div>
  )
}

function Summary({ ret }: { ret: CtReturn }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="bg-[#efe9b9] px-4 py-2 text-center text-sm font-semibold">Tax Summary</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y bg-secondary/60">
            <th className="w-12 px-3 py-2 text-left">S.no</th>
            <th className="px-3 py-2 text-left">Description</th>
            <th className="w-40 px-3 py-2 text-right">Total Amount (AED)</th>
          </tr>
        </thead>
        <tbody>
          {ret.summary.flatMap((line, i) => {
            const rows = []
            if (i === 0 || ret.summary[i - 1].group !== line.group) {
              rows.push(
                <tr key={`g-${line.no}`} className="border-b bg-secondary/30">
                  <td colSpan={3} className="px-3 py-1.5 font-semibold">{line.group}</td>
                </tr>
              )
            }
            rows.push(
              <tr key={line.no} className={cn("border-b", line.no >= 23 && "font-semibold")}>
                <td className="px-3 py-1.5 text-center">{line.no}</td>
                <td className="px-3 py-1.5">{line.label}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmt(line.amount)}</td>
              </tr>
            )
            return rows
          })}
        </tbody>
      </table>
    </div>
  )
}

function Section({ section, answers, onChange }: { section: FormSection; answers: Partial<CtAnswers>; onChange: (key: keyof CtAnswers, value: CtAnswers[keyof CtAnswers]) => void }) {
  const comparative = section.columns === "comparative"
  const visible = section.rows.filter((row) => !row.hidden)
  return (
    <section className="rounded-lg border bg-white">
      <h3 className="border-b px-5 py-3 font-semibold">{section.title}</h3>
      {comparative && (
        <div className="grid grid-cols-[minmax(0,1fr)_9rem_9rem] gap-3 border-b bg-secondary/50 px-5 py-2 text-xs font-semibold sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <span>{section.title}</span>
          <span className="text-right">Current Period (AED)</span>
          <span className="text-right">Previous Period (AED)</span>
        </div>
      )}
      <div className="divide-y">
        {visible.map((row, i) => (
          <Row key={`${row.label}-${i}`} row={row} comparative={comparative} answers={answers} onChange={onChange} />
        ))}
      </div>
    </section>
  )
}

function Row({ row, comparative, answers, onChange }: { row: FormRow; comparative: boolean; answers: Partial<CtAnswers>; onChange: (key: keyof CtAnswers, value: CtAnswers[keyof CtAnswers]) => void }) {
  if (row.kind === "heading") return <p className="bg-secondary/30 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide">{row.label}</p>
  const field = row.input
  const isQuestion = field?.type === "boolean" || (typeof row.value === "boolean" && !field)
  if (isQuestion)
    return (
      <div className="px-5 py-3">
        <div className="max-w-3xl rounded-md border bg-secondary px-4 py-3">
          <p className="text-sm font-medium">{row.label}</p>
          <div className="mt-2 flex gap-5 text-sm">
            {[true, false].map((option) => (
              <label key={String(option)} className={cn("flex items-center gap-2", !field && "opacity-70")}>
                <input
                  type="radio"
                  className="size-4 accent-[var(--cobalt)]"
                  disabled={!field}
                  checked={row.value === option}
                  onChange={() => field && onChange(field.key, option)}
                />
                {option ? "Yes" : "No"}
              </label>
            ))}
            {!field && <span className="text-xs text-muted-foreground">(set automatically)</span>}
            {field && !(field.key in answers) && <span className="text-xs text-sky-800">default — please confirm</span>}
          </div>
        </div>
      </div>
    )
  return (
    <div className={cn("grid items-center gap-3 px-5 py-2.5", comparative ? "grid-cols-[minmax(0,1fr)_9rem_9rem] sm:grid-cols-[minmax(0,1fr)_11rem_11rem]" : "grid-cols-[minmax(0,1fr)_14rem]", row.kind === "total" && "bg-secondary/40 font-semibold")}>
      <span className="text-sm">{row.label}</span>
      {field ? (
        <FieldControl row={row} answers={answers} onChange={onChange} />
      ) : (
        <span className={cn("rounded border bg-[#d9d9d9]/60 px-2 py-1.5 text-sm", typeof row.value === "number" ? "text-right font-mono tabular-nums" : "")}>
          {typeof row.value === "number" ? fmt(row.value) : String(row.value ?? "")}
        </span>
      )}
      {comparative && (
        <span className="rounded border bg-[#d9d9d9]/60 px-2 py-1.5 text-right font-mono text-sm tabular-nums">{row.prior === null || row.prior === undefined ? "—" : fmt(row.prior)}</span>
      )}
    </div>
  )
}

function FieldControl({ row, answers, onChange }: { row: FormRow; answers: Partial<CtAnswers>; onChange: (key: keyof CtAnswers, value: CtAnswers[keyof CtAnswers]) => void }) {
  const field = row.input!
  const [text, setText] = useState<string | null>(null)
  if (field.type === "select")
    return (
      <select className="h-9 rounded-md border bg-white px-2 text-sm" value={String(answers[field.key] ?? DEFAULTS[field.key])} onChange={(e) => onChange(field.key, e.target.value as never)}>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  if (field.type === "text")
    return <input className="h-9 rounded-md border bg-white px-2 text-sm" value={String(row.value ?? "")} onChange={(e) => onChange(field.key, e.target.value as never)} />
  const shown = text ?? (row.value ? String(row.value) : "")
  return (
    <input
      inputMode="decimal"
      placeholder="0"
      className="h-9 rounded-md border bg-white px-2 text-right font-mono text-sm tabular-nums"
      value={shown}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value.replace(/,/g, ""))
        if (e.target.value.trim() === "") onChange(field.key, 0 as never)
        else if (Number.isFinite(n)) onChange(field.key, n as never)
      }}
      onBlur={() => setText(null)}
    />
  )
}
