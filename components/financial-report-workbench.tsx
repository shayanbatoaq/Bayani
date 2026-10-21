"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Download, FileSpreadsheet, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import type { FinancialRecord } from "@/lib/financial-statements"
import type { ReportSheet } from "@/lib/financial-workbook"
import { formatAmount } from "@/lib/trial-balance"

const SHEETS: { key: ReportSheet; label: string }[] = [
  { key: "schedules", label: "Schedules" },
  { key: "BS", label: "BS · Balance sheet" },
  { key: "INCOME", label: "INCOME" },
  { key: "EQUITY", label: "EQUITY" },
]

export function FinancialReportWorkbench() {
  const [records, setRecords] = useState<FinancialRecord[]>([])
  const [clientId, setClientId] = useState("")
  const [years, setYears] = useState<number[]>([])
  const [sheets, setSheets] = useState<ReportSheet[]>(
    SHEETS.map((sheet) => sheet.key)
  )
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<ReportSheet>("schedules")
  const [previewYear, setPreviewYear] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/financial-data", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setRecords(data.records)
        if (data.records[0]) {
          setClientId(data.records[0].clientId)
          setYears([data.records[0].year])
          setPreviewYear(data.records[0].year)
        }
      })
      .catch((cause) => {
        if (cause.name !== "AbortError") setError(cause.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])
  const clients = [
    ...new Map(
      records.map((record) => [record.clientId, record.clientName])
    ).entries(),
  ]
  const clientRecords = records.filter((record) => record.clientId === clientId)
  const selectedRecords = clientRecords.filter((record) =>
    years.includes(record.year)
  )
  const preview =
    selectedRecords.find((record) => record.year === previewYear) ??
    selectedRecords[0]
  const unmapped = selectedRecords.some(
    (record) => record.statements.unmapped.length > 0
  )
  const mixedCurrencies =
    new Set(selectedRecords.map((record) => record.currency)).size > 1

  async function download(format: "xlsx" | "pdf") {
    setDownloading(true)
    setError("")
    try {
      const query = new URLSearchParams({
        clientId,
        years: years.join(","),
        sheets: sheets.join(","),
        format,
      })
      const response = await fetch(`/api/financial-data/export?${query}`)
      if (!response.ok) throw new Error((await response.json()).error)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `financial-statements-${[...years].sort((a, b) => b - a).join("-")}.${format}`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.")
    } finally {
      setDownloading(false)
    }
  }

  if (loading)
    return (
      <p role="status" className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" />
        Loading saved financial data...
      </p>
    )
  if (!records.length)
    return (
      <div className="space-y-5 border-y py-12 text-center">
        <FileSpreadsheet className="mx-auto size-9 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No financial data saved yet</h2>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button asChild>
          <Link href="/data-input">
            Add financial data
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    )

  return (
    <div className="space-y-7">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <Label htmlFor="report-client">Client</Label>
          <select
            id="report-client"
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value)
              const available = records.filter(
                (record) => record.clientId === event.target.value
              )
              setYears(available[0] ? [available[0].year] : [])
              setError("")
            }}
            className="h-11 w-full rounded-md border bg-white px-3"
          >
            {clients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Reporting years</legend>
          <div className="flex flex-wrap gap-3">
            {clientRecords.map((record) => (
              <label
                key={record.id}
                className="flex items-center gap-2 rounded-md border bg-white px-3 py-2.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={years.includes(record.year)}
                  onChange={(event) =>
                    setYears((current) =>
                      event.target.checked
                        ? [...current, record.year]
                        : current.filter((year) => year !== record.year)
                    )
                  }
                  className="size-4 accent-emerald-800"
                />
                {record.year}
                <span className="text-xs text-muted-foreground">
                  {record.currency}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <fieldset className="border-y py-5">
        <legend className="px-1 text-sm font-medium">
          Include in download
        </legend>
        <div className="flex flex-wrap gap-x-7 gap-y-4">
          {SHEETS.map((sheet) => (
            <label key={sheet.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-emerald-800"
                checked={sheets.includes(sheet.key)}
                onChange={(event) =>
                  setSheets((current) =>
                    event.target.checked
                      ? [...current, sheet.key]
                      : current.filter((value) => value !== sheet.key)
                  )
                }
              />
              {sheet.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={
            downloading ||
            !years.length ||
            years.length > 10 ||
            !sheets.length ||
            unmapped ||
            mixedCurrencies
          }
          onClick={() => download("xlsx")}
        >
          <Download className="size-4" />
          {downloading ? "Preparing download..." : "Download Excel"}
        </Button>
        <Button
          variant="outline"
          disabled={
            downloading ||
            !years.length ||
            years.length > 10 ||
            !sheets.length ||
            unmapped ||
            mixedCurrencies
          }
          onClick={() => download("pdf")}
        >
          <Download className="size-4" />
          Download PDF
        </Button>
        <Button asChild variant="ghost">
          <Link href="/data-input">
            Edit financial data
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
      {(!years.length || !sheets.length) && (
        <p role="status" className="text-sm text-muted-foreground">
          Select at least one year and one statement.
        </p>
      )}
      {years.length > 10 && (
        <p role="alert" className="text-sm text-destructive">
          Select no more than 10 years per download.
        </p>
      )}
      {mixedCurrencies && (
        <p role="alert" className="text-sm text-destructive">
          Choose years with the same reporting currency.
        </p>
      )}
      {unmapped && (
        <p role="alert" className="text-sm text-amber-800">
          Some ledgers need a financial schedule. Complete their allocation in
          Data Input before downloading.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {preview && (
        <section className="min-w-0 space-y-4 border-t pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Financial statements</h2>
            <div className="flex items-center gap-3 text-sm">
              <Label htmlFor="preview-year">Preview year</Label>
              <select
                id="preview-year"
                value={preview.year}
                onChange={(event) => setPreviewYear(Number(event.target.value))}
                className="rounded-md border bg-white p-2"
              >
                {selectedRecords.map((record) => (
                  <option key={record.id} value={record.year}>
                    {record.year}
                  </option>
                ))}
              </select>
              <span>{preview.currency}</span>
            </div>
          </div>
          {preview.statements.warnings.length > 0 && (
            <ul className="list-inside list-disc space-y-1 border-l-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
              {preview.statements.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as ReportSheet)}
            className="min-w-0 flex-col gap-4"
          >
            <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1 border bg-white p-1">
              {SHEETS.map((sheet) => (
                <TabsTrigger
                  key={sheet.key}
                  value={sheet.key}
                  className="h-9 px-3 data-[state=active]:bg-primary data-[state=active]:text-white"
                >
                  {sheet.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {SHEETS.map(({ key }) => (
              <TabsContent key={key} value={key} className="min-w-0">
                <div className="overflow-hidden rounded-lg border bg-white">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {key === "EQUITY" ? "Movement" : "Particulars"}
                        </TableHead>
                        {key === "EQUITY" ? (
                          [
                            "Share capital",
                            "Current year earnings",
                            "Retained earnings",
                            "Shareholders current account",
                            "Total",
                          ].map((label) => (
                            <TableHead key={label} className="text-right">
                              {label}
                            </TableHead>
                          ))
                        ) : (
                          <>
                            <TableHead>Note</TableHead>
                            <TableHead className="text-right">
                              {preview.year} · {preview.currency}
                            </TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {key === "EQUITY"
                        ? preview.statements.equity.map((line) => (
                            <TableRow
                              key={line.label}
                              className={
                                line.kind === "total"
                                  ? "bg-secondary font-semibold"
                                  : ""
                              }
                            >
                              <TableCell className="min-w-52 whitespace-normal">
                                {line.label}
                              </TableCell>
                              {line.values.map((value, index) => (
                                <TableCell
                                  key={index}
                                  className="text-right font-mono"
                                >
                                  {value === null
                                    ? "n.a."
                                    : formatAmount(value)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        : (key === "BS"
                            ? preview.statements.bs
                            : key === "INCOME"
                              ? preview.statements.income
                              : preview.statements.schedules
                          ).map((line) => (
                            <TableRow
                              key={line.row}
                              className={
                                line.kind ? "bg-secondary/60 font-semibold" : ""
                              }
                            >
                              <TableCell className="min-w-48 whitespace-normal">
                                {line.label}
                              </TableCell>
                              <TableCell>{line.note ?? ""}</TableCell>
                              <TableCell className="text-right font-mono">
                                {line.amount === null
                                  ? ""
                                  : formatAmount(line.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </section>
      )}
    </div>
  )
}
