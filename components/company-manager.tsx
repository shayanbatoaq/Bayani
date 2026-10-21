"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileUp,
  Loader2,
  Lock,
  Pencil,
  PenLine,
  Plus,
  UploadCloud,
  X,
} from "lucide-react"

import { CompanyForm } from "@/components/company-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { countries } from "@/lib/countries"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type Extracted = {
  fields: Partial<CompanyDraft> & { vat?: Partial<CompanyDraft["vat"]>; ct?: Partial<CompanyDraft["ct"]> }
  source: "ai" | "rules"
  warnings: string[]
  documents: { type: CompanyDocType; filename: string }[]
}

type Step =
  | { kind: "idle" }
  | { kind: "choose" }
  | { kind: "upload" }
  | { kind: "review"; draft: CompanyDraft; highlighted: string[]; extracted?: Extracted }
  | { kind: "edit"; company: Company }

export function CompanyManager() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [limit, setLimit] = useState(1)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<Step>({ kind: "idle" })
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
        if (!data.companies.length) setStep({ kind: "choose" })
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [])

  function startAdd() {
    setNotice("")
    if (companies.length >= limit) {
      setPaywall(true)
      return
    }
    setStep({ kind: "choose" })
  }

  async function save(draft: CompanyDraft, existing?: Company, documents?: Extracted["documents"]) {
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: existing?.id,
          revision: existing?.revision,
          draft,
          documents,
        }),
      })
      const data = await response.json()
      if (response.status === 402) {
        setPaywall(true)
        throw new Error(data.error)
      }
      if (!response.ok) throw new Error(data.error)
      setCompanies((current) => [
        ...current.filter((company) => company.id !== data.company.id),
        data.company,
      ])
      setStep({ kind: "idle" })
      setNotice(`${data.company.name} saved.`)
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the company.")
    } finally {
      setSaving(false)
    }
  }

  if (loading)
    return (
      <p role="status" className="flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading profile...
      </p>
    )

  return (
    <div className="space-y-10">
      <AccountDetails />

      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Companies</h2>
            <p className="text-sm text-muted-foreground">
              {companies.length} of {limit} included in your plan
            </p>
          </div>
          {step.kind === "idle" && (
            <Button onClick={startAdd} variant={companies.length >= limit ? "outline" : "default"}>
              {companies.length >= limit ? <Lock className="size-4" /> : <Plus className="size-4" />}
              New company
            </Button>
          )}
        </div>

        {notice && (
          <p role="status" className="flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" />
            {notice}
            {companies.length > 0 && (
              <Link href="/data-input" className="ml-2 inline-flex items-center gap-1 font-medium text-primary">
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

        {step.kind === "idle" &&
          companies.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              onEdit={() => setStep({ kind: "edit", company })}
            />
          ))}

        {step.kind === "choose" && (
          <ChooseMethod
            onUpload={() => setStep({ kind: "upload" })}
            onManual={() => setStep({ kind: "review", draft: emptyCompanyDraft(), highlighted: [] })}
            onCancel={companies.length ? () => setStep({ kind: "idle" }) : undefined}
          />
        )}

        {step.kind === "upload" && (
          <DocumentUpload
            onCancel={() => setStep({ kind: "choose" })}
            onExtracted={(extracted) => {
              const { draft, highlighted } = mergeExtracted(extracted)
              setStep({ kind: "review", draft, highlighted, extracted })
            }}
          />
        )}

        {step.kind === "review" && (
          <div className="rounded-xl border bg-white p-5 shadow-sm sm:p-8">
            <h3 className="mb-1 text-lg font-semibold">
              {step.extracted ? "Review extracted details" : "Enter company details"}
            </h3>
            {step.extracted?.warnings.map((warning) => (
              <p key={warning} className="mt-2 text-sm text-amber-800">
                {warning}
              </p>
            ))}
            <div className="mt-6">
              <CompanyForm
                initial={step.draft}
                highlighted={step.highlighted}
                saving={saving}
                onSave={(draft) => save(draft, undefined, step.extracted?.documents)}
                onCancel={() => setStep(companies.length ? { kind: "idle" } : { kind: "choose" })}
              />
            </div>
          </div>
        )}

        {step.kind === "edit" && (
          <div className="rounded-xl border bg-white p-5 shadow-sm sm:p-8">
            <h3 className="mb-6 text-lg font-semibold">Edit {step.company.name}</h3>
            <CompanyForm
              initial={step.company}
              saving={saving}
              onSave={(draft) => save(draft, step.company)}
              onCancel={() => setStep({ kind: "idle" })}
              submitLabel="Save changes"
            />
          </div>
        )}
      </section>
    </div>
  )
}

function mergeExtracted(extracted: Extracted) {
  const base = emptyCompanyDraft()
  const highlighted: string[] = []
  const f = extracted.fields
  const draft: CompanyDraft = { ...base, vat: { ...base.vat }, ct: { ...base.ct } }
  for (const key of [
    "name",
    "legalForm",
    "authority",
    "emirate",
    "licenseNumber",
    "licenseIssueDate",
    "businessActivity",
    "manager",
  ] as const) {
    const value = f[key]
    if (typeof value === "string" && value) {
      draft[key] = value
      highlighted.push(key)
    }
  }
  if (f.partners?.length) {
    draft.partners = f.partners
    highlighted.push("partners")
  }
  for (const [key, value] of Object.entries(f.vat ?? {}))
    if (value !== undefined && value !== "") {
      ;(draft.vat as Record<string, unknown>)[key] = value
      highlighted.push(`vat.${key}`)
    }
  for (const [key, value] of Object.entries(f.ct ?? {}))
    if (value !== undefined && value !== "") {
      ;(draft.ct as Record<string, unknown>)[key] = value
      highlighted.push(`ct.${key}`)
    }
  return { draft, highlighted }
}

function ChooseMethod({
  onUpload,
  onManual,
  onCancel,
}: {
  onUpload: () => void
  onManual: () => void
  onCancel?: () => void
}) {
  const options = [
    {
      title: "Upload documents",
      text: "Trade License, MOA / Articles, VAT and corporate tax certificates. Details are read automatically for you to review.",
      icon: UploadCloud,
      action: onUpload,
      tone: "bg-emerald-50 text-emerald-800",
    },
    {
      title: "Enter details manually",
      text: "Type the company, partner and tax registration details yourself.",
      icon: PenLine,
      action: onManual,
      tone: "bg-amber-50 text-amber-800",
    },
  ]
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {options.map(({ title, text, icon: Icon, action, tone }) => (
          <button
            key={title}
            type="button"
            onClick={action}
            className="group flex min-h-40 items-start gap-5 rounded-xl border bg-white p-6 text-left shadow-sm transition-[border-color,box-shadow] hover:border-primary/60 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-lg", tone)}>
              <Icon className="size-6" strokeWidth={1.7} />
            </span>
            <span>
              <span className="block text-lg font-semibold">{title}</span>
              <span className="mt-2 block text-sm leading-6 text-muted-foreground">{text}</span>
            </span>
          </button>
        ))}
      </div>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}

