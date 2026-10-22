import { z } from "zod"
import { scheduleLines } from "./financial-statements"

export const companyDocTypes = [
  { key: "tradeLicense", label: "Trade License" },
  { key: "moa", label: "MOA" },
  { key: "vatCertificate", label: "VAT Certificate" },
  { key: "ctCertificate", label: "Corporate Tax Certificate" },
] as const
export type CompanyDocType = (typeof companyDocTypes)[number]["key"]

export const emirates = [
  "Abu Dhabi",
  "Dubai",
  "Sharjah",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
] as const

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a valid date")
const optionalDate = z.union([z.literal(""), isoDate])
const trn = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{15}$/.test(value), "TRN must be 15 digits")
const money = z.number().finite().min(0).max(1e12)

export const partnerSchema = z.object({
  name: z.string().trim().min(1, "Partner name is required").max(160),
  nationality: z.string().trim().max(80).default(""),
  sharePercent: z.number().finite().min(0).max(100),
  shareValue: money,
})

export const companyDraftSchema = z
  .object({
    name: z.string().trim().min(2, "Company name is required").max(160),
    legalForm: z.string().trim().max(120).default("Limited Liability Company"),
    authority: z.string().trim().min(2, "Licensing authority is required").max(160),
    emirate: z.string().trim().max(60).default(""),
    licenseNumber: z.string().trim().max(60).default(""),
    licenseIssueDate: isoDate,
    businessActivity: z.string().trim().min(2, "Business activity is required").max(2000),
    partners: z.array(partnerSchema).min(1, "Add at least one partner / owner").max(50),
    manager: z.string().trim().min(2, "Manager is required").max(160),
    vat: z.object({
      trn,
      effectiveDate: optionalDate,
      frequency: z.enum(["quarterly", "monthly"]),
      /** Month (1-12) a VAT period starts in; quarterly periods repeat every 3 months. */
      cycleStartMonth: z.number().int().min(1).max(12),
    }),
    ct: z.object({
      trn,
      firstPeriodStart: optionalDate,
      /** Month (1-12) the financial year / tax period ends. */
      yearEndMonth: z.number().int().min(1).max(12),
    }),
  })
  .superRefine((data, context) => {
    const total = data.partners.reduce((sum, partner) => sum + partner.sharePercent, 0)
    if (Math.abs(total - 100) > 0.01)
      context.addIssue({
        code: "custom",
        message: `Partner shares must total 100% (currently ${Math.round(total * 100) / 100}%)`,
        path: ["partners"],
      })
    if (data.vat.trn && !data.vat.effectiveDate)
      context.addIssue({
        code: "custom",
        message: "Enter the VAT effective registration date",
        path: ["vat", "effectiveDate"],
      })
  })

const scheduleKeySchema = z
  .string()
  .refine((key) => scheduleLines.some((line) => line.key === key), "Unknown report line")

export const vatOverrideSchema = z.object({
  standardSales: money,
  zeroRatedSales: money,
  exemptSales: money,
  standardExpenses: money,
})

export const companyExtrasSchema = z.object({
  customHeads: z
    .array(z.object({ name: z.string().trim().min(2).max(120), scheduleKey: scheduleKeySchema }))
    .max(500)
    .default([]),
  vatOverrides: z.record(z.string().max(40), vatOverrideSchema).default({}),
  /** Corporate tax return answers by year (validated in lib/ct-return.ts). */
  ctAnswers: z.record(z.string().regex(/^\d{4}$/), z.record(z.string().max(60), z.union([z.string().max(300), z.number(), z.boolean()]))).default({}),
  documents: z
    .array(
      z.object({
        type: z.enum(["tradeLicense", "moa", "vatCertificate", "ctCertificate"]),
        filename: z.string().max(255),
        uploadedAt: z.string().max(40),
      })
    )
    .max(20)
    .default([]),
})

export type Partner = z.infer<typeof partnerSchema>
export type CompanyDraft = z.infer<typeof companyDraftSchema>
export type VatOverride = z.infer<typeof vatOverrideSchema>
export type Company = CompanyDraft &
  z.infer<typeof companyExtrasSchema> & {
    id: string
    revision: number
    createdAt: string
    updatedAt: string
  }

