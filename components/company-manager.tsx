"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileText,
  FileUp,
  Landmark,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react"

import { CompanyForm } from "@/components/company-form"
import { Button } from "@/components/ui/button"
import {
  companyDocTypes,
  emptyCompanyDraft,
  formatLongDate,
  monthNames,
  quarterCycleLabel,
  type Company,
  type CompanyDocType,
  type CompanyDraft,
} from "@/lib/company"
import { readDocument, type ReadProgress } from "@/lib/document-reader"
import { cn } from "@/lib/utils"

type Extracted = {
  fields: Partial<CompanyDraft> & { vat?: Partial<CompanyDraft["vat"]>; ct?: Partial<CompanyDraft["ct"]> }
  sources: Record<string, string>
  issues: { level: "error" | "warning" | "info"; message: string }[]
  documents: { type: CompanyDocType; filename: string; detected: string; authority?: string }[]
  ai: "used" | "unavailable" | "failed"
}

type Mode = { kind: "list" } | { kind: "add" } | { kind: "edit"; company: Company }

export function CompanyManager() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [limit, setLimit] = useState(1)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [paywall, setPaywall] = useState(false)

  useEffect(() => {
    fetch("/api/companies", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        setCompanies(data.companies)
        setLimit(data.limit)
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [])

  function startAdd() {
    setNotice("")
    setError("")
    if (companies.length >= limit) {
      setPaywall(true)
      return
    }
    setMode({ kind: "add" })
  }

  async function save(draft: CompanyDraft, existing?: Company, documents?: { type: CompanyDocType; filename: string }[]) {
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: existing?.id, revision: existing?.revision, draft, documents }),
      })
      const data = await response.json()
      if (response.status === 402) {
        setPaywall(true)
        throw new Error(data.error)
      }
      if (!response.ok) throw new Error(data.error)
      setCompanies((current) =>
        existing
          ? current.map((company) => (company.id === data.company.id ? data.company : company))
          : [...current, data.company]
      )
      setMode({ kind: "list" })
      setNotice(`${data.company.name} ${existing ? "updated" : "saved"}.`)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the company.")
    } finally {
      setSaving(false)
    }
  }

  async function remove(company: Company) {
    setError("")
    setNotice("")
    const response = await fetch(`/api/companies?id=${company.id}`, { method: "DELETE" })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.error ?? "Could not delete the company.")
      return
    }
    setCompanies((current) => current.filter((item) => item.id !== company.id))
    setNotice(`${company.name} deleted.`)
  }

  if (loading)
    return (
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading...
      </p>
    )

  return (
    <div className="space-y-6">
      {notice && mode.kind === "list" && (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="size-4" />
          {notice}
          {companies.length > 0 && (
            <Link href="/data-input" className="ml-auto inline-flex items-center gap-1 font-medium text-primary">
              Continue to Data Input <ArrowRight className="size-3.5" />
            </Link>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {paywall && <Paywall onClose={() => setPaywall(false)} />}

      {mode.kind === "list" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Companies</h2>
              <p className="text-sm text-muted-foreground">
                {companies.length} of {limit} included in your plan
              </p>
            </div>
            {companies.length > 0 && (
              <Button onClick={startAdd} variant={companies.length >= limit ? "outline" : "default"}>
                {companies.length >= limit ? <Lock className="size-4" /> : <Plus className="size-4" />}
                Add company
              </Button>
            )}
          </div>
          {companies.length === 0 ? (
            <button
              type="button"
              onClick={startAdd}
              className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-white px-6 py-14 text-center transition-colors hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
              <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="size-7" />
              </span>
              <span className="text-lg font-semibold">Add company</span>
              <span className="max-w-md text-sm text-muted-foreground">
                Upload the Trade License, MOA, VAT Certificate and Corporate Tax Certificate. The details are read for you to check and save.
              </span>
            </button>
          ) : (
            companies.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                onEdit={() => {
                  setNotice("")
                  setMode({ kind: "edit", company })
                }}
                onDelete={() => remove(company)}
              />
            ))
          )}
        </section>
      )}

      {mode.kind !== "list" && (
        <CompanyEditor
          key={mode.kind === "edit" ? mode.company.id : "new"}
          company={mode.kind === "edit" ? mode.company : undefined}
          saving={saving}
          onSave={(draft, documents) => save(draft, mode.kind === "edit" ? mode.company : undefined, documents)}
          onCancel={() => {
            setError("")
            setMode({ kind: "list" })
          }}
        />
      )}
    </div>
  )
}

