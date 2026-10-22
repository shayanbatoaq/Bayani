"use client"

import { useMemo, useState } from "react"
import { AlertCircle, FileDown, FileSpreadsheet, Info, Loader2, Plus, Save, X } from "lucide-react"

import { CompanyPicker, Loading, NoData, useTaxData } from "@/components/tax-workbench"
import { Button } from "@/components/ui/button"
import { emirates, type Company } from "@/lib/company"
import {
  FOOTER,
  VAT_RULES,
  classify,
  locationOf,
  readVatAnswers,
  registrationCheck,
  vatLines,
  vatReturns,
  type VatAnswers,
  type VatPeriodAnswers,
  type VatProfile,
  type VatReturn,
} from "@/lib/vat-return"
import { cn } from "@/lib/utils"

const aed = (n: number) => (Math.round(n * 100) / 100 || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = (iso: string) => iso.split("-").reverse().join("/")
const TREATMENT: Record<string, string> = { standard: "5%", zero: "0%", exempt: "Exempt", oos: "Out of scope", rcServices: "Reverse charge", rcImport: "Import (RC)", rcDomestic: "Domestic RC" }

export function VatWorkbench() {
  const data = useTaxData()
  const { company, companyRecords, setCompanies } = data
  const [edits, setEdits] = useState<{ companyId: string; answers: VatAnswers } | null>(null)
  const [periodId, setPeriodId] = useState("")
  const [tab, setTab] = useState<"return" | "working" | "profile">("return")
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState<"" | "pdf" | "excel">("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  const saved = useMemo(() => readVatAnswers(company?.vatAnswers), [company])
  const answers = edits && edits.companyId === company?.id ? edits.answers : saved
  const dirty = Boolean(edits && edits.companyId === company?.id && JSON.stringify(edits.answers) !== JSON.stringify(saved))
  const returns = useMemo(() => (company ? vatReturns(company, companyRecords, answers) : []), [company, companyRecords, answers])
  const registration = useMemo(() => (company ? registrationCheck(company, companyRecords, answers) : null), [company, companyRecords, answers])
  const withData = returns.filter((r) => r.coverage !== "No data")
  const selected = returns.find((r) => r.period.id === periodId) ?? withData.at(-1) ?? returns.at(-1) ?? null

  function update(next: VatAnswers) {
    if (!company) return
    setEdits({ companyId: company.id, answers: next })
    setMessage("")
  }
  const setProfile = (patch: Partial<VatProfile>) => update({ ...answers, profile: { ...answers.profile, ...patch } })
  const setPeriod = (id: string, patch: Partial<VatPeriodAnswers>) =>
    update({ ...answers, periods: { ...answers.periods, [id]: { ...(answers.periods[id] ?? {}), ...patch } } })

  async function save(): Promise<boolean> {
    if (!company) return false
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/companies/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: company.id, vatAnswers: answers }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setCompanies((list) => list.map((item) => (item.id === company.id ? body.company : item)))
      setEdits(null)
      setMessage("Saved.")
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.")
      return false
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
      const response = await fetch(`/api/vat/${kind}?companyId=${company.id}&period=${selected.period.id}`)
      if (!response.ok) throw new Error((await response.json()).error)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-VAT-201-${selected.period.end}.${kind === "pdf" ? "pdf" : "xlsx"}`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.")
    } finally {
      setDownloading("")
    }
  }

  if (data.loading) return <Loading />
  if (!company) return <NoData title="No data" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />
  if (!companyRecords.length)
    return <NoData title="No VAT data" text="No trial balance has been saved yet. Save a year in Data Input." href="/data-input" action="Go to Data Input" />
  if (!company.vat.trn || !company.vat.effectiveDate)
    return (
      <div className="space-y-4">
        {registration && <Registration text={registration.result} rule={registration.rule} />}
        <NoData title="Not VAT registered" text="This company has no VAT TRN and effective date. Add them on the Dashboard (from the VAT certificate) to prepare VAT returns." href="/dashboard" action="Update company" />
      </div>
    )

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Fact label="Company" value={company.name} />
          <Fact label="VAT TRN" value={company.vat.trn} />
          <Fact label="Return period" value={returns[0]?.stagger ?? ""} />
          <Fact label="Location" value={locationOf(company, answers.profile).replace("_", " ")} />
        </dl>
        <CompanyPicker companies={data.companies} companyId={data.companyId} onChange={data.setCompanyId} />
      </div>
      {registration && <Registration text={registration.result} rule={registration.rule} />}

      <div className="flex gap-1 border-b">
        {(
          [
            ["return", "VAT 201 return"],
            ["working", "Working & commentary"],
            ["profile", "VAT profile & classification"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn("-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground", tab === key && "border-primary text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== "profile" && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">VAT return period</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {returns.map((r) => (
              <button
                key={r.period.id}
                type="button"
                onClick={() => setPeriodId(r.period.id)}
                className={cn(
                  "shrink-0 rounded-lg border bg-white px-3 py-2 text-left text-xs shadow-sm hover:border-primary/60",
                  selected?.period.id === r.period.id && "border-primary ring-1 ring-primary",
                  r.coverage === "No data" && "opacity-50"
                )}
              >
                <span className="block font-semibold">
                  {dmy(r.period.start)} – {dmy(r.period.end)}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {r.coverage === "No data" ? "No data" : `${r.payable >= 0 ? "Payable" : "Refund"} AED ${aed(Math.abs(r.payable))}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "return" && selected && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {selected.coverage === "Actual totals" ? "Using actual period totals you entered." : selected.coverage === "Estimated" ? "Estimated from the saved trial balance." : selected.coverage === "Partial data" ? "Partly estimated: saved data does not cover the whole period." : "No saved data covers this period."}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => download("pdf")} disabled={Boolean(downloading)}>
                {downloading === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
                VAT 201 PDF
              </Button>
              <Button variant="outline" onClick={() => download("excel")} disabled={Boolean(downloading)}>
                {downloading === "excel" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                Excel
              </Button>
            </div>
          </div>
          <ActualTotals ret={selected} answers={answers.periods[selected.period.id] ?? {}} onChange={(patch) => setPeriod(selected.period.id, patch)} />
          <Vat201 company={company} ret={selected} answers={answers} onPeriod={(patch) => setPeriod(selected.period.id, patch)} onProfile={setProfile} />
        </>
      )}
      {tab === "working" && selected && <Working ret={selected} />}
      {tab === "profile" && <Profile company={company} records={companyRecords} answers={answers} onProfile={setProfile} />}

      <div className="fixed inset-x-4 bottom-20 z-20 flex flex-wrap items-center gap-3 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-4 lg:left-[19rem]">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save VAT answers
        </Button>
        <span className="text-sm text-muted-foreground">{dirty ? "Unsaved changes — figures already reflect them." : "All saved."}</span>
        {message && <span className="text-sm text-emerald-800">{message}</span>}
        {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
        {selected && (
          <span className="ml-auto text-sm font-semibold">
            {dmy(selected.period.end)}: {selected.payable >= 0 ? "payable" : "refundable"} AED {aed(Math.abs(selected.payable))}
          </span>
        )}
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium capitalize">{value}</dd>
    </div>
  )
}

function Registration({ text, rule }: { text: string; rule: string }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-950">
      <Info className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="font-semibold">Registration ({rule}):</span> {text}
      </span>
    </p>
  )
}

