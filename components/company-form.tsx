"use client"

import { useState } from "react"
import { AlertCircle, Loader2, Plus, Save, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  companyDraftSchema,
  ctDueDate,
  emirateFromAuthority,
  emirates,
  financialPeriod,
  formatLongDate,
  monthNames,
  quarterCycleLabel,
  type CompanyDraft,
  type Partner,
} from "@/lib/company"
import { cn } from "@/lib/utils"

export function CompanyForm({
  initial,
  highlighted = [],
  sources = {},
  saving,
  onSave,
  onCancel,
  submitLabel = "Save company",
}: {
  initial: CompanyDraft
  /** Field paths filled from uploaded documents, shown with a marker for review. */
  highlighted?: string[]
  /** Field path → document it was read from, shown on the field. */
  sources?: Record<string, string>
  saving: boolean
  onSave: (draft: CompanyDraft) => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const [draft, setDraft] = useState<CompanyDraft>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof CompanyDraft>(key: K, value: CompanyDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const setVat = (patch: Partial<CompanyDraft["vat"]>) =>
    setDraft((current) => ({ ...current, vat: { ...current.vat, ...patch } }))
  const setCt = (patch: Partial<CompanyDraft["ct"]>) =>
    setDraft((current) => ({ ...current, ct: { ...current.ct, ...patch } }))
  const setPartner = (index: number, patch: Partial<Partner>) =>
    set(
      "partners",
      draft.partners.map((partner, i) => (i === index ? { ...partner, ...patch } : partner))
    )
  const totalPercent = draft.partners.reduce((sum, partner) => sum + (partner.sharePercent || 0), 0)
  const totalValue = draft.partners.reduce((sum, partner) => sum + (partner.shareValue || 0), 0)
  const mark = (path: string) => sources[path] ?? (highlighted.includes(path) ? "document" : "")

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = companyDraftSchema.safeParse(draft)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.slice(0, issue.path[0] === "partners" ? 1 : 2).join(".")
        next[key] ??= issue.message
      }
      setErrors(next)
      document.getElementById(`field-${Object.keys(next)[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    setErrors({})
    onSave(parsed.data)
  }

  const exampleYear = new Date().getFullYear() - 1
  const examplePeriod = financialPeriod(exampleYear, draft.ct.yearEndMonth)

  return (
    <form onSubmit={submit} className="space-y-8" noValidate>
      {(highlighted.length > 0 || Object.keys(sources).length > 0) && (
        <p className="flex items-start gap-2 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          Fields marked “From …” were read from your documents. Check each one against the original
          before saving.
        </p>
      )}

      <Section title="Company">
        <Field id="name" label="Company name" error={errors.name} fromDoc={mark("name")} wide>
          <Input id="field-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id="legalForm" label="Legal form" fromDoc={mark("legalForm")}>
          <Input
            id="field-legalForm"
            value={draft.legalForm}
            onChange={(e) => set("legalForm", e.target.value)}
            placeholder="Limited Liability Company"
          />
        </Field>
        <Field id="authority" label="Licensing authority" error={errors.authority} fromDoc={mark("authority")}>
          <Input
            id="field-authority"
            value={draft.authority}
            placeholder="e.g. Dubai Economy and Tourism"
            onChange={(e) => {
              const authority = e.target.value
              const guess = emirateFromAuthority(authority)
              setDraft((current) => ({
                ...current,
                authority,
                emirate: current.emirate || guess,
              }))
            }}
          />
        </Field>
        <Field id="emirate" label="Emirate" fromDoc={mark("emirate")}>
          <select
            id="field-emirate"
            className="h-9 w-full rounded-md border bg-white px-2 text-sm"
            value={draft.emirate}
            onChange={(e) => set("emirate", e.target.value)}
          >
            <option value="">Select emirate</option>
            {emirates.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </Field>
        <Field id="licenseNumber" label="License number" fromDoc={mark("licenseNumber")}>
          <Input id="field-licenseNumber" value={draft.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} />
        </Field>
        <Field id="licenseIssueDate" label="License issue date" error={errors.licenseIssueDate} fromDoc={mark("licenseIssueDate")}>
          <Input
            id="field-licenseIssueDate"
            type="date"
            value={draft.licenseIssueDate}
            onChange={(e) => set("licenseIssueDate", e.target.value)}
          />
        </Field>
        <Field id="businessActivity" label="Business activity" error={errors.businessActivity} fromDoc={mark("businessActivity")} wide>
          <Textarea
            id="field-businessActivity"
            rows={3}
            value={draft.businessActivity}
            onChange={(e) => set("businessActivity", e.target.value)}
          />
        </Field>
        <Field id="manager" label="Manager" error={errors.manager} fromDoc={mark("manager")}>
          <Input id="field-manager" value={draft.manager} onChange={(e) => set("manager", e.target.value)} />
        </Field>
      </Section>

      <Section title="Partners / owners" columns={1}>
        <div id="field-partners" className="space-y-3">
          {mark("partners") && <FromDoc source={mark("partners")} />}
          <div className="hidden grid-cols-[minmax(0,1fr)_10rem_7rem_10rem_2.5rem] gap-3 text-xs font-medium text-muted-foreground md:grid">
            <span>Name</span>
            <span>Nationality</span>
            <span>Share %</span>
            <span>Share value (AED)</span>
            <span />
          </div>
          {draft.partners.map((partner, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-md border bg-white p-3 md:grid-cols-[minmax(0,1fr)_10rem_7rem_10rem_2.5rem] md:border-0 md:bg-transparent md:p-0"
            >
              <Input
                aria-label={`Partner ${index + 1} name`}
                placeholder="Full name"
                value={partner.name}
                onChange={(e) => setPartner(index, { name: e.target.value })}
              />
              <Input
                aria-label={`Partner ${index + 1} nationality`}
                placeholder="Nationality"
                value={partner.nationality}
                onChange={(e) => setPartner(index, { nationality: e.target.value })}
              />
              <Input
                aria-label={`Partner ${index + 1} share percent`}
                inputMode="decimal"
                value={Number.isFinite(partner.sharePercent) ? String(partner.sharePercent) : ""}
                onChange={(e) => setPartner(index, { sharePercent: Number(e.target.value) })}
                className="font-mono"
              />
              <Input
                aria-label={`Partner ${index + 1} share value`}
                inputMode="decimal"
                value={Number.isFinite(partner.shareValue) ? String(partner.shareValue) : ""}
                onChange={(e) => setPartner(index, { shareValue: Number(e.target.value) })}
                className="font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove partner ${index + 1}`}
                disabled={draft.partners.length === 1}
                onClick={() => set("partners", draft.partners.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set("partners", [
                  ...draft.partners,
                  { name: "", nationality: "", sharePercent: Math.max(0, 100 - totalPercent), shareValue: 0 },
                ])
              }
            >
              <Plus className="size-4" />
              Add partner
            </Button>
            <span className={cn("font-mono", Math.abs(totalPercent - 100) > 0.01 && "text-destructive")}>
              Total {Math.round(totalPercent * 100) / 100}% · AED{" "}
              {totalValue.toLocaleString("en-AE", { maximumFractionDigits: 2 })}
            </span>
          </div>
          {errors.partners && <p className="text-xs text-destructive">{errors.partners}</p>}
        </div>
      </Section>

      <Section title="VAT">
        <Field id="vat.trn" label="VAT TRN" error={errors["vat.trn"]} fromDoc={mark("vat.trn")} hint="Leave blank if not registered">
          <Input
            id="field-vat.trn"
            inputMode="numeric"
            maxLength={15}
            placeholder="15 digits"
            value={draft.vat.trn}
            onChange={(e) => setVat({ trn: e.target.value.replace(/\D/g, "") })}
            className="font-mono"
          />
        </Field>
        <Field id="vat.effectiveDate" label="Effective registration date" error={errors["vat.effectiveDate"]} fromDoc={mark("vat.effectiveDate")}>
          <Input
            id="field-vat.effectiveDate"
            type="date"
            disabled={!draft.vat.trn}
            value={draft.vat.effectiveDate}
            onChange={(e) => setVat({ effectiveDate: e.target.value })}
          />
        </Field>
        <Field id="vat.frequency" label="Return frequency" fromDoc={mark("vat.frequency")}>
          <select
            id="field-vat.frequency"
            disabled={!draft.vat.trn}
            className="h-9 w-full rounded-md border bg-white px-2 text-sm disabled:opacity-50"
            value={draft.vat.frequency}
            onChange={(e) => setVat({ frequency: e.target.value as "quarterly" | "monthly" })}
          >
            <option value="quarterly">Quarterly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        {draft.vat.frequency === "quarterly" && (
          <Field id="vat.cycleStartMonth" label="VAT periods (stagger)" fromDoc={mark("vat.cycleStartMonth")}>
            <select
              id="field-vat.cycleStartMonth"
              disabled={!draft.vat.trn}
              className="h-9 w-full rounded-md border bg-white px-2 text-sm disabled:opacity-50"
              value={((draft.vat.cycleStartMonth - 1) % 3) + 1}
              onChange={(e) => setVat({ cycleStartMonth: Number(e.target.value) })}
            >
              {[1, 2, 3].map((month) => (
                <option key={month} value={month}>
                  {quarterCycleLabel(month)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </Section>

      <Section title="Corporate tax">
        <Field id="ct.trn" label="Corporate tax TRN" error={errors["ct.trn"]} fromDoc={mark("ct.trn")} hint="Leave blank if not registered">
          <Input
            id="field-ct.trn"
            inputMode="numeric"
            maxLength={15}
            placeholder="15 digits"
            value={draft.ct.trn}
            onChange={(e) => setCt({ trn: e.target.value.replace(/\D/g, "") })}
            className="font-mono"
          />
        </Field>
        <Field id="ct.yearEndMonth" label="Financial year / tax period ends" fromDoc={mark("ct.yearEndMonth")}>
          <select
            id="field-ct.yearEndMonth"
            className="h-9 w-full rounded-md border bg-white px-2 text-sm"
            value={draft.ct.yearEndMonth}
            onChange={(e) => setCt({ yearEndMonth: Number(e.target.value) })}
          >
            {monthNames.map((month, index) => (
              <option key={month} value={index + 1}>
                End of {month}
              </option>
            ))}
          </select>
        </Field>
        <Field id="ct.firstPeriodStart" label="First tax period starts" error={errors["ct.firstPeriodStart"]} fromDoc={mark("ct.firstPeriodStart")}>
          <Input
            id="field-ct.firstPeriodStart"
            type="date"
            disabled={!draft.ct.trn}
            value={draft.ct.firstPeriodStart}
            onChange={(e) => setCt({ firstPeriodStart: e.target.value })}
          />
        </Field>
        <div className="space-y-1 text-sm sm:col-span-2">
          <p className="font-medium">Submission period</p>
          <p className="text-muted-foreground">
            Return and payment due within 9 months of each period end. For example, the period{" "}
            {formatLongDate(examplePeriod.start)} – {formatLongDate(examplePeriod.end)} is due by{" "}
            {formatLongDate(ctDueDate(examplePeriod.end))}.
          </p>
        </div>
      </Section>

      <div className="flex flex-wrap gap-3 border-t pt-6">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "Saving..." : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="self-center text-sm text-destructive">
            Correct the highlighted fields.
          </p>
        )}
      </div>
    </form>
  )
}

function Section({
  title,
  columns = 2,
  children,
}: {
  title: string
  columns?: 1 | 2
  children: React.ReactNode
}) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-4 text-base font-semibold">{title}</legend>
      <div className={cn("grid gap-x-5 gap-y-4", columns === 2 && "sm:grid-cols-2")}>{children}</div>
    </fieldset>
  )
}

function Field({
  id,
  label,
  error,
  hint,
  fromDoc,
  wide,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  fromDoc?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("min-w-0 space-y-2", wide && "sm:col-span-2")}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`field-${id}`}>{label}</Label>
        {fromDoc && <FromDoc source={fromDoc} />}
      </div>
      <div className={cn(error && "[&_input]:border-destructive [&_textarea]:border-destructive")}>{children}</div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

function FromDoc({ source }: { source: string }) {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
      From {source}
    </span>
  )
}