/** Four document windows, an Upload button that fills the details below, and Save. */
function CompanyEditor({
  company,
  saving,
  onSave,
  onCancel,
}: {
  company?: Company
  saving: boolean
  onSave: (draft: CompanyDraft, documents?: { type: CompanyDocType; filename: string }[]) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<CompanyDraft>(() => (company ? toDraft(company) : emptyCompanyDraft()))
  const [sources, setSources] = useState<Record<string, string>>({})
  const [extracted, setExtracted] = useState<Extracted | null>(null)
  const [version, setVersion] = useState(0)
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{company ? `Edit ${company.name}` : "Add company"}</h2>
          <p className="text-sm text-muted-foreground">
            Upload the documents to fill the details automatically, or type them in below.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          <X className="size-4" />
          Cancel
        </Button>
      </div>

      <DocumentUpload
        onExtracted={(result) => {
          const merged = mergeExtracted(result, company ? toDraft(company) : emptyCompanyDraft())
          setDraft(merged.draft)
          setSources(merged.sources)
          setExtracted(result)
          setVersion((v) => v + 1)
        }}
      />

      <div className="rounded-xl border bg-white p-5 shadow-sm sm:p-8">
        <StepTitle n={2} title="Company details" text="Check every field, correct anything that is wrong, then save." />
        {extracted && <ExtractionSummary extracted={extracted} />}
        <div className="mt-6">
          <CompanyForm
            key={version}
            initial={draft}
            sources={sources}
            saving={saving}
            onSave={(value) => onSave(value, extracted?.documents.map(({ type, filename }) => ({ type, filename })))}
            onCancel={onCancel}
            submitLabel={company ? "Save changes" : "Save company"}
          />
        </div>
      </div>
    </section>
  )
}