function DocumentUpload({
  onExtracted,
  onCancel,
}: {
  onExtracted: (extracted: Extracted) => void
  onCancel: () => void
}) {
  const [files, setFiles] = useState<Partial<Record<CompanyDocType, File>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const inputs = useRef<Partial<Record<CompanyDocType, HTMLInputElement | null>>>({})
  const count = Object.values(files).filter(Boolean).length

  async function extract() {
    setBusy(true)
    setError("")
    try {
      const form = new FormData()
      for (const [type, file] of Object.entries(files)) if (file) form.append(type, file)
      const response = await fetch("/api/companies/extract", { method: "POST", body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      onExtracted(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The documents could not be read.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 rounded-xl border bg-white p-5 shadow-sm sm:p-8">
      <div>
        <h3 className="text-lg font-semibold">Upload company documents</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF or image, up to 15 MB each. Upload what you have; missing details can be typed in next.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {companyDocTypes.map(({ key, label }) => {
          const file = files[key]
          return (
            <div
              key={key}
              className={cn(
                "flex min-h-24 items-center gap-4 rounded-lg border border-dashed p-4",
                file && "border-solid border-emerald-600 bg-emerald-50/50"
              )}
            >
              <FileUp className={cn("size-6 shrink-0", file ? "text-emerald-700" : "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{label}</p>
                <p className="truncate text-xs text-muted-foreground">{file ? file.name : "Not uploaded"}</p>
              </div>
              {file ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${label}`}
                  onClick={() => setFiles((current) => ({ ...current, [key]: undefined }))}
                >
                  <X className="size-4" />
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => inputs.current[key]?.click()}>
                  Choose
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
                  if (chosen) setFiles((current) => ({ ...current, [key]: chosen }))
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
      <div className="flex flex-wrap gap-3">
        <Button onClick={extract} disabled={!count || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          {busy ? "Reading documents..." : `Extract details from ${count || ""} document${count === 1 ? "" : "s"}`}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Back
        </Button>
      </div>
    </div>
  )
}

function CompanyCard({ company, onEdit }: { company: Company; onEdit: () => void }) {
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
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="size-4" />
          Edit
        </Button>
      </div>
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

function AccountDetails() {
  const supabase = getSupabaseBrowserClient()
  const [state, setState] = useState<{ email: string; name: string; country: string } | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    supabase?.auth.getUser().then(({ data }: { data: { user: { email?: string; user_metadata?: Record<string, string> } | null } }) => {
      if (!data.user) return
      const meta = data.user.user_metadata ?? {}
      setState({
        email: data.user.email ?? "",
        name: meta.name ?? meta.full_name ?? "",
        country: meta.country ?? "",
      })
    })
  }, [supabase])
  if (!supabase)
    return (
      <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Demo workspace: sign-in is not configured, so data is kept in this browser&apos;s workspace on the server.
      </p>
    )
  if (!state) return null
  return (
    <section className="grid gap-4 rounded-xl border bg-white p-5 shadow-sm sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <div className="space-y-2">
        <Label htmlFor="account-name">Name</Label>
        <Input
          id="account-name"
          value={state.name}
          onChange={(e) => {
            setSaved(false)
            setState({ ...state, name: e.target.value })
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="account-email">Email</Label>
        <Input id="account-email" value={state.email} disabled />
      </div>
      <div className="space-y-2">
        <Label htmlFor="account-country">Country</Label>
        <select
          id="account-country"
          className="h-9 w-full rounded-md border bg-white px-2 text-sm"
          value={state.country}
          onChange={(e) => {
            setSaved(false)
            setState({ ...state, country: e.target.value })
          }}
        >
          <option value="">Select country</option>
          {countries.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>
      <Button
        variant="outline"
        onClick={async () => {
          const { error } = await supabase.auth.updateUser({ data: { name: state.name, country: state.country } })
          setSaved(!error)
        }}
      >
        {saved ? <CheckCircle2 className="size-4" /> : null}
        {saved ? "Saved" : "Save"}
      </Button>
    </section>
  )
}
