"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, Loader2, Pencil, RotateCcw, Save, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatLongDate, monthNames, quarterCycleLabel, type Company, type VatOverride } from "@/lib/company"
import type { FinancialRecord } from "@/lib/financial-statements"
import {
  CT_RATE,
  CT_ZERO_BAND,
  SBR_LAST_PERIOD_END,
  SBR_REVENUE_LIMIT,
  ctSchedule,
  vatSchedule,
  type VatRow,
} from "@/lib/tax"
import { cn } from "@/lib/utils"

const aed = (n: number) =>
  n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const short = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })

function useTaxData() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [records, setRecords] = useState<FinancialRecord[]>([])
  const [companyId, setCompanyId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    Promise.all([
      fetch("/api/companies", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/financial-data", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([companyData, recordData]) => {
        if (companyData.error || recordData.error) throw new Error(companyData.error || recordData.error)
        setCompanies(companyData.companies)
        setRecords(recordData.records)
        if (companyData.companies[0]) setCompanyId(companyData.companies[0].id)
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [])
  const company = companies.find((item) => item.id === companyId)
  const companyRecords = records.filter((record) => record.clientId === companyId)
  return { companies, setCompanies, company, companyId, setCompanyId, companyRecords, loading, error }
}

function CompanyPicker({ companies, companyId, onChange }: { companies: Company[]; companyId: string; onChange: (id: string) => void }) {
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

function NoData({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return (
    <div className="space-y-3 rounded-xl border bg-white p-10 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button asChild variant="outline">
        <Link href={href}>
          {action} <ArrowRight className="size-4" />
        </Link>
      </Button>
    </div>
  )
}

/* ============================ VAT ============================ */

export function VatWorkbench() {
  const data = useTaxData()
  const { company, companyRecords } = data
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<keyof VatOverride, string>>({ standardSales: "", zeroRatedSales: "", exemptSales: "", standardExpenses: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const rows = useMemo(() => (company ? vatSchedule(company, companyRecords) : []), [company, companyRecords])

  if (data.loading) return <Loading />
  if (!company) return <NoData title="No data" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />
  if (!company.vat.trn)
    return <NoData title="No VAT data" text="This company has no VAT registration. Add the VAT TRN and periods on the Dashboard if it is registered." href="/dashboard" action="Update company" />
  if (!companyRecords.length)
    return <NoData title="No VAT data" text="No trial balance has been saved yet. Save a year in Data Input to calculate VAT by period." href="/data-input" action="Go to Data Input" />
  if (!rows.length)
    return <NoData title="No VAT data" text={`No VAT periods fall within the saved years (registered from ${formatLongDate(company.vat.effectiveDate)}).`} href="/data-input" action="Go to Data Input" />

  const totals = rows.reduce(
    (t, r) => ({ out: t.out + r.outputVat, inp: t.inp + r.inputVat, net: t.net + r.netVat }),
    { out: 0, inp: 0, net: 0 }
  )

  async function persist(overrides: Record<string, VatOverride>) {
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/companies/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: company!.id, vatOverrides: overrides }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      data.setCompanies((current) => current.map((c) => (c.id === result.company.id ? result.company : c)))
      setEditing(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  function startEdit(row: VatRow) {
    setEditing(row.id)
    setDraft({
      standardSales: String(row.standardSales),
      zeroRatedSales: String(row.zeroRatedSales),
      exemptSales: String(row.exemptSales),
      standardExpenses: String(row.standardExpenses),
    })
  }
  const draftValid = Object.values(draft).every((v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <Fact label="Company" value={company.name} />
          <Fact label="VAT TRN" value={company.vat.trn} mono />
          <Fact label="Registered from" value={formatLongDate(company.vat.effectiveDate)} />
          <Fact
            label="Periods"
            value={company.vat.frequency === "monthly" ? "Monthly" : `Quarterly · ${quarterCycleLabel(company.vat.cycleStartMonth)}`}
          />
        </dl>
        <CompanyPicker companies={data.companies} companyId={data.companyId} onChange={data.setCompanyId} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Output VAT" value={totals.out} />
        <Stat label="Input VAT" value={totals.inp} />
        <Stat label={totals.net >= 0 ? "Net VAT payable" : "Net VAT refundable"} value={Math.abs(totals.net)} strong />
      </div>

      <p className="text-sm leading-6 text-muted-foreground">
        Estimated periods apportion each year&apos;s revenue and expenses by days, treating revenue as standard-rated and
        expenses other than payroll and depreciation as carrying recoverable VAT. Edit a period to enter the actual
        figures from its return.
      </p>
      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" /> {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Period</TableHead>
              <TableHead>Basis</TableHead>
              <TableHead className="text-right">Standard-rated<br />sales</TableHead>
              <TableHead className="text-right">Zero-rated &amp; exempt</TableHead>
              <TableHead className="text-right">Standard-rated<br />expenses</TableHead>
              <TableHead className="text-right">Output VAT</TableHead>
              <TableHead className="text-right">Input VAT</TableHead>
              <TableHead className="text-right">Net VAT</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) =>
              editing === row.id ? (
                <TableRow key={row.id} className="bg-secondary/40">
                  <TableCell className="whitespace-nowrap pl-4 font-medium">
                    {short(row.start)} – {short(row.end)}
                  </TableCell>
                  <TableCell>Entered</TableCell>
                  {([["standardSales"], ["zeroRatedSales", "exemptSales"], ["standardExpenses"]] as const).map((keys) => (
                    <TableCell key={keys[0]}>
                      <div className="flex flex-col gap-1">
                        {keys.map((key) => (
                          <Input
                            key={key}
                            aria-label={key}
                            title={{ standardSales: "Standard-rated sales", zeroRatedSales: "Zero-rated sales", exemptSales: "Exempt sales", standardExpenses: "Standard-rated expenses" }[key]}
                            placeholder={{ standardSales: "Standard", zeroRatedSales: "Zero-rated", exemptSales: "Exempt", standardExpenses: "Expenses" }[key]}
                            inputMode="decimal"
                            className="h-8 w-32 text-right font-mono"
                            value={draft[key]}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                          />
                        ))}
                      </div>
                    </TableCell>
                  ))}
                  <TableCell colSpan={3} />
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="icon-sm"
                        aria-label="Save period"
                        disabled={!draftValid || saving}
                        onClick={() =>
                          persist({
                            ...company.vatOverrides,
                            [row.id]: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Math.round(Number(v) * 100) / 100])) as VatOverride,
                          })
                        }
                      >
                        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap pl-4 font-medium">
                    {short(row.start)} – {short(row.end)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-xs font-medium",
                        row.source === "Entered" ? "bg-emerald-50 text-emerald-800" : row.source === "Partial data" ? "bg-amber-50 text-amber-800" : "bg-secondary text-secondary-foreground"
                      )}
                    >
                      {row.source}
                    </span>
                  </TableCell>
                  <Num value={row.standardSales} />
                  <Num value={row.zeroRatedSales + row.exemptSales} />
                  <Num value={row.standardExpenses} />
                  <Num value={row.outputVat} />
                  <Num value={row.inputVat} />
                  <Num value={row.netVat} strong />
                  <TableCell className="whitespace-nowrap text-sm">{short(row.dueDate)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit period ${row.start}`} onClick={() => startEdit(row)}>
                        <Pencil className="size-4" />
                      </Button>
                      {row.source === "Entered" && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Revert to estimate"
                          onClick={() => {
                            const next = { ...company.vatOverrides }
                            delete next[row.id]
                            void persist(next)
                          }}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>
      {rows.some((r) => r.source === "Partial data") && (
        <p className="text-sm text-amber-800">
          “Partial data” periods extend into a year with no saved trial balance, so they cover only part of the period.
        </p>
      )}
    </div>
  )
}

/* ============================ Corporate tax ============================ */

export function CorporateTaxWorkbench() {
  const data = useTaxData()
  const { company, companyRecords } = data
  const rows = useMemo(() => (company ? ctSchedule(company, companyRecords) : []), [company, companyRecords])

  if (data.loading) return <Loading />
  if (!company) return <NoData title="No data" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />
  if (!company.ct.trn)
    return <NoData title="No corporate tax data" text="This company has no corporate tax registration. Add the CT TRN and tax period on the Dashboard." href="/dashboard" action="Update company" />
  if (!companyRecords.length)
    return <NoData title="No corporate tax data" text="No trial balance has been saved yet. Save a year in Data Input." href="/data-input" action="Go to Data Input" />

  const lines: { label: string; get: (r: (typeof rows)[number]) => string; strong?: boolean }[] = [
    { label: "Revenue (for small business relief test)", get: (r) => aed(r.revenue) },
    { label: "Accounting profit / (loss)", get: (r) => aed(r.accountingProfit) },
    { label: "Add: 50% of entertainment expenses", get: (r) => aed(r.entertainmentAddBack) },
    { label: "Taxable income / (loss)", get: (r) => aed(r.taxableIncome), strong: true },
    { label: "Tax losses brought forward", get: (r) => aed(r.lossBroughtForward) },
    { label: "Losses used (max 75% of taxable income)", get: (r) => (r.lossUsed ? `(${aed(r.lossUsed)})` : aed(0)) },
    { label: "Taxable income after losses", get: (r) => aed(r.taxableAfterLosses), strong: true },
    { label: `Corporate tax at ${CT_RATE * 100}% above AED ${CT_ZERO_BAND.toLocaleString("en-AE")}`, get: (r) => aed(r.ctStandard), strong: true },
    { label: "Small business relief", get: (r) => (r.sbrEligible ? "Eligible (CT nil if elected)" : "Not eligible") },
    { label: "If relief elected, corporate tax", get: (r) => (r.sbrEligible ? aed(0) : "—") },
    { label: "Tax losses carried forward", get: (r) => aed(r.lossCarriedForward) },
  ]
  const inScope = rows.filter((r) => r.status === "In scope")
  const outScope = rows.filter((r) => r.status !== "In scope")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
          <Fact label="Company" value={company.name} />
          <Fact label="CT TRN" value={company.ct.trn} mono />
          <Fact label="Tax period ends" value={monthNames[company.ct.yearEndMonth - 1]} />
          {company.ct.firstPeriodStart && <Fact label="First tax period from" value={formatLongDate(company.ct.firstPeriodStart)} />}
        </dl>
        <CompanyPicker companies={data.companies} companyId={data.companyId} onChange={data.setCompanyId} />
      </div>

      {inScope.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Tax period</TableHead>
                {inScope.map((r) => (
                  <TableHead key={r.year} className="min-w-44 text-right">
                    {short(r.periodStart)} –<br />
                    {short(r.periodEnd)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.label} className={cn(line.strong && "bg-secondary/50 font-semibold")}>
                  <TableCell className="pl-4">{line.label}</TableCell>
                  {inScope.map((r) => (
                    <TableCell key={r.year} className="text-right font-mono tabular-nums">
                      {line.get(r)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="pl-4 font-medium">Return and payment due</TableCell>
                {inScope.map((r) => (
                  <TableCell key={r.year} className="text-right font-medium">
                    {formatLongDate(r.dueDate)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ) : (
        <NoData title="No tax periods in scope" text="None of the saved years fall within the corporate tax regime for this registration." href="/data-input" action="Go to Data Input" />
      )}

      {outScope.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {outScope.map((r) => (
            <li key={r.year}>
              {r.year}: {r.status === "Before CT regime" ? "not subject to corporate tax (period began before 1 June 2023)." : "before the first tax period on the registration."}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm leading-6 text-muted-foreground">
        Small business relief applies where revenue is AED {SBR_REVENUE_LIMIT.toLocaleString("en-AE")} or less, for tax
        periods ending by {formatLongDate(SBR_LAST_PERIOD_END)}, and must be elected in the return. Adjustments other
        than entertainment (for example related-party or exempt income) are not included.
      </p>
    </div>
  )
}

function Loading() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm">
      <Loader2 className="size-4 animate-spin" /> Loading...
    </p>
  )
}
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-medium", mono && "font-mono")}>{value}</dd>
    </div>
  )
}
function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-white p-4", strong && "border-primary/40")}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">AED {aed(value)}</p>
    </div>
  )
}
function Num({ value, strong }: { value: number; strong?: boolean }) {
  return <TableCell className={cn("text-right font-mono tabular-nums", strong && "font-semibold")}>{aed(value)}</TableCell>
}