function NumberInput({ value, onChange, placeholder = "0.00", allowEmpty }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; allowEmpty?: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (value === null || value === undefined || (value === 0 && !allowEmpty) ? "" : String(value))
  return (
    <input
      inputMode="decimal"
      placeholder={placeholder}
      className="h-8 w-full rounded border bg-white px-2 text-right font-mono text-sm tabular-nums"
      value={shown}
      onChange={(e) => {
        setText(e.target.value)
        const raw = e.target.value.replace(/,/g, "").trim()
        if (!raw) onChange(allowEmpty ? null : 0)
        else if (Number.isFinite(Number(raw))) onChange(Number(raw))
      }}
      onBlur={() => setText(null)}
    />
  )
}

function ActualTotals({ ret, answers, onChange }: { ret: VatReturn; answers: Partial<VatPeriodAnswers>; onChange: (patch: Partial<VatPeriodAnswers>) => void }) {
  return (
    <div className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-[1fr_12rem_12rem] sm:items-end">
      <div>
        <p className="text-sm font-medium">Know the actual figures for this period?</p>
        <p className="text-xs text-muted-foreground">Enter total sales and total purchases/expenses (excluding VAT and salaries) from your invoices. The estimate is then scaled to them, keeping each head&apos;s VAT treatment.</p>
      </div>
      <label className="space-y-1 text-xs">
        Actual sales (AED)
        <NumberInput allowEmpty placeholder="Estimate" value={answers.actualSales ?? null} onChange={(v) => onChange({ actualSales: v })} />
      </label>
      <label className="space-y-1 text-xs">
        Actual expenses (AED)
        <NumberInput allowEmpty placeholder="Estimate" value={answers.actualExpenses ?? null} onChange={(v) => onChange({ actualExpenses: v })} />
      </label>
      {ret.coverage === "Actual totals" && <p className="text-xs text-emerald-800 sm:col-span-3">Actual totals in use. Clear the fields to go back to the estimate.</p>}
    </div>
  )
}

