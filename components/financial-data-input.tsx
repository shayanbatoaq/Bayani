"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, Building2, CheckCircle2, Loader2, Save } from "lucide-react"

import { DataInputWorkbench } from "@/components/data-input-workbench"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { financialPeriod, formatLongDate, type Company } from "@/lib/company"
import {
  calculateFinancials,
  scheduleValue,
  type FinancialRecord,
  type OpeningEquity,
} from "@/lib/financial-statements"
import type { CustomHead } from "@/lib/ledger-heads"
import { createLedgerRow, type LedgerRow } from "@/lib/trial-balance"
import { cn } from "@/lib/utils"

const MAX_YEARS = 5
const OPENING_FIELDS = [
  ["capital", "Share capital"],
  ["earnings", "Prior-year earnings"],
  ["retained", "Retained earnings"],
  ["shareholder", "Shareholders' current account"],
] as const
type OpeningText = Record<(typeof OPENING_FIELDS)[number][0], string>
const BLANK: OpeningText = { capital: "", earnings: "", retained: "", shareholder: "" }

export function FinancialDataInput() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [records, setRecords] = useState<FinancialRecord[]>([])
  const [companyId, setCompanyId] = useState("")
  const [year, setYear] = useState<number | null>(null)
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [opening, setOpening] = useState<OpeningText>(BLANK)
  const [openingSource, setOpeningSource] = useState<"saved" | "prior" | "manual" | "">("")
  const [openingOpen, setOpeningOpen] = useState(true)
  const [revision, setRevision] = useState(0)
  const [savedSignature, setSavedSignature] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    Promise.all([
      fetch("/api/companies", { cache: "no-store" }).then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error))))),
      fetch("/api/financial-data", { cache: "no-store" }).then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error))))),
    ])
      .then(([companyData, recordData]) => {
        setCompanies(companyData.companies)
        setRecords(recordData.records)
        if (companyData.companies[0]) setCompanyId(companyData.companies[0].id)
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [])

  const company = companies.find((item) => item.id === companyId)
  const companyRecords = useMemo(
    () => records.filter((record) => record.clientId === companyId),
    [records, companyId]
  )
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: MAX_YEARS }, (_, i) => thisYear - MAX_YEARS + 1 + i)

  const openingComplete = Object.values(opening).every((v) => v.trim() !== "" && Number.isFinite(Number(v)))
  const openingPartial = Object.values(opening).some((v) => v.trim() !== "") && !openingComplete
  const openingEquity = openingComplete
    ? (Object.fromEntries(Object.entries(opening).map(([k, v]) => [k, Number(v)])) as OpeningEquity)
    : null
  const input = company && year
    ? {
        clientId: company.id,
        clientName: company.name,
        year,
        currency: "AED",
        openingEquity,
        rows: rows.map((row) => ({ id: row.id, ledgerName: row.ledgerName, amount: row.amount, scheduleKey: row.scheduleKey ?? "" })),
      }
    : null
  const signature = input ? JSON.stringify(input) : ""
  const dirty = Boolean(input) && signature !== savedSignature && (rows.length > 0 || revision > 0)
  const statements = input ? calculateFinancials(input) : null

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  function selectYear(next: number) {
    if (!company) return
    if (dirty && !window.confirm(`Discard unsaved changes to ${year}?`)) return
    const record = companyRecords.find((item) => item.year === next)
    const prior = companyRecords.find((item) => item.year === next - 1)
    const nextRows = record?.rows.map((row) => ({ ...createLedgerRow(row), ...row })) ?? []
    let nextOpening = BLANK
    let source: typeof openingSource = ""
    if (record?.openingEquity) {
      nextOpening = toText(record.openingEquity)
      source = "saved"
    } else if (prior) {
      const closing = prior.statements.closingEquity
      nextOpening = toText(closing)
      source = "prior"
    }
    setYear(next)
    setRows(nextRows)
    setOpening(nextOpening)
    setOpeningSource(source)
    setOpeningOpen(!record?.openingEquity && !prior)
    setRevision(record?.revision ?? 0)
    setMessage("")
    setError("")
    setSavedSignature(
      record
        ? JSON.stringify({
            clientId: company.id,
            clientName: company.name,
            year: next,
            currency: "AED",
            openingEquity: record.openingEquity,
            rows: record.rows,
          })
        : ""
    )
  }

  async function addCustomHead(head: CustomHead) {
    if (!company) return
    const heads = [...company.customHeads.filter((h) => h.name.toLowerCase() !== head.name.toLowerCase()), head]
    const response = await fetch("/api/companies/extras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: company.id, customHeads: heads }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error)
    setCompanies((current) => current.map((item) => (item.id === company.id ? data.company : item)))
  }

  function useTrialBalanceEquity() {
    if (!statements) return
    setOpening({
      capital: String(scheduleValue(statements, "capital")),
      earnings: "0",
      retained: String(scheduleValue(statements, "retained")),
      shareholder: String(scheduleValue(statements, "shareholder")),
    })
    setOpeningSource("manual")
  }

  async function save() {
    if (!input) return
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const response = await fetch("/api/financial-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, revision }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setRecords((current) => [...current.filter((r) => r.id !== data.record.id), data.record])
      setRevision(data.record.revision)
      setSavedSignature(signature)
      setMessage(`${year} saved.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save.")
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading...
      </p>
    )

  if (!companies.length)
    return (
      <div className="space-y-4 rounded-xl border bg-white p-10 text-center">
        <Building2 className="mx-auto size-9 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Add your company first</h2>
        <p className="text-sm text-muted-foreground">Data input is saved against the company in your profile.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button asChild>
          <Link href="/profile">
            Go to Profile <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    )

  const period = year ? financialPeriod(year, company?.ct.yearEndMonth ?? 12) : null

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-6">
        {companies.length > 1 ? (
          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <select
              id="company"
              className="h-10 rounded-md border bg-white px-3 text-sm"
              value={companyId}
              onChange={(event) => {
                if (dirty && !window.confirm("Discard unsaved changes?")) return
                setCompanyId(event.target.value)
                setYear(null)
                setRows([])
              }}
            >
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Company</p>
            <p className="mt-1 text-lg font-semibold">{company?.name}</p>
          </div>
        )}
      </div>

      <fieldset>
        <legend className="mb-3 text-sm font-medium">Upload data for year</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {years.map((option) => {
            const saved = companyRecords.find((record) => record.year === option)
            return (
              <button
                key={option}
                type="button"
                aria-pressed={year === option}
                onClick={() => selectYear(option)}
                className={cn(
                  "rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-primary/60",
                  year === option && "border-primary bg-primary text-primary-foreground hover:border-primary"
                )}
              >
                <span className="block text-lg font-semibold">{option}</span>
                <span className={cn("mt-0.5 flex items-center gap-1 text-xs", year === option ? "text-white/80" : saved ? "text-emerald-700" : "text-muted-foreground")}>
                  {saved ? (
                    <>
                      <CheckCircle2 className="size-3.5" /> Saved
                    </>
                  ) : (
                    "No data"
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {year && company && (
        <>
          <p className="text-sm text-muted-foreground">
            Trial balance for the year {formatLongDate(period!.start)} – {formatLongDate(period!.end)}, before
            year-end closing entries.
          </p>
          <DataInputWorkbench
            key={`${company.id}-${year}`}
            rows={rows}
            onRowsChange={setRows}
            customHeads={company.customHeads}
            onAddCustomHead={addCustomHead}
          />

          {rows.length > 0 && statements && (
            <>
              <details
                className="rounded-xl border bg-white p-5"
                open={openingOpen}
                onToggle={(event) => setOpeningOpen(event.currentTarget.open)}
              >
                <summary className="cursor-pointer font-medium">
                  Opening equity at {formatLongDate(period!.start)}
                  {openingSource === "prior" && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">· carried from {year - 1}</span>
                  )}
                </summary>
                <p className="my-3 text-sm text-muted-foreground">
                  Needed for the statement of changes in equity. Credit balances as positive.
                  {!companyRecords.some((r) => r.year === year - 1) && " There is no saved prior year, so enter these or take them from this trial balance."}
                </p>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {OPENING_FIELDS.map(([key, label]) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`opening-${key}`}>{label}</Label>
                      <Input
                        id={`opening-${key}`}
                        inputMode="decimal"
                        className="font-mono"
                        value={opening[key]}
                        onChange={(event) => {
                          setOpening((current) => ({ ...current, [key]: event.target.value }))
                          setOpeningSource("manual")
                        }}
                      />
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-4" onClick={useTrialBalanceEquity}>
                  Use equity balances from this trial balance
                </Button>
                {openingPartial && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    Complete all four balances, or leave all four blank.
                  </p>
                )}
              </details>

              {statements.warnings.length > 0 && (
                <ul className="space-y-1 border-l-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
                  {statements.warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      {warning}
                    </li>
                  ))}
                </ul>
              )}

              <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-white/95 p-4 shadow-lg backdrop-blur lg:bottom-4">
                <Button onClick={save} disabled={saving || openingPartial || !dirty}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {saving ? "Saving..." : `Save ${year} data`}
                </Button>
                {revision > 0 && !dirty && (
                  <Button asChild variant="outline">
                    <Link href={`/reports?year=${year}`}>
                      View reports <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                )}
                <span className="text-sm text-muted-foreground">
                  {dirty ? "Unsaved changes" : revision ? "All changes saved" : ""}
                </span>
                {message && <span className="text-sm text-emerald-800">{message}</span>}
                {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function toText(values: OpeningEquity): OpeningText {
  return {
    capital: String(values.capital),
    earnings: String(values.earnings),
    retained: String(values.retained),
    shareholder: String(values.shareholder),
  }
}
