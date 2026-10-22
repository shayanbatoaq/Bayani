"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AlertCircle, ArrowRight, FileDown, FileSpreadsheet as Sheet, FileText, Loader2 } from "lucide-react"

import { ReportView } from "@/components/report-view"

import { Button } from "@/components/ui/button"
import type { Company } from "@/lib/company"
import type { FinancialRecord } from "@/lib/financial-statements"
import type { ReportModel } from "@/lib/report-model"

export function ReportsWorkbench() {
  const params = useSearchParams()
  const [companies, setCompanies] = useState<Company[]>([])
  const [records, setRecords] = useState<FinancialRecord[]>([])
  const [companyId, setCompanyId] = useState("")
  const [year, setYear] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<{ key: string; model: ReportModel | null; error?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<"pdf" | "excel" | null>(null)
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
        const first = companyData.companies[0]
        if (first) {
          setCompanyId(first.id)
          const saved = (recordData.records as FinancialRecord[])
            .filter((record) => record.clientId === first.id)
            .map((record) => record.year)
          const requested = Number(params.get("year"))
          setYear(saved.includes(requested) ? requested : saved.length ? Math.max(...saved) : null)
        }
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [params])

  const modelKey = companyId && year ? `${companyId}:${year}` : ""
  useEffect(() => {
    if (!modelKey) return
    const [id, y] = modelKey.split(":")
    const controller = new AbortController()
    fetch(`/api/reports/model?companyId=${id}&year=${y}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setLoaded({ key: modelKey, model: data.model })
      })
      .catch((cause) => {
        if (cause.name !== "AbortError") setLoaded({ key: modelKey, model: null, error: cause.message })
      })
    return () => controller.abort()
  }, [modelKey])
  const model = loaded?.key === modelKey ? loaded.model : null
  const modelLoading = Boolean(modelKey) && loaded?.key !== modelKey
  const modelError = loaded?.key === modelKey ? loaded.error : undefined

  const company = companies.find((item) => item.id === companyId)
  const savedYears = records
    .filter((record) => record.clientId === companyId)
    .map((record) => record.year)
    .sort((a, b) => b - a)
  const current = records.find((record) => record.clientId === companyId && record.year === year)
  const unmapped = current?.statements.unmapped.length ?? 0

  async function download(kind: "pdf" | "excel") {
    if (!companyId || !year) return
    setDownloading(kind)
    setError("")
    try {
      const response = await fetch(`/api/reports/${kind === "pdf" ? "statements" : "excel"}?companyId=${companyId}&year=${year}`)
      if (!response.ok) throw new Error((await response.json()).error)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${(company?.name ?? "Company").replace(/[^A-Za-z0-9]+/g, "-")}-Financial-Statements-${year}.${kind === "pdf" ? "pdf" : "xlsx"}`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.")
    } finally {
      setDownloading(null)
    }
  }

  if (loading)
    return (
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading...
      </p>
    )

  if (!company || !savedYears.length)
    return (
      <div className="space-y-4 rounded-xl border bg-white p-10 text-center">
        <FileText className="mx-auto size-9 text-muted-foreground" />
        <h2 className="text-xl font-semibold">No saved data yet</h2>
        <p className="text-sm text-muted-foreground">
          {company ? "Save a year in Data Input to generate its financial statements." : "Add your company on the Dashboard first."}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button asChild>
          <Link href={company ? "/data-input" : "/dashboard"}>
            {company ? "Go to Data Input" : "Go to Dashboard"} <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Company</p>
            {companies.length > 1 ? (
              <select
                aria-label="Company"
                className="mt-1 h-10 rounded-md border bg-white px-3 text-sm"
                value={companyId}
                onChange={(event) => {
                  setCompanyId(event.target.value)
                  const saved = records.filter((r) => r.clientId === event.target.value).map((r) => r.year)
                  setYear(saved.length ? Math.max(...saved) : null)
                }}
              >
                {companies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 text-lg font-semibold">{company.name}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Year</p>
            <div role="tablist" aria-label="Year" className="track mt-1">
              {savedYears.map((option) => (
                <button key={option} type="button" role="tab" aria-selected={option === year} className="track-item" onClick={() => setYear(option)}>
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => download("pdf")} disabled={Boolean(downloading) || !model || unmapped > 0}>
            {downloading === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            {downloading === "pdf" ? "Preparing PDF..." : "Download PDF"}
          </Button>
          <Button variant="outline" onClick={() => download("excel")} disabled={Boolean(downloading) || !model || unmapped > 0}>
            {downloading === "excel" ? <Loader2 className="size-4 animate-spin" /> : <Sheet className="size-4" />}
            {downloading === "excel" ? "Preparing Excel..." : "Download Excel"}
          </Button>
        </div>
      </div>

      {unmapped > 0 && (
        <p role="alert" className="flex items-start gap-2 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {unmapped} trial balance head{unmapped === 1 ? "" : "s"} still need classifying in Data Input before the report can be downloaded.
        </p>
      )}
      {(error || modelError) && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error || modelError}
        </p>
      )}
      {model && model.warnings.length > 0 && (
        <ul className="space-y-1 border-l-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
          {model.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {modelLoading && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Preparing statements...
        </p>
      )}

      {model && !modelLoading && <ReportView key={modelKey} model={model} records={records.filter((r) => r.clientId === companyId)} />}
    </div>
  )
}