function Vat201({
  company,
  ret,
  answers,
  onPeriod,
  onProfile,
}: {
  company: Company
  ret: VatReturn
  answers: VatAnswers
  onPeriod: (patch: Partial<VatPeriodAnswers>) => void
  onProfile: (patch: Partial<VatProfile>) => void
}) {
  const pa = answers.periods[ret.period.id] ?? {}
  const output = ret.boxes.filter((b) => /^(1[a-g]|[2-8])$/.test(b.box))
  const input = ret.boxes.filter((b) => ["9", "10", "11"].includes(b.box))
  const net = ret.boxes.filter((b) => ["12", "13", "14"].includes(b.box))
  const profile = { profitMarginScheme: false, ...answers.profile }
  const boxInput = (key: keyof VatPeriodAnswers, value: number) => <NumberInput value={value} onChange={(v) => onPeriod({ [key]: v ?? 0 })} />
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border bg-white">
        <h3 className="border-b bg-secondary/50 px-5 py-2.5 font-semibold">VAT 201 Return — Taxpayer Information</h3>
        <dl className="grid text-sm sm:grid-cols-2">
          {(
            [
              ["TRN", company.vat.trn],
              ["VAT Return Period", `${dmy(ret.period.start)} - ${dmy(ret.period.end)}`],
              ["Legal Name of Entity (English)", company.name],
              ["VAT Stagger", ret.stagger],
              ["Emirate", company.emirate],
              ["VAT Return Due Date", dmy(ret.period.dueDate)],
              ["Licensing authority", company.authority],
              ["Tax Year End", dmy(ret.taxYearEnd)],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label} className="grid grid-cols-[12rem_1fr] border-b px-5 py-2 even:sm:border-l">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <BoxTable title="VAT on Sales and All Other Outputs" rows={output} total="8" edit={(b) => (b.box === "2" ? boxInput("touristRefunds", pa.touristRefunds ?? 0) : b.box === "7" ? boxInput("importAdjustment", pa.importAdjustment ?? 0) : null)} adjust={(b) => (b.editable === "outputAdjustment" ? boxInput("outputAdjustment", pa.outputAdjustment ?? 0) : null)} />
      <BoxTable title="VAT on Expenses and All Other Inputs" rows={input} total="11" edit={() => null} adjust={(b) => (b.box === "9" ? boxInput("inputAdjustment", pa.inputAdjustment ?? 0) : null)} />

      <section className="overflow-hidden rounded-lg border bg-white">
        <h3 className="border-b bg-secondary/50 px-5 py-2.5 font-semibold">Net VAT Due</h3>
        {net.map((b) => (
          <div key={b.box} className={cn("grid grid-cols-[3rem_1fr_11rem] items-center border-b px-5 py-2 text-sm", b.box === "14" && "bg-secondary/40 font-semibold")}>
            <span>{b.box}</span>
            <span>{b.label} (AED)</span>
            <span className="text-right font-mono tabular-nums">{aed(b.vat)}</span>
          </div>
        ))}
      </section>

      <section className="rounded-lg border bg-white p-5">
        <h3 className="font-semibold">Profit Margin Scheme</h3>
        <div className="mt-2 rounded-md bg-[#e6e9f0] px-4 py-3 text-sm">
          <p>Did you apply the profit margin scheme in respect of any supplies made during the tax period?</p>
          <div className="mt-2 flex gap-5">
            {[true, false].map((option) => (
              <label key={String(option)} className="flex items-center gap-2">
                <input type="radio" className="size-4" checked={profile.profitMarginScheme === option} onChange={() => onProfile({ profitMarginScheme: option })} />
                {option ? "Yes" : "No"}
              </label>
            ))}
          </div>
        </div>
        <h3 className="mt-5 font-semibold">Authorised Signatory</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["signatoryName", "Name in English"],
              ["signatoryMobile", "Mobile Number"],
              ["signatoryEmail", "Email Address"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="space-y-1 text-xs">
              {label}
              <input className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={String(answers.profile[key] ?? "")} onChange={(e) => onProfile({ [key]: e.target.value })} />
            </label>
          ))}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">{FOOTER}</p>
    </div>
  )
}

