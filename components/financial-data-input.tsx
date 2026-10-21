"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, FolderOpen, Loader2, Plus, Save } from "lucide-react"
import { DataInputWorkbench } from "@/components/data-input-workbench"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  calculateFinancials,
  type FinancialRecord,
  type OpeningEquity,
} from "@/lib/financial-statements"
import { createLedgerRow, type LedgerRow } from "@/lib/trial-balance"

const EMPTY: LedgerRow[] = []
const OPENING = { capital: "", earnings: "", retained: "", shareholder: "" }

export function FinancialDataInput() {
  const [records, setRecords] = useState<FinancialRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [local, setLocal] = useState(false)
  const [clientId, setClientId] = useState("")
  const [clientName, setClientName] = useState("")
  const [year, setYear] = useState(new Date().getFullYear())
  const [currency, setCurrency] = useState("AED")
  const [opening, setOpening] = useState(OPENING)
  const [rows, setRows] = useState<LedgerRow[]>(EMPTY)
  const [initialRows, setInitialRows] = useState<LedgerRow[]>(EMPTY)
  const [editorKey, setEditorKey] = useState(0)
  const [revision, setRevision] = useState(0)
  const [savedSignature, setSavedSignature] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/financial-data", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setRecords(data.records)
        setLocal(data.localWorkspace)
        setClientId(crypto.randomUUID())
      })
      .catch((cause) => {
        if (cause.name !== "AbortError") setError(cause.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const openingValues = Object.values(opening)
  const openingComplete = openingValues.every(
    (value) => value.trim() !== "" && Number.isFinite(Number(value))
  )
  const openingPartial =
    openingValues.some((value) => value !== "") && !openingComplete
  const openingEquity = openingComplete
    ? (Object.fromEntries(
        Object.entries(opening).map(([key, value]) => [key, Number(value)])
      ) as OpeningEquity)
    : null
  const input = {
    clientId,
    clientName: clientName.trim(),
    year,
    currency,
    openingEquity,
    rows: rows.map((row) => ({
      id: row.id,
      ledgerName: row.ledgerName,
      amount: row.amount,
      scheduleKey: row.scheduleKey ?? "",
    })),
  }
  const signature = JSON.stringify(input)
  const dirty =
    (rows.length > 0 || savedSignature !== "") && signature !== savedSignature
  const statements = calculateFinancials(input)

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    const navigation = (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return
      const anchor = (event.target as Element).closest?.(
        "a[href]"
      ) as HTMLAnchorElement | null
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.getAttribute("aria-disabled") === "true"
      )
        return
      const url = new URL(anchor.href, window.location.href)
      if (
        url.origin === window.location.origin &&
        url.pathname !== window.location.pathname &&
        !window.confirm("Leave Data Input and discard unsaved changes?")
      ) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener("beforeunload", handler)
    document.addEventListener("click", navigation, true)
    return () => {
      window.removeEventListener("beforeunload", handler)
      document.removeEventListener("click", navigation, true)
    }
  }, [dirty])

  function openRecord(record?: FinancialRecord) {
    if (
      dirty &&
      !window.confirm("Discard unsaved changes and open another trial balance?")
    )
      return
    const nextRows =
      record?.rows.map((row) => ({ ...createLedgerRow(row), ...row })) ?? EMPTY
    setInitialRows(nextRows)
    setRows(nextRows)
    setEditorKey((key) => key + 1)
    setClientId(record?.clientId ?? crypto.randomUUID())
    setClientName(record?.clientName ?? "")
    setYear(record?.year ?? new Date().getFullYear())
    setCurrency(record?.currency ?? "AED")
    setOpening(
      record?.openingEquity
        ? {
            capital: String(record.openingEquity.capital),
            earnings: String(record.openingEquity.earnings),
            retained: String(record.openingEquity.retained),
            shareholder: String(record.openingEquity.shareholder),
          }
        : OPENING
    )
    setRevision(record?.revision ?? 0)
    setMessage("")
    setError("")
    setSavedSignature(
      record
        ? JSON.stringify({
            clientId: record.clientId,
            clientName: record.clientName,
            year: record.year,
            currency: record.currency,
            openingEquity: record.openingEquity,
            rows: record.rows,
          })
        : ""
    )
  }

  function newYear() {
    if (
      dirty &&
      !window.confirm(
        "Discard unsaved changes and start another reporting year?"
      )
    )
      return
    const previous = records
      .filter((record) => record.clientId === clientId)
      .sort((a, b) => b.year - a.year)[0]
    if (!previous) return
    const balances = previous.statements.closingEquity
    setYear(previous.year + 1)
    setOpening({
      capital: String(balances.capital),
      earnings: String(balances.earnings),
      retained: String(balances.retained),
      shareholder: String(balances.shareholder),
    })
    setRows(EMPTY)
    setInitialRows(EMPTY)
    setEditorKey((key) => key + 1)
    setRevision(0)
    setSavedSignature("")
    setMessage("")
  }

  async function save() {
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
      setRecords((current) =>
        [
          ...current.filter((record) => record.id !== data.record.id),
          data.record,
        ].sort((a, b) => b.year - a.year)
      )
      setRevision(data.record.revision)
      setSavedSignature(signature)
      setMessage(`Saved ${clientName} for ${year}.`)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save financial data."
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading financial records...
      </p>
    )

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 space-y-2 sm:w-auto sm:flex-1">
          <Label htmlFor="saved-trial-balance">
            <FolderOpen className="size-4" />
            Saved financial data
          </Label>
          <select
            id="saved-trial-balance"
            disabled={saving}
            className="h-10 w-full rounded-md border bg-white px-3 text-sm"
            value={revision ? `${clientId}-${year}` : ""}
            onChange={(event) => {
              const record = records.find(
                (item) => item.id === event.target.value
              )
              if (record) openRecord(record)
            }}
          >
            <option value="">New trial balance</option>
            {records.map((record) => (
              <option key={record.id} value={record.id}>
                {record.clientName} · {record.year} · {record.currency}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="outline"
          disabled={saving}
          onClick={() => openRecord()}
        >
          <Plus className="size-4" />
          New client
        </Button>
        <Button
          variant="outline"
          disabled={
            saving || !records.some((record) => record.clientId === clientId)
          }
          onClick={newYear}
        >
          <Plus className="size-4" />
          Add year
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_7rem]">
        <div className="space-y-2">
          <Label htmlFor="financial-client">Client / company name</Label>
          <Input
            id="financial-client"
            value={clientName}
            onChange={(event) => setClientName(event.target.value)}
            placeholder="Company name"
            maxLength={160}
            className="bg-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="financial-year">Reporting year</Label>
          <Input
            id="financial-year"
            type="number"
            min={1900}
            max={2200}
            value={year || ""}
            onChange={(event) => {
              setYear(Number(event.target.value))
              setRevision(0)
            }}
            className="bg-white"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="financial-currency">Currency</Label>
          <select
            id="financial-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className="h-9 w-full rounded-md border bg-white px-2 text-sm"
          >
            {["AED", "USD", "GBP", "EUR", "PKR"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
      </div>
      {local && (
        <p className="text-xs text-muted-foreground">
          Local workspace. Financial records are saved on this server and
          accessible from this browser workspace.
        </p>
      )}
      <DataInputWorkbench
        key={editorKey}
        initialRows={initialRows}
        onRowsChange={setRows}
      />
      {rows.length > 0 && (
        <>
          <details className="border-y py-4">
            <summary className="cursor-pointer font-medium">
              Opening equity for {year}
            </summary>
            <p className="my-3 text-sm text-muted-foreground">
              Balances at 1 January. Use positive credit balances, negative
              deficits, and zero where applicable. All four balances are needed
              to calculate equity movements.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(
                [
                  ["capital", "Share capital"],
                  ["earnings", "Prior-year earnings"],
                  ["retained", "Retained earnings"],
                  ["shareholder", "Shareholders current account"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`opening-${key}`}>{label}</Label>
                  <Input
                    id={`opening-${key}`}
                    inputMode="decimal"
                    value={opening[key]}
                    onChange={(event) =>
                      setOpening((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    className="bg-white"
                  />
                </div>
              ))}
            </div>
          </details>
          <p className="text-sm text-muted-foreground">
            Trial balance before year-end closing entries: debit balances
            positive; credit balances negative. Reporting date: 31 December{" "}
            {year}.
          </p>
          {statements.warnings.length > 0 && (
            <ul className="list-inside list-disc space-y-1 text-sm text-amber-800">
              {statements.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {openingPartial && (
            <p role="alert" className="text-sm text-destructive">
              Complete all four opening-equity balances, or leave all four
              blank.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t pt-5">
            <Button
              onClick={save}
              disabled={
                saving ||
                !clientName.trim() ||
                !clientId ||
                openingPartial ||
                !Number.isInteger(year) ||
                year < 1900 ||
                year > 2200
              }
            >
              <Save className="size-4" />
              {saving ? "Saving..." : "Save financial data"}
            </Button>
            <Button asChild variant="outline" disabled={dirty || !revision}>
              <Link
                href="/final-report"
                aria-disabled={dirty || !revision}
                onClick={(event) => {
                  if (dirty || !revision) event.preventDefault()
                }}
              >
                Final report
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <span className="text-sm text-muted-foreground">
              {dirty ? "Unsaved changes" : revision ? "Saved" : ""}
            </span>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-800">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
