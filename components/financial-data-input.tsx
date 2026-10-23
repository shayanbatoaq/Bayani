"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowRight, Building2, CheckCircle2, CloudUpload, Loader2, RotateCcw } from "lucide-react"

import { DataInputWorkbench } from "@/components/data-input-workbench"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { financialPeriod, formatLongDate, type Company } from "@/lib/company"
import {
  categoryOf,
  scheduleValue,
  type FinancialLedger,
  type FinancialRecord,
  type OpeningEquity,
} from "@/lib/financial-statements"
import { toPlain, type CustomHead } from "@/lib/ledger-heads"
import { isBookRow } from "@/lib/books-engine"
import { closingRowsFor, priorYearOf, statementsFor, type EntryMode, type PriorYear } from "@/lib/movement"
import { formatAmount } from "@/lib/trial-balance"
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
  const [entryMode, setEntryMode] = useState<EntryMode>("closing")
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
        entryMode,
      }
    : null
  // Rows from invoices, bills and adjustments: shown and counted, never saved with the typed figures.
  const bookRows = useMemo(() => (companyId && year ? (records.find((r) => r.clientId === companyId && r.year === year)?.rows ?? []).filter(isBookRow) : []), [records, companyId, year])
  const signature = input ? JSON.stringify(input) : ""
  const dirty = Boolean(input) && signature !== savedSignature && (rows.length > 0 || revision > 0)
  const prior = company && year ? priorYearOf(records, company.id, year) : null
  const preview = input ? { ...input, rows: [...input.rows, ...bookRows] } : null
  const resolved = preview ? statementsFor(preview, prior) : null
  const statements = resolved?.statements ?? null

  // Figures save themselves: shortly after each change, and straight away when leaving the page.
  const canSave = Boolean(input) && rows.length > 0 && !openingPartial
  const latest = useRef({ input, revision, signature, dirty, canSave })
  useEffect(() => {
    latest.current = { ...latest.current, input, signature, dirty, canSave, revision: Math.max(latest.current.revision, revision) }
  }, [signature, dirty, canSave, revision]) // eslint-disable-line react-hooks/exhaustive-deps -- the signature changes whenever the input does
  const inFlight = useRef<Promise<void> | null>(null)

  useEffect(() => {
    const flush = () => {
      const { input: pending, revision: rev, dirty: unsaved, canSave: ok } = latest.current
      if (!pending || !unsaved || !ok || inFlight.current) return
      fetch("/api/financial-data", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pending, revision: rev }) }).catch(() => {})
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush() // moving to another tab of the app
    }
  }, [])

  async function selectYear(next: number) {
    if (!company) return
    if (dirty && canSave) await save()
    const record = companyRecords.find((item) => item.year === next)
    const prior = companyRecords.find((item) => item.year === next - 1)
    const nextMode: EntryMode = record?.entryMode ?? (prior ? "movement" : "closing")
    const nextRows = record?.rows.filter((row) => !isBookRow(row)).map((row) => ({ ...createLedgerRow(row), ...row })) ?? []
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
    setEntryMode(nextMode)
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
            rows: record.rows.filter((row) => !isBookRow(row)),
            entryMode: nextMode,
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

  async function saveBankRules(rules: { pattern: string; category: string }[]) {
    if (!company) return
    const response = await fetch("/api/companies/extras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: company.id, bankRules: rules }),
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

  async function save(): Promise<void> {
    if (inFlight.current) {
      await inFlight.current
      if (!latest.current.dirty) return
    }
    const { input: pending, revision: rev, signature: sent } = latest.current
    if (!pending || !latest.current.canSave) return
    const run = (async () => {
      setSaving(true)
      setError("")
      try {
        const response = await fetch("/api/financial-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...pending, revision: rev }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        latest.current.revision = data.record.revision
        setRecords((current) => [...current.filter((r) => r.id !== data.record.id), data.record])
        // Later movement years build on this one, so refresh them too.
        fetch("/api/financial-data", { cache: "no-store" })
          .then((r) => r.json())
          .then((all) => all.records && setRecords(all.records))
          .catch(() => {})
        setRevision(data.record.revision)
        setSavedSignature(sent)
        setMessage(`Saved ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to save.")
      } finally {
        setSaving(false)
      }
    })()
    inFlight.current = run
    try {
      await run
    } finally {
      inFlight.current = null
    }
  }

  useEffect(() => {
    if (!dirty || !canSave) return
    const timer = setTimeout(() => void save(), 1200)
    return () => clearTimeout(timer)
  }, [signature, dirty, canSave])

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
        <p className="text-sm text-muted-foreground">Data input is saved against the company on your dashboard.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button asChild>
          <Link href="/dashboard">
            Go to Dashboard <ArrowRight className="size-4" />
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
              onChange={async (event) => {
                const next = event.target.value
                if (dirty && canSave) await save()
                setCompanyId(next)
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
          <EntryModePicker
            value={entryMode}
            onChange={setEntryMode}
            year={year}
            hasPrior={Boolean(prior)}
            period={`${formatLongDate(period!.start)} – ${formatLongDate(period!.end)}`}
          />
          <DataInputWorkbench
            key={`${company.id}-${year}`}
            rows={rows}
            onRowsChange={setRows}
            customHeads={company.customHeads}
            onAddCustomHead={addCustomHead}
            entryMode={entryMode}
            statement={{
              companyName: company.name,
              period: period!,
              vatRegistered: Boolean(company.vat.trn),
              learned: company.bankRules ?? [],
              onSaveRules: saveBankRules,
              sessionKey: { companyId: company.id, year },
            }}
          />

          {entryMode === "movement" && prior && resolved && (
            <ClosingBalances
              year={year}
              prior={prior}
              movements={preview!.rows}
              closing={resolved.closingRows}
              customHeads={company.customHeads}
            />
          )}

          {bookRows.length > 0 && <BookRows rows={bookRows} />}

          {(rows.length > 0 || bookRows.length > 0) && statements && (
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
                  Needed for the statement of changes in equity. Enter amounts as positive numbers, and an accumulated loss as negative.
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

              {resolved && resolved.auto.length > 0 && (
                <div className="space-y-1 border-l-2 border-sky-600 bg-sky-50 p-4 text-sm text-sky-950">
                  {resolved.auto.map((entry) => (
                    <p key={entry.ledgerName} className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      {entry.reason}: {entry.ledgerName} {formatAmount(Math.abs(entry.amount))} added automatically, so the
                      assets&apos; book value falls by the same amount.
                      {Math.abs(statements.balanceDifference) >= 0.01 &&
                        " Depreciation is not a cash payment, so your other figures (usually Bank or Cash) now need to account for it before the figures balance."}
                    </p>
                  ))}
                </div>
              )}

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
                <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium", error ? "bg-[#fdecec] text-[#b42318]" : saving || dirty ? "bg-[var(--cobalt-wash)] text-[var(--cobalt)]" : "bg-[var(--lagoon-wash)] text-[#0d7d73]")}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : dirty ? <CloudUpload className="size-4" /> : <CheckCircle2 className="size-4" />}
                  {saving
                    ? "Saving…"
                    : openingPartial
                      ? "Complete the opening equity to save"
                      : dirty
                        ? "Saving shortly…"
                        : revision
                          ? `All changes saved${message ? ` · ${message.replace("Saved ", "")}` : ""}`
                          : ""}
                </span>
                {error && (
                  <Button size="sm" variant="outline" onClick={() => void save()}>
                    <RotateCcw className="size-4" /> Try again
                  </Button>
                )}
                {revision > 0 && !dirty && (
                  <Button asChild variant="outline">
                    <Link href={`/reports?year=${year}`}>
                      View reports <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                )}
                {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Read-only rows that come from Invoices, Bills and Adjustments. */
function BookRows({ rows }: { rows: FinancialLedger[] }) {
  return (
    <details className="rounded-xl border bg-white p-5" open>
      <summary className="cursor-pointer font-medium">From invoices, bills and adjusting entries ({rows.length})</summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Added automatically and kept up to date. Change them in{" "}
        <Link className="text-[var(--cobalt)] underline" href="/invoices">
          Invoices
        </Link>
        ,{" "}
        <Link className="text-[var(--cobalt)] underline" href="/bills">
          Bills
        </Link>{" "}
        or{" "}
        <Link className="text-[var(--cobalt)] underline" href="/adjustments">
          Adjustments
        </Link>
        . Debits are positive, credits negative.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[24rem] text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="py-1.5">{row.ledgerName}</td>
                <td className="py-1.5 text-right font-mono">{row.amount < 0 ? `(${formatAmount(-row.amount)})` : formatAmount(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
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

function EntryModePicker({
  value,
  onChange,
  year,
  hasPrior,
  period,
}: {
  value: EntryMode
  onChange: (mode: EntryMode) => void
  year: number
  hasPrior: boolean
  period: string
}) {
  const options: { mode: EntryMode; title: string; text: string }[] = [
    {
      mode: "movement",
      title: "Movement",
      text: hasPrior
        ? `Enter only what changed during ${year}. Balances from ${year - 1} (share capital, fixed assets, loans, bank and so on) are carried forward and your movements are added to them.`
        : `Enter what changed during ${year}. There is no saved ${year - 1}, so these figures are treated as the closing balances.`,
    },
    {
      mode: "closing",
      title: "Closing",
      text: `Enter every balance as at the end of ${year}, including those that did not change. The figures are reported exactly as entered.`,
    },
  ]
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">How are you entering {year}?</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.mode}
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border bg-white p-4 shadow-sm transition-colors hover:border-primary/60",
              value === option.mode && "border-primary ring-1 ring-primary"
            )}
          >
            <input
              type="radio"
              name="entry-mode"
              className="mt-1 accent-[var(--primary)]"
              checked={value === option.mode}
              onChange={() => onChange(option.mode)}
            />
            <span>
              <span className="block font-semibold">{option.title}</span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">{option.text}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Financial year {period}. Profit and loss heads are always the figures for the year.</p>
    </fieldset>
  )
}

/** Carried balance + movement = closing, for every balance sheet head. */
function ClosingBalances({
  year,
  prior,
  movements,
  closing,
  customHeads,
}: {
  year: number
  prior: PriorYear
  movements: FinancialLedger[]
  closing: FinancialLedger[]
  customHeads: CustomHead[]
}) {
  const carried = closingRowsFor({ rows: [], entryMode: "movement" }, prior).rows
  const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ")
  const sum = (list: FinancialLedger[], name: string) =>
    list.filter((row) => key(row.ledgerName) === key(name)).reduce((total, row) => total + row.amount, 0)
  const names = [...new Map([...carried, ...movements].filter((row) => categoryOf(row.scheduleKey)?.statement === "BS").map((row) => [key(row.ledgerName), row])).values()]
  const plain = (row: FinancialLedger, amount: number) => {
    const value = Math.round(toPlain(row.ledgerName, amount, row.scheduleKey, customHeads) * 100) / 100
    return value === 0 ? "-" : value < 0 ? `(${formatAmount(-value)})` : formatAmount(value)
  }
  return (
    <details className="rounded-xl border bg-white p-5" open>
      <summary className="cursor-pointer font-medium">Closing balances at the end of {year} (carried forward + movements)</summary>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Head</th>
              <th className="py-2 text-right">From {year - 1} (AED)</th>
              <th className="py-2 text-right">Movement (AED)</th>
              <th className="py-2 text-right">Closing (AED)</th>
            </tr>
          </thead>
          <tbody>
            {names.map((row) => (
              <tr key={row.ledgerName} className="border-b last:border-0">
                <td className="py-2">{row.ledgerName}</td>
                <td className="py-2 text-right font-mono">{plain(row, sum(carried, row.ledgerName))}</td>
                <td className="py-2 text-right font-mono">{plain(row, sum(movements, row.ledgerName))}</td>
                <td className="py-2 text-right font-mono font-semibold">{plain(row, sum(closing, row.ledgerName))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Retained earnings include {year - 1}&apos;s profit and drawings. Amounts in brackets are on the opposite side to usual (for example an overdrawn bank).
      </p>
    </details>
  )
}