function BoxTable({
  title,
  rows,
  total,
  edit,
  adjust,
}: {
  title: string
  rows: VatReturn["boxes"]
  total: string
  edit: (b: VatReturn["boxes"][number]) => React.ReactNode
  adjust: (b: VatReturn["boxes"][number]) => React.ReactNode
}) {
  return (
    <section className="overflow-x-auto rounded-lg border bg-white">
      <h3 className="border-b bg-secondary/50 px-5 py-2.5 font-semibold">{title}</h3>
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-[3rem_1fr_10rem_10rem_10rem] gap-2 border-b px-5 py-2 text-xs font-semibold">
          <span />
          <span>Description</span>
          <span className="text-right">Amount (AED)</span>
          <span className="text-right">VAT Amount (AED)</span>
          <span className="text-right">Adjustment (AED)</span>
        </div>
        {rows.map((b) => {
          const editor = edit(b)
          const adjuster = adjust(b)
          return (
            <div key={b.box} className={cn("grid grid-cols-[3rem_1fr_10rem_10rem_10rem] items-center gap-2 border-b px-5 py-1.5 text-sm", b.box === total && "bg-secondary/40 font-semibold")}>
              <span>{b.box}</span>
              <span>{b.label}</span>
              {b.box === "2" && editor ? (
                <>
                  <span className="text-right font-mono tabular-nums">{aed(b.amount)}</span>
                  <span title="VAT refunded to tourists">{editor}</span>
                </>
              ) : (
                <>
                  <span className="text-right font-mono tabular-nums">{editor && b.box === "7" ? editor : aed(b.amount)}</span>
                  <span className="text-right font-mono tabular-nums">{b.box === "4" || b.box === "5" ? "" : aed(b.vat)}</span>
                </>
              )}
              <span className="text-right font-mono tabular-nums">{adjuster ?? (["2", "3", "4", "5", "6", "7", "10"].includes(b.box) ? "" : aed(b.adjustment))}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Working({ ret }: { ret: VatReturn }) {
  const revenue = ret.lines.filter((l) => l.side === "revenue")
  const expenses = ret.lines.filter((l) => l.side === "expense")
  return (
    <div className="space-y-5">
      <section className="rounded-lg border bg-white p-5">
        <h3 className="font-semibold">Summary</h3>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["Standard-rated sales", ret.totals.standard],
              ["Zero-rated sales", ret.totals.zero],
              ["Exempt sales", ret.totals.exempt],
              ["Out of scope", ret.totals.oos],
              ["Output VAT", ret.outputVat],
              ["Recoverable input VAT", ret.recoverableVat],
            ] as [string, number][]
          ).map(([label, value]) => (
            <div key={label} className="rounded-md border px-3 py-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="font-mono font-semibold tabular-nums">{aed(value)}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2 text-sm leading-6">
          {ret.commentary.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      </section>
      <LineTable title="Sales and other income" lines={revenue} expense={false} />
      <LineTable title="Purchases and expenses (input VAT)" lines={expenses} expense />
      {ret.review.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <h3 className="flex items-center gap-2 font-semibold">
            <AlertCircle className="size-4" /> Needs review
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {ret.review.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950">
        <h3 className="flex items-center gap-2 font-semibold">
          <Info className="size-4" /> Assumptions made
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {ret.assumptions.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-muted-foreground">{FOOTER}</p>
    </div>
  )
}

function LineTable({ title, lines, expense }: { title: string; lines: VatReturn["lines"]; expense: boolean }) {
  return (
    <section className="overflow-x-auto rounded-lg border bg-white">
      <h3 className="border-b px-5 py-2.5 font-semibold">{title}</h3>
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="border-b bg-secondary/40 text-left text-xs">
            <th className="px-4 py-2">Description</th>
            <th className="px-2 py-2 text-right">Amount (AED)</th>
            <th className="px-2 py-2">Treatment</th>
            <th className="px-2 py-2">Rule</th>
            <th className="px-2 py-2 text-right">VAT</th>
            {expense && <th className="px-2 py-2 text-right">Recoverable</th>}
            <th className="px-4 py-2">Note</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.id}-${i}`} className="border-b align-top last:border-0">
              <td className="px-4 py-2 font-medium">{l.name}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{aed(l.amount)}</td>
              <td className="px-2 py-2">{TREATMENT[l.treatment]}</td>
              <td className="px-2 py-2 font-mono text-xs">{l.rule}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{aed(l.vat)}</td>
              {expense && (
                <td className="px-2 py-2 text-right font-mono tabular-nums">
                  {aed(l.recoverable)}
                  <span className="block text-[11px] text-muted-foreground">{Math.round(l.recoverablePercent * 100)}%</span>
                </td>
              )}
              <td className="px-4 py-2 text-xs text-muted-foreground">{l.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Profile({ company, records, answers, onProfile }: { company: Company; records: ReturnType<typeof useTaxData>["companyRecords"]; answers: VatAnswers; onProfile: (patch: Partial<VatProfile>) => void }) {
  const profile = answers.profile
  const location = locationOf(company, profile)
  // Heads from every saved year, latest amounts first.
  const heads = useMemo(() => {
    const sorted = [...records].sort((a, b) => b.year - a.year)
    const map = new Map<string, ReturnType<typeof vatLines>[number]>()
    for (const record of sorted) for (const line of vatLines(record, records.find((r) => r.year === record.year - 1) ?? null)) if (!map.has(line.id)) map.set(line.id, line)
    return [...map.values()].sort((a, b) => (a.side === b.side ? b.annual - a.annual : a.side === "revenue" ? -1 : 1))
  }, [records])
  const split = profile.emirateSplit ?? {}
  const setHead = (id: string, value: VatProfile["heads"][string] | null) => {
    const next = { ...(profile.heads ?? {}) }
    if (value) next[id] = value
    else delete next[id]
    onProfile({ heads: next })
  }
  return (
    <div className="space-y-5">
      <section className="grid gap-4 rounded-lg border bg-white p-5 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          Location for VAT
          <select className="h-9 w-full rounded-md border bg-white px-2" value={profile.locationType ?? "auto"} onChange={(e) => onProfile({ locationType: e.target.value as VatProfile["locationType"] })}>
            <option value="auto">Automatic ({isFz(company) ? "free zone" : "mainland"})</option>
            <option value="mainland">Mainland</option>
            <option value="free_zone">Free zone (not designated)</option>
            <option value="designated_zone">Designated Zone</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm md:pt-6">
          <input type="checkbox" className="size-4" checked={Boolean(profile.taxGroup)} onChange={(e) => onProfile({ taxGroup: e.target.checked })} />
          Member of a VAT tax group
        </label>
        <div className="text-sm md:col-span-3">
          <p>Standard-rated sales by emirate of the establishment making the supply (Box 1a–1g), %</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {emirates.map((emirate) => (
              <label key={emirate} className="space-y-1 text-xs">
                {emirate}
                <NumberInput
                  placeholder={Object.keys(split).length ? "0" : emirate === (company.emirate || "Dubai") ? "100" : "0"}
                  value={split[emirate] ?? null}
                  allowEmpty
                  onChange={(v) => {
                    const next = { ...split }
                    if (v === null) delete next[emirate]
                    else next[emirate] = Math.max(0, Math.min(100, v))
                    onProfile({ emirateSplit: next })
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border bg-white">
        <h3 className="border-b px-5 py-2.5 font-semibold">How each head is treated for VAT</h3>
        <p className="px-5 pt-3 text-xs text-muted-foreground">
          Defaults come from the head name, your business activity ({company.businessActivity || "not recorded"}) and location. Change the rule or split a head between treatments by percentage.
        </p>
        <table className="mt-2 w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-y bg-secondary/40 text-left text-xs">
              <th className="px-4 py-2">Head</th>
              <th className="px-2 py-2 text-right">Latest year (AED)</th>
              <th className="px-2 py-2">VAT treatment</th>
              <th className="px-2 py-2">Used for</th>
              <th className="px-4 py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {heads.map((line) => {
              const auto = classify(line, company.businessActivity, location)
              const saved = profile.heads?.[line.id]
              const splits = saved?.splits ?? auto.splits
              const options = VAT_RULES.filter((rule) => rule.side === line.side)
              const change = (index: number, patch: Partial<{ rule: string; percent: number }>) =>
                setHead(line.id, { usedFor: saved?.usedFor ?? "auto", splits: splits.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
              return (
                <tr key={line.id} className="border-b align-top last:border-0">
                  <td className="px-4 py-2 font-medium">
                    {line.name}
                    <span className="block text-[11px] font-normal text-muted-foreground">{line.side === "revenue" ? "Income" : "Expense"}</span>
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{aed(line.annual)}</td>
                  <td className="space-y-1 px-2 py-2">
                    {splits.map((part, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <select className="h-8 w-80 rounded border bg-white px-1 text-xs" value={part.rule} onChange={(e) => change(i, { rule: e.target.value })}>
                          {options.map((rule) => (
                            <option key={rule.id} value={rule.id}>
                              {rule.id} · {rule.label}
                            </option>
                          ))}
                        </select>
                        {splits.length > 1 && (
                          <>
                            <span className="w-16">
                              <NumberInput value={part.percent} onChange={(v) => change(i, { percent: Math.max(0, Math.min(100, v ?? 0)) })} />
                            </span>
                            <span className="text-xs">%</span>
                            <button type="button" aria-label="Remove split" className="p-1 text-muted-foreground hover:text-destructive" onClick={() => setHead(line.id, { usedFor: saved?.usedFor ?? "auto", splits: splits.filter((_, j) => j !== i) })}>
                              <X className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                    <div className="flex gap-3 text-xs">
                      {splits.length < 6 && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                          onClick={() => {
                            const rest = Math.max(0, 100 - splits.reduce((t, s) => t + s.percent, 0))
                            const first = splits.length === 1 ? [{ ...splits[0], percent: 50 }] : splits
                            setHead(line.id, { usedFor: saved?.usedFor ?? "auto", splits: [...first, { rule: options[0].id, percent: splits.length === 1 ? 50 : rest }] })
                          }}
                        >
                          <Plus className="size-3" /> Split
                        </button>
                      )}
                      {saved && (
                        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setHead(line.id, null)}>
                          Reset to default
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {line.side === "expense" ? (
                      <select
                        className="h-8 rounded border bg-white px-1 text-xs"
                        value={saved?.usedFor ?? "auto"}
                        onChange={(e) => setHead(line.id, { splits, usedFor: e.target.value as "auto" })}
                      >
                        <option value="auto">Automatic</option>
                        <option value="taxable">Taxable supplies</option>
                        <option value="exempt">Exempt supplies</option>
                        <option value="mixed">Both (apportion)</option>
                      </select>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {saved ? "Set by you." : auto.reason}
                    {!saved && auto.flag && <span className="mt-1 block text-amber-800">{auto.flag}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted-foreground">{FOOTER}</p>
    </div>
  )
}

function isFz(company: Company) {
  return locationOf(company, {}) === "free_zone"
}