function StepTitle({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {n}
      </span>
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}

function toDraft(company: Company): CompanyDraft {
  const base = emptyCompanyDraft() as unknown as Record<string, unknown>
  const source = company as unknown as Record<string, unknown>
  const draft: Record<string, unknown> = {}
  for (const key of Object.keys(base)) draft[key] = source[key] ?? base[key]
  return draft as unknown as CompanyDraft
}

function mergeExtracted(extracted: Extracted, base: CompanyDraft) {
  const sources: Record<string, string> = {}
  const f = extracted.fields
  const draft: CompanyDraft = { ...base, partners: [...base.partners], vat: { ...base.vat }, ct: { ...base.ct } }
  const from = (path: string) => extracted.sources[path] ?? "document"
  for (const key of ["name", "legalForm", "authority", "emirate", "licenseNumber", "licenseIssueDate", "businessActivity", "manager"] as const) {
    const value = f[key]
    if (typeof value === "string" && value) {
      draft[key] = value
      sources[key] = from(key)
    }
  }
  if (f.partners?.length) {
    draft.partners = f.partners
    sources.partners = from("partners")
  }
  for (const [key, value] of Object.entries(f.vat ?? {}))
    if (value !== undefined && value !== "") {
      ;(draft.vat as Record<string, unknown>)[key] = value
      sources[`vat.${key}`] = from(`vat.${key}`)
    }
  for (const [key, value] of Object.entries(f.ct ?? {}))
    if (value !== undefined && value !== "") {
      ;(draft.ct as Record<string, unknown>)[key] = value
      sources[`ct.${key}`] = from(`ct.${key}`)
    }
  return { draft, sources }
}

const kindLabel: Record<string, string> = {
  tradeLicense: "Trade License",
  moa: "MOA",
  vatCertificate: "VAT Certificate",
  ctCertificate: "Corporate Tax Certificate",
  incorporation: "Certificate of incorporation",
  unknown: "Not recognised",
}

function ExtractionSummary({ extracted }: { extracted: Extracted }) {
  const order = { error: 0, warning: 1, info: 2 }
  const issues = [...extracted.issues].sort((a, b) => order[a.level] - order[b.level])
  return (
    <div className="mt-4 space-y-4">
      <ul className="flex flex-wrap gap-2 text-xs">
        {extracted.documents.map((doc) => (
          <li key={doc.type} className="rounded-full border bg-secondary px-3 py-1">
            <span className="font-medium">{doc.filename}</span> · read as {kindLabel[doc.detected === "unknown" ? doc.type : doc.detected]}
            {doc.authority ? ` · ${doc.authority}` : ""}
          </li>
        ))}
      </ul>
      {issues.length > 0 ? (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li
              key={issue.message}
              className={cn(
                "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
                issue.level === "error" && "bg-red-50 text-red-900",
                issue.level === "warning" && "bg-amber-50 text-amber-900",
                issue.level === "info" && "bg-slate-50 text-slate-700"
              )}
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {issue.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle2 className="size-4" /> The documents agree with each other and every field was found.
        </p>
      )}
    </div>
  )
}


function DocumentUpload({ onExtracted }: { onExtracted: (extracted: Extracted) => void }) {
  const [files, setFiles] = useState<Partial<Record<CompanyDocType, File>>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState<ReadProgress | null>(null)
  const [error, setError] = useState("")
  const [over, setOver] = useState<CompanyDocType | null>(null)
  const inputs = useRef<Partial<Record<CompanyDocType, HTMLInputElement | null>>>({})
  const count = Object.values(files).filter(Boolean).length

  function choose(key: CompanyDocType, file: File | undefined) {
    setDone(false)
    setFiles((current) => ({ ...current, [key]: file }))
  }

  async function upload() {
    setBusy(true)
    setError("")
    try {
      // Documents are read here in the browser (OCR for scanned pages); only the text is sent on.
      const documents = []
      for (const [type, file] of Object.entries(files)) {
        if (!file) continue
        documents.push({ type, filename: file.name, text: await readDocument(file, setProgress) })
      }
      setProgress(null)
      const response = await fetch("/api/companies/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      onExtracted(data)
      setDone(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The documents could not be read.")
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="space-y-5 rounded-xl border bg-white p-5 shadow-sm sm:p-8">
      <StepTitle n={1} title="Company documents" text="PDF or image, up to 25 MB each. Add what you have, then press Upload." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {companyDocTypes.map(({ key, label }) => {
          const file = files[key]
          return (
            <div
              key={key}
              onDragOver={(event) => {
                event.preventDefault()
                setOver(key)
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(event) => {
                event.preventDefault()
                setOver(null)
                choose(key, event.dataTransfer.files?.[0])
              }}
              className={cn(
                "relative flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 text-center transition-colors",
                file ? "border-solid border-emerald-600 bg-emerald-50/60" : "bg-secondary/40",
                over === key && "border-primary bg-primary/5"
              )}
            >
              {file ? (
                <FileText className="size-8 text-emerald-700" strokeWidth={1.6} />
              ) : (
                <FileUp className="size-8 text-muted-foreground" strokeWidth={1.6} />
              )}
              <p className="font-semibold">{label}</p>
              <p className="w-full truncate text-xs text-muted-foreground">{file ? file.name : "Drop file here or browse"}</p>
              {file ? (
                <Button variant="ghost" size="sm" aria-label={`Remove ${label}`} onClick={() => choose(key, undefined)} disabled={busy}>
                  <X className="size-4" />
                  Remove
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => inputs.current[key]?.click()} disabled={busy}>
                  Browse
                </Button>
              )}
              <input
                ref={(element) => {
                  inputs.current[key] = element
                }}
                type="file"
                className="hidden"
                aria-label={label}
                accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
                onChange={(event) => {
                  const chosen = event.target.files?.[0]
                  if (chosen) choose(key, chosen)
                  event.target.value = ""
                }}
              />
            </div>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {busy && (
        <div role="status" className="space-y-2 rounded-md bg-secondary px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" />
            {progress
              ? `${progress.file}: page ${progress.page} of ${progress.pages}${progress.ocr ? " (scanned, reading the image)" : ""}`
              : "Checking the documents..."}
          </p>
          {progress && (
            <div className="h-1.5 overflow-hidden rounded-full bg-white">
              <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(progress.page / progress.pages) * 100}%` }} />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={upload} disabled={!count || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
          {busy ? "Reading documents..." : "Upload"}
        </Button>
        {done && !busy && (
          <p className="flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" /> Details filled in below. Please check them.
          </p>
        )}
      </div>
    </div>
  )
}

function CompanyCard({ company, onEdit, onDelete }: { company: Company; onEdit: () => void; onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const facts: [string, string][] = [
    ["Authority", [company.authority, company.emirate].filter(Boolean).join(", ")],
    ["License", [company.licenseNumber, company.licenseIssueDate && `issued ${formatLongDate(company.licenseIssueDate)}`].filter(Boolean).join(" · ")],
    ["Manager", company.manager],
    ["Partners", company.partners.map((p) => `${p.name} (${p.sharePercent}%)`).join(", ")],
    [
      "VAT",
      company.vat.trn
        ? `${company.vat.trn} · ${company.vat.frequency === "monthly" ? "Monthly" : `Quarterly (${quarterCycleLabel(company.vat.cycleStartMonth)})`} from ${formatLongDate(company.vat.effectiveDate)}`
        : "Not registered",
    ],
    [
      "Corporate tax",
      company.ct.trn
        ? `${company.ct.trn} · year ends ${monthNames[company.ct.yearEndMonth - 1]}${company.ct.firstPeriodStart ? ` · first period from ${formatLongDate(company.ct.firstPeriodStart)}` : ""}`
        : "Not registered",
    ],
  ]
  const links = [
    { href: "/data-input", label: "Data Input", icon: UploadCloud },
    { href: "/reports", label: "Reports", icon: FileText },
    { href: "/vat", label: "VAT", icon: Receipt },
    { href: "/corporate-tax", label: "Corporate Tax", icon: Landmark },
  ]
  return (
    <article className="rounded-xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-primary">
            <Building2 className="size-5" />
          </span>
          <div>
            <h3 className="text-lg font-semibold">{company.name}</h3>
            <p className="text-sm text-muted-foreground">{company.legalForm}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-4" />
            Edit
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="Confirm delete" className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Delete {company.name} and all its saved trial balances? This cannot be undone.
          </span>
          <Button
            size="sm"
            className="bg-red-700 text-white hover:bg-red-800"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true)
              await onDelete()
              setDeleting(false)
              setConfirming(false)
            }}
          >
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Delete company
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
            Keep
          </Button>
        </div>
      )}
      <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 break-words">{value || "—"}</dd>
          </div>
        ))}
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Business activity</dt>
          <dd className="mt-0.5 break-words">{company.businessActivity}</dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
        {links.map(({ href, label, icon: Icon }) => (
          <Button key={href} asChild variant="secondary" size="sm">
            <Link href={href}>
              <Icon className="size-4" />
              {label}
            </Link>
          </Button>
        ))}
      </div>
    </article>
  )
}

function Paywall({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-labelledby="paywall-title" className="flex flex-wrap items-start gap-4 rounded-xl border border-primary/30 bg-secondary p-5">
      <Lock className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <h3 id="paywall-title" className="font-semibold">
          Add another company
        </h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Your profile includes one company. Each additional company is a paid add-on with its own
          data input, reports, VAT and corporate tax.
        </p>
        <Button className="mt-4" disabled title="Payments are not enabled yet">
          Upgrade (coming soon)
        </Button>
      </div>
      <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
        <X className="size-4" />
      </Button>
    </div>
  )
}
