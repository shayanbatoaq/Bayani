"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AlertCircle, ArrowRight, Download, FileText, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Company } from "@/lib/company"
import type { FinancialRecord } from "@/lib/financial-statements"
import { reportIndex, type NoteBlock, type ReportModel, type Row } from "@/lib/report-model"
import { cn } from "@/lib/utils"

const SECTIONS = [
  "Cover",
  "Index",
  "Company information",
  "Financial position",
  "Comprehensive income",
  "Changes in equity",
  "Cash flows",
  "Accounting policies",
  "Notes",
] as const
type Section = (typeof SECTIONS)[number]

const fmt = (value: number | null | undefined) => {
  if (value === null || value === undefined) return ""
  const rounded = Math.round(value * 100) / 100
  if (rounded === 0) return "-"
  const text = Math.abs(rounded).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return rounded < 0 ? `(${text})` : text
}

export function ReportsWorkbench() {
  const params = useSearchParams()
  const [companies, setCompanies] = useState<Company[]>([])
  const [records, setRecords] = useState<FinancialRecord[]>([])
  const [companyId, setCompanyId] = useState("")
  const [year, setYear] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<{ key: string; model: ReportModel | null; error?: string } | null>(null)
  const [section, setSection] = useState<Section>("Financial position")
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
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

  async function download() {
    if (!companyId || !year) return
    setDownloading(true)
    setError("")
    try {
      const response = await fetch(`/api/reports/statements?companyId=${companyId}&year=${year}`)
      if (!response.ok) throw new Error((await response.json()).error)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${(company?.name ?? "Company").replace(/[^A-Za-z0-9]+/g, "-")}-Financial-Statements-${year}.pdf`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.")
    } finally {
      setDownloading(false)
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
          {company ? "Save a year in Data Input to generate its financial statements." : "Add your company in Profile first."}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button asChild>
          <Link href={company ? "/data-input" : "/profile"}>
            {company ? "Go to Data Input" : "Go to Profile"} <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Company</p>
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
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Year</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {savedYears.map((option) => (
                <Button key={option} size="sm" variant={option === year ? "default" : "outline"} onClick={() => setYear(option)}>
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <Button onClick={download} disabled={downloading || !model || unmapped > 0}>
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {downloading ? "Preparing PDF..." : "Download full report (PDF)"}
        </Button>
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

      {model && !modelLoading && (
        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Report sections" className="flex gap-1 overflow-x-auto lg:flex-col">
            {SECTIONS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSection(name)}
                className={cn(
                  "shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-white hover:text-foreground",
                  section === name && "bg-white text-foreground shadow-sm"
                )}
              >
                {name}
              </button>
            ))}
          </nav>
          <article className="min-h-[36rem] rounded-sm border bg-white px-6 py-10 font-serif text-[15px] leading-relaxed text-[#1b2a36] shadow-md sm:px-12">
            <SectionView model={model} section={section} />
          </article>
        </div>
      )}
    </div>
  )
}

function SectionView({ model, section }: { model: ReportModel; section: Section }) {
  if (section === "Cover")
    return (
      <div className="flex min-h-[30rem] flex-col items-center justify-center text-center">
        <div className="w-full border-y-2 border-[#1b2a36] px-4 py-10">
          <p className="text-3xl font-bold tracking-wide">{model.companyName.toUpperCase()}</p>
          <p className="mt-2 tracking-widest">{model.location}</p>
          <p className="mt-12 text-xl font-bold tracking-[0.2em]">FINANCIAL STATEMENTS</p>
          <p className="mt-2">FOR THE YEAR ENDED {model.periodEndText.toUpperCase()}</p>
        </div>
        <p className="mt-16 italic">Private &amp; Confidential</p>
      </div>
    )
  if (section === "Index")
    return (
      <>
        <Head model={model} title="Index to the financial statements" />
        <ol className="space-y-2">
          {reportIndex.map((name) => (
            <li key={name} className="border-b border-dotted pb-1">
              {name}
            </li>
          ))}
        </ol>
        <p className="mt-6 font-sans text-xs text-muted-foreground">Page numbers are filled in the PDF.</p>
      </>
    )
  if (section === "Company information")
    return (
      <>
        <Head model={model} title="Company information" />
        <dl className="space-y-4">
          {model.companyInfo.map((item) => (
            <div key={item.heading}>
              <dt className="text-sm font-bold uppercase">{item.heading}</dt>
              {item.text.map((line, i) => (
                <dd key={i}>{line}</dd>
              ))}
            </div>
          ))}
        </dl>
      </>
    )
  if (section === "Financial position")
    return (
      <>
        <Head model={model} title={`Statement of financial position as at ${model.periodEndText}`} />
        <Statement rows={model.bs} model={model} />
      </>
    )
  if (section === "Comprehensive income")
    return (
      <>
        <Head model={model} title={`Statement of comprehensive income ${model.yearEndedText}`} />
        <Statement rows={model.income} model={model} />
      </>
    )
  if (section === "Cash flows")
    return (
      <>
        <Head model={model} title={`Statement of cash flows ${model.yearEndedText}`} />
        <Statement rows={model.cashFlow} model={model} />
      </>
    )
  if (section === "Changes in equity")
    return (
      <>
        <Head model={model} title={`Statement of changes in equity ${model.yearEndedText}`} />
        {model.equity.map((table) => (
          <div key={table.year} className="mb-8 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b align-bottom">
                  <th className="py-1 text-left">{table.year}</th>
                  {table.columns.map((column) => (
                    <th key={column} className="w-28 py-1 text-right font-bold">
                      {column}
                      <br />
                      {model.currency}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.lines.map((line, i) => (
                  <tr key={i} className={cn(line.total && "border-t border-b-4 border-double border-[#1b2a36] font-bold")}>
                    <td className="py-1 pr-3">{line.label}</td>
                    {line.values.map((value, j) => (
                      <td key={j} className="py-1 text-right tabular-nums">
                        {value === null ? "n.a." : fmt(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </>
    )
  const blocks = section === "Accounting policies" ? model.policies : model.notes
  return (
    <>
      <Head
        model={model}
        title={`${section === "Accounting policies" ? "Significant accounting policies" : "Notes to the financial statements"} ${model.yearEndedText}`}
      />
      {blocks.map((note) => (
        <NoteView key={note.number} note={note} model={model} />
      ))}
    </>
  )
}

function Head({ model, title }: { model: ReportModel; title: string }) {
  return (
    <header className="mb-6">
      <p className="text-lg font-bold">{model.companyName}</p>
      <p className="text-sm font-bold uppercase">{title}</p>
    </header>
  )
}

function Statement({ rows, model, withNote = true }: { rows: Row[]; model: ReportModel; withNote?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b align-bottom">
          <th />
          {withNote && <th className="w-12 text-center">Note</th>}
          <th className="w-32 text-right">
            {model.year}
            <br />
            {model.currency}
          </th>
          {model.priorYear && (
            <th className="w-32 text-right">
              {model.priorYear}
              <br />
              {model.currency}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={i}
            className={cn(
              row.kind === "heading" && "font-bold [&>td]:pt-4",
              row.kind === "subtotal" && "border-t font-bold",
              row.kind === "total" && "border-t border-b-4 border-double border-[#1b2a36] font-bold"
            )}
          >
            <td className="py-1 pr-3">{row.label}</td>
            {withNote && <td className="text-center">{row.note ?? ""}</td>}
            <td className="text-right tabular-nums">{row.kind === "heading" ? "" : fmt(row.current)}</td>
            {model.priorYear && <td className="text-right tabular-nums">{row.kind === "heading" ? "" : fmt(row.prior)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NoteView({ note, model }: { note: NoteBlock; model: ReportModel }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 font-bold">
        {note.number}. {note.title.toUpperCase()}
      </h3>
      {note.paragraphs?.map((text, i) => (
        <p key={i} className="mb-2 text-justify">
          {text}
        </p>
      ))}
      {note.table && (
        <table className="my-2 w-full text-sm">
          <thead>
            <tr className="border-b">
              {note.table.head.map((cell, i) => (
                <th key={i} className={cn("py-1", i < 2 ? "text-left" : "text-right")}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {note.table.body.map((cells, r) => (
              <tr key={r} className={cn(r === note.table!.body.length - 1 && "border-t font-bold")}>
                {cells.map((cell, i) => (
                  <td key={i} className={cn("py-1", i < 2 ? "text-left" : "text-right tabular-nums")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note.rows && <Statement rows={note.rows} model={model} withNote={false} />}
    </section>
  )
}