export function emptyCompanyDraft(): CompanyDraft {
  return {
    name: "",
    legalForm: "Limited Liability Company",
    authority: "",
    emirate: "",
    licenseNumber: "",
    licenseIssueDate: "",
    businessActivity: "",
    partners: [{ name: "", nationality: "", sharePercent: 100, shareValue: 0 }],
    manager: "",
    vat: { trn: "", effectiveDate: "", frequency: "quarterly", cycleStartMonth: 1 },
    ct: { trn: "", firstPeriodStart: "", yearEndMonth: 12 },
  }
}

export function emirateFromAuthority(authority: string) {
  const text = authority.toLowerCase()
  const rules: [RegExp, string][] = [
    [/abu dhabi|adgm|kizad|masdar|twofour54/, "Abu Dhabi"],
    [/sharjah|saif|shams|spc free|hamriyah/, "Sharjah"],
    [/ajman/, "Ajman"],
    [/umm al|uaq/, "Umm Al Quwain"],
    [/ras al|rak/, "Ras Al Khaimah"],
    [/fujairah/, "Fujairah"],
    [/dubai|dmcc|jafza|dafza|difc|dso|meydan|ifza|dwc|det\b|ded\b/, "Dubai"],
  ]
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? ""
}

/* ---------- dates (UTC, ISO yyyy-mm-dd) ---------- */

export const day = 86_400_000
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
export const toIso = (date: Date) => date.toISOString().slice(0, 10)
const lastDayOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)) // month is 1-based here
export function addDays(iso: string, days: number) {
  return toIso(new Date(toDate(iso).getTime() + days * day))
}
export function daysBetween(start: string, end: string) {
  return Math.round((toDate(end).getTime() - toDate(start).getTime()) / day) + 1
}
export function formatLongDate(iso: string) {
  if (!iso) return ""
  return toDate(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Financial year N ends on the last day of `yearEndMonth` in year N. */
export function financialPeriod(year: number, yearEndMonth = 12) {
  const end = lastDayOfMonth(year, yearEndMonth)
  const start =
    yearEndMonth === 12
      ? new Date(Date.UTC(year, 0, 1))
      : new Date(Date.UTC(year - 1, yearEndMonth, 1))
  return { start: toIso(start), end: toIso(end) }
}

export type VatPeriod = { id: string; start: string; end: string; dueDate: string }

/**
 * VAT periods from the effective registration date. The first period runs from
 * the effective date to the end of the regular cycle period containing it.
 */
export function vatPeriods(
  vat: CompanyDraft["vat"],
  from: string,
  to: string
): VatPeriod[] {
  if (!vat.trn || !vat.effectiveDate || vat.effectiveDate > to) return []
  const length = vat.frequency === "monthly" ? 1 : 3
  const offset = (vat.cycleStartMonth - 1) % length
  // Periods are anchored on the registration date, then kept where they overlap [from, to].
  const b = toDate(vat.effectiveDate)
  let month = b.getUTCMonth() // 0-based
  let year = b.getUTCFullYear()
  while ((((month - offset) % length) + length) % length !== 0) {
    month -= 1
    if (month < 0) {
      month = 11
      year -= 1
    }
  }
  const periods: VatPeriod[] = []
  for (let guard = 0; guard < 2000; guard++) {
    const cycleStart = toIso(new Date(Date.UTC(year, month, 1)))
    const cycleEnd = toIso(lastDayOfMonth(year, month + length))
    if (cycleStart > to) break
    const start = cycleStart < vat.effectiveDate ? vat.effectiveDate : cycleStart
    if (cycleEnd >= from)
      periods.push({ id: `${start}_${cycleEnd}`, start, end: cycleEnd, dueDate: addDays(cycleEnd, 28) })
    month += length
    while (month > 11) {
      month -= 12
      year += 1
    }
  }
  return periods
}

/** Corporate tax return and payment deadline: 9 months after the period end. */
export function ctDueDate(periodEnd: string) {
  const end = toDate(periodEnd)
  return toIso(lastDayOfMonth(end.getUTCFullYear(), end.getUTCMonth() + 1 + 9))
}

export const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

export function quarterCycleLabel(startMonth: number) {
  const short = monthNames.map((name) => name.slice(0, 3))
  const s = (startMonth - 1) % 3
  return [0, 3, 6, 9]
    .map((step) => `${short[(s + step) % 12]}–${short[(s + step + 2) % 12]}`)
    .join(", ")
}
