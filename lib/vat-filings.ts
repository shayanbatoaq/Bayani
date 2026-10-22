import { z } from "zod"
import { monthNames, type Company } from "./company"

/**
 * VAT returns as filed: the user uploads the VAT 201 return downloaded from EmaraTax
 * (or types it in), FinScope keeps them by tax year and quarter and analyses them against
 * the UAE VAT rules (Federal Decree-Law No. 8 of 2017 and its Executive Regulation).
 * Nothing here calculates VAT from the trial balance.
 */

/* ------------------------------------------------------------------ the form */

export type BoxKey =
  | "1a" | "1b" | "1c" | "1d" | "1e" | "1f" | "1g"
  | "2" | "3" | "4" | "5" | "6" | "7" | "8"
  | "9" | "10" | "11" | "12" | "13" | "14"
export type Column = "amount" | "vat" | "adjustment"
export type BoxDef = { key: BoxKey; label: string; columns: Column[]; computed?: boolean; section: "output" | "input" | "net" }

export const BOXES: BoxDef[] = [
  { key: "1a", section: "output", label: "Standard rated supplies in Abu Dhabi", columns: ["amount", "vat", "adjustment"] },
  { key: "1b", section: "output", label: "Standard rated supplies in Dubai", columns: ["amount", "vat", "adjustment"] },
  { key: "1c", section: "output", label: "Standard rated supplies in Sharjah", columns: ["amount", "vat", "adjustment"] },
  { key: "1d", section: "output", label: "Standard rated supplies in Ajman", columns: ["amount", "vat", "adjustment"] },
  { key: "1e", section: "output", label: "Standard rated supplies in Umm Al Quwain", columns: ["amount", "vat", "adjustment"] },
  { key: "1f", section: "output", label: "Standard rated supplies in Ras Al Khaimah", columns: ["amount", "vat", "adjustment"] },
  { key: "1g", section: "output", label: "Standard rated supplies in Fujairah", columns: ["amount", "vat", "adjustment"] },
  { key: "2", section: "output", label: "Tax refunds provided to tourists under the Tax Refunds for Tourists Scheme", columns: ["amount", "vat"] },
  { key: "3", section: "output", label: "Supplies subject to the reverse charge provisions", columns: ["amount", "vat"] },
  { key: "4", section: "output", label: "Zero rated supplies", columns: ["amount"] },
  { key: "5", section: "output", label: "Exempt supplies", columns: ["amount"] },
  { key: "6", section: "output", label: "Goods imported into the UAE", columns: ["amount", "vat"] },
  { key: "7", section: "output", label: "Adjustments to goods imported into the UAE", columns: ["amount", "vat"] },
  { key: "8", section: "output", label: "Totals", columns: ["amount", "vat", "adjustment"], computed: true },
  { key: "9", section: "input", label: "Standard rated expenses", columns: ["amount", "vat", "adjustment"] },
  { key: "10", section: "input", label: "Supplies subject to the reverse charge provisions", columns: ["amount", "vat"] },
  { key: "11", section: "input", label: "Totals", columns: ["amount", "vat", "adjustment"], computed: true },
  { key: "12", section: "net", label: "Total value of due tax for the period", columns: ["amount"], computed: true },
  { key: "13", section: "net", label: "Total value of recoverable tax for the period", columns: ["amount"], computed: true },
  { key: "14", section: "net", label: "Payable tax for the period", columns: ["amount"], computed: true },
]
const OUTPUT_PARTS: BoxKey[] = ["1a", "1b", "1c", "1d", "1e", "1f", "1g", "2", "3", "4", "5", "6", "7"]
const STANDARD: BoxKey[] = ["1a", "1b", "1c", "1d", "1e", "1f", "1g"]

const money = z.number().finite().min(-1e12).max(1e12)
const cell = z.object({ amount: money.optional(), vat: money.optional(), adjustment: money.optional() })
export const vatFilingSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.enum(["upload", "manual"]),
  filename: z.string().max(255).optional(),
  trn: z.string().max(20).optional(),
  reference: z.string().max(40).optional(),
  stagger: z.string().max(80).optional(),
  dueDate: z.string().max(10).optional(),
  submittedOn: z.string().max(10).optional(),
  profitMarginScheme: z.boolean().default(false),
  boxes: z.record(z.string().max(3), cell).default({}),
  savedAt: z.string().max(40).optional(),
})
export type VatFiling = z.infer<typeof vatFilingSchema>
export const vatSettingsSchema = z.object({ taxYearStartMonth: z.number().int().min(1).max(12).optional() })
export type VatSettings = z.infer<typeof vatSettingsSchema>

export const vatFilingsStoreSchema = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/), vatFilingSchema)
export function readFilings(raw: unknown): Record<string, VatFiling> {
  const out: Record<string, VatFiling> = {}
  if (!raw || typeof raw !== "object") return out
  for (const [id, value] of Object.entries(raw)) {
    const parsed = vatFilingSchema.safeParse(value)
    if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(id) && parsed.success) out[id] = parsed.data
  }
  return out
}

const r2 = (n: number) => Math.round(n * 100) / 100 || 0
const val = (f: VatFiling, key: BoxKey, column: Column) => f.boxes[key]?.[column] ?? 0

/** Boxes 8, 11, 12, 13 and 14 from the entered boxes. */
export function totals(filing: VatFiling) {
  const sum = (keys: BoxKey[], column: Column) => r2(keys.reduce((t, k) => t + val(filing, k, column), 0))
  const out = { amount: sum(OUTPUT_PARTS, "amount"), vat: sum(OUTPUT_PARTS, "vat"), adjustment: sum(STANDARD, "adjustment") }
  const input = { amount: sum(["9", "10"], "amount"), vat: sum(["9", "10"], "vat"), adjustment: val(filing, "9", "adjustment") }
  const due = r2(out.vat + out.adjustment)
  const recoverable = r2(input.vat + input.adjustment)
  return { output: out, input, due, recoverable, payable: r2(due - recoverable) }
}

/** The filing with its computed boxes filled in (uploaded totals are kept for comparison). */
export function withTotals(filing: VatFiling): VatFiling {
  const t = totals(filing)
  return {
    ...filing,
    boxes: {
      ...filing.boxes,
      "8": { amount: t.output.amount, vat: t.output.vat, adjustment: t.output.adjustment },
      "11": { amount: t.input.amount, vat: t.input.vat, adjustment: t.input.adjustment },
      "12": { amount: t.due },
      "13": { amount: t.recoverable },
      "14": { amount: t.payable },
    },
  }
}

/* ------------------------------------------------------------- reading a PDF */

const toNumber = (text: string) => {
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-")
  const n = Number(text.replace(/[(),-]/g, ""))
  return negative ? -n : n
}
const isoDate = (dmy: string) => {
  const [d, m, y] = dmy.split("/")
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
}
const DATE = /(\d{2})\/(\d{2})\/(\d{4})/

export type ParsedReturn = { filing: Omit<VatFiling, "source" | "periodStart" | "periodEnd"> & { periodStart?: string; periodEnd?: string }; found: number; warnings: string[] }

/** Reads the text of an EmaraTax VAT 201 return (as downloaded) into the form. */
export function parseVat201(text: string): ParsedReturn {
  // Drop Arabic so the English labels and numbers line up.
  const lines = text
    .split(/\r?\n|\f/)
    .map((line) => line.replace(/[؀-ۿﭐ-﷿ﹰ-﻿‎‏‪-‮]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const warnings: string[] = []
  const boxes: VatFiling["boxes"] = {}
  const keys = BOXES.map((box) => box.key)
  const labelAt = (line: string) => {
    const m = line.match(/^(1[a-g]|1[0-4]|[2-9])\s+([A-Za-z].*)$/)
    return m && keys.includes(m[1] as BoxKey) ? (m[1] as BoxKey) : null
  }
  let found = 0
  for (let i = 0; i < lines.length; i++) {
    const key = labelAt(lines[i])
    if (!key || boxes[key]) continue
    const def = BOXES.find((box) => box.key === key)!
    const numbers: number[] = []
    // Numbers sit on the label line (after the text) or the next lines, before the next box.
    for (let j = i; j < Math.min(lines.length, i + 4) && numbers.length < def.columns.length; j++) {
      if (j > i && labelAt(lines[j])) break
      const source = j === i ? lines[j].replace(/^(1[a-g]|1[0-4]|[2-9])\s+/, "") : lines[j]
      for (const token of source.match(/\(?-?[\d,]+\.\d{2}\)?/g) ?? []) numbers.push(toNumber(token))
    }
    if (!numbers.length) continue
    found++
    const entry: Partial<Record<Column, number>> = {}
    def.columns.forEach((column, index) => {
      if (numbers[index] !== undefined) entry[column] = numbers[index]
    })
    boxes[key] = entry
  }
  const joined = lines.join("\n")
  const trn = joined.match(/\b(1\d{14})\b/)?.[1]
  const period = joined.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/)
  const after = (label: RegExp) => {
    const index = lines.findIndex((line) => label.test(line))
    if (index < 0) return undefined
    for (let j = index; j < Math.min(lines.length, index + 3); j++) {
      const m = lines[j].match(DATE)
      if (m) return isoDate(m[0])
    }
    return undefined
  }
  const staggerLine = lines.findIndex((line) => /Stagger\s*\d/i.test(line))
  let stagger: string | undefined
  if (staggerLine >= 0) {
    stagger = lines[staggerLine].slice(lines[staggerLine].search(/Stagger\s*\d/i)).trim()
    if (/\(\w+$/.test(stagger) || /\([^)]*$/.test(stagger)) {
      const tail = lines.slice(staggerLine + 1, staggerLine + 3).map((line) => line.match(/to \w+\)/i)?.[0]).find(Boolean)
      if (tail) stagger = `${stagger} ${tail}`
    }
  }
  const pmIndex = lines.findIndex((line) => /profit margin scheme in respect/i.test(line))
  const profitMargin = pmIndex >= 0 ? lines.slice(pmIndex, pmIndex + 3).some((line) => /^yes\b/i.test(line)) : false
  const reference = lines[0]?.match(/\b(\d{9,15})\s*-/)?.[1]
  const submitted = after(/Date of Submission/i)
  if (!period) warnings.push("The return period was not found in the file.")
  if (found < 10) warnings.push(`Only ${found} of the return boxes were read. Check the figures before saving.`)
  const parsed = { boxes, trn, profitMarginScheme: profitMargin, stagger, reference, dueDate: after(/VAT Return Due Date/i), submittedOn: submitted, periodStart: period ? isoDate(period[1]) : undefined, periodEnd: period ? isoDate(period[2]) : undefined }
  // Compare the return's own totals with the boxes it contains.
  const check = withTotals({ ...parsed, source: "upload", periodStart: parsed.periodStart ?? "2000-01-01", periodEnd: parsed.periodEnd ?? "2000-01-01" })
  const filed14 = boxes["14"]?.amount
  if (filed14 !== undefined && Math.abs(filed14 - (check.boxes["14"]?.amount ?? 0)) > 0.05)
    warnings.push(`Box 14 in the file (${filed14.toLocaleString("en-US")}) differs from the boxes read (${(check.boxes["14"]?.amount ?? 0).toLocaleString("en-US")}). Check the figures.`)
  return { filing: parsed, found, warnings }
}

/* ---------------------------------------------------------- years & quarters */

export type VatPeriodSlot = { id: string; start: string; end: string; dueDate: string; label: string; registered: boolean }
export type VatYear = { key: string; label: string; start: string; end: string; periods: VatPeriodSlot[] }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const monthEnd = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0))
const addDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}
const short = (month0: number) => monthNames[((month0 % 12) + 12) % 12].slice(0, 3)

export function taxYearStartMonth(company: Company, settings: VatSettings) {
  return settings.taxYearStartMonth ?? (company.vat.cycleStartMonth || 1)
}

/** Tax years (e.g. "2025-2026" for May to April) with their quarters or months. */
export function vatYears(company: Company, settings: VatSettings, filings: Record<string, VatFiling>, today = iso(new Date())): VatYear[] {
  const startMonth0 = taxYearStartMonth(company, settings) - 1
  const monthly = company.vat.frequency === "monthly"
  const step = monthly ? 1 : 3
  const effective = company.vat.effectiveDate
  const firstDate = [effective, ...Object.values(filings).map((f) => f.periodStart)].filter(Boolean).sort()[0] ?? `${Number(today.slice(0, 4)) - 1}-01-01`
  const yearOf = (date: string) => {
    const y = Number(date.slice(0, 4))
    const m = Number(date.slice(5, 7)) - 1
    return m >= startMonth0 ? y : y - 1
  }
  const years: VatYear[] = []
  for (let y = yearOf(firstDate); y <= yearOf(today); y++) {
    const start = iso(new Date(Date.UTC(y, startMonth0, 1)))
    const end = iso(monthEnd(y + 1, startMonth0 - 1))
    const periods: VatPeriodSlot[] = []
    for (let k = 0; k < 12; k += step) {
      const m0 = startMonth0 + k
      const pStartDate = new Date(Date.UTC(y, m0, 1))
      const pEnd = iso(monthEnd(pStartDate.getUTCFullYear(), pStartDate.getUTCMonth() + step - 1))
      let pStart = iso(pStartDate)
      const registered = !effective || effective <= pEnd
      if (effective && effective > pStart && effective <= pEnd) pStart = effective
      const startYear = pStartDate.getUTCFullYear()
      const endYear = Number(pEnd.slice(0, 4))
      const months = monthly ? `${short(m0)} ${startYear}` : `${short(m0)}–${short(m0 + step - 1)} ${startYear === endYear ? startYear : `${startYear}/${endYear}`}`
      periods.push({ id: `${pStart}_${pEnd}`, start: pStart, end: pEnd, dueDate: addDays(pEnd, 28), label: months, registered })
    }
    years.push({ key: String(y), label: startMonth0 === 0 ? String(y) : `${y}-${y + 1}`, start, end, periods })
  }
  return years
}

/** The saved filing for a slot, also matching filings saved under a slightly different id. */
export function filingFor(slot: VatPeriodSlot, filings: Record<string, VatFiling>) {
  return filings[slot.id] ?? Object.values(filings).find((f) => f.periodEnd === slot.end) ?? null
}

/* ------------------------------------------------------------------ analysis */

export type Insight = { level: "alert" | "warning" | "info" | "good"; title: string; text: string; law?: string }
export type VatAnalysis = {
  filed: number
  taxableSupplies12m: number | null
  months12: number
  annualised: boolean
  yearTotals: { taxableSupplies: number; exempt: number; outputVat: number; recoverable: number; net: number }
  series: { label: string; sales: number; net: number }[]
  insights: Insight[]
}

const fmt = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`

export function analyse(company: Company, years: VatYear[], filings: Record<string, VatFiling>, yearKey: string, today = iso(new Date())): VatAnalysis {
  const slots = years.flatMap((y) => y.periods)
  const filed = slots.map((slot) => ({ slot, filing: filingFor(slot, filings) })).filter((x): x is { slot: VatPeriodSlot; filing: VatFiling } => Boolean(x.filing))
  const supplies = (f: VatFiling) => STANDARD.reduce((t, k) => t + val(f, k, "amount"), 0) + val(f, "4", "amount")
  const insights: Insight[] = []
  const year = years.find((y) => y.key === yearKey)

  // Year totals
  const yearFiled = filed.filter((x) => year?.periods.some((p) => p.id === x.slot.id))
  const yearTotals = yearFiled.reduce(
    (acc, { filing }) => {
      const t = totals(filing)
      acc.taxableSupplies += supplies(filing)
      acc.exempt += val(filing, "5", "amount")
      acc.outputVat += t.due
      acc.recoverable += t.recoverable
      acc.net += t.payable
      return acc
    },
    { taxableSupplies: 0, exempt: 0, outputVat: 0, recoverable: 0, net: 0 }
  )
  const series = (year?.periods ?? []).map((slot) => {
    const f = filingFor(slot, filings)
    return { label: slot.label, sales: f ? supplies(f) : 0, net: f ? totals(f).payable : 0 }
  })

  // Missing returns past their due date.
  const missing = slots.filter((slot) => slot.registered && slot.dueDate < today && !filingFor(slot, filings))
  if (missing.length)
    insights.push({
      level: "warning",
      title: `${missing.length} return${missing.length === 1 ? "" : "s"} not recorded`,
      text: `${missing.map((s) => s.label).join(", ")} ${missing.length === 1 ? "is" : "are"} past the due date and not uploaded here. If ${missing.length === 1 ? "it was" : "they were"} filed, upload the return so the analysis is complete; if not, file as soon as possible — late filing and late payment penalties apply.`,
      law: "Art. 64 Decree-Law 8/2017; Cabinet Decision on administrative penalties",
    })
  const next = slots.filter((slot) => slot.registered && slot.dueDate >= today && slot.end < today && !filingFor(slot, filings)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  if (next) insights.push({ level: "info", title: "Next return due", text: `${next.label} must be filed and paid by ${next.dueDate.split("-").reverse().join("/")} (28 days after the period end).`, law: "Art. 64" })

  // Rolling 12 months of filed returns (most recent consecutive filings).
  const recent = [...filed].sort((a, b) => b.slot.end.localeCompare(a.slot.end))
  let months = 0
  let total12 = 0
  for (const { slot, filing } of recent) {
    const len = Math.round((new Date(`${slot.end}T00:00:00Z`).getTime() - new Date(`${slot.start}T00:00:00Z`).getTime()) / (30.44 * 864e5))
    if (months >= 12) break
    months += Math.max(1, len)
    total12 += supplies(filing)
  }
  const annualised = months > 0 && months < 12
  const taxable12 = months ? (annualised ? (total12 / months) * 12 : total12) : null
  if (taxable12 !== null) {
    const basis = annualised ? `annualised from ${months} month${months === 1 ? "" : "s"} of returns` : "over the last 12 months of returns"
    const zeroQuarters = recent.slice(0, 4).filter(({ filing }) => supplies(filing) === 0).length
    if (recent.length >= 2 && zeroQuarters === Math.min(4, recent.length))
      insights.push({
        level: "alert",
        title: "No taxable supplies reported — deregistration",
        text: "The recent returns show no taxable supplies. A registrant that stops making taxable supplies must apply to deregister within 20 business days, unless it expects to make taxable supplies again. Start a deregistration review.",
        law: "Art. 21(1)(a) Decree-Law 8/2017",
      })
    else if (taxable12 < 187_500)
      insights.push({
        level: "alert",
        title: "Below the voluntary threshold — start a deregistration analysis",
        text: `Taxable supplies are ${fmt(taxable12)} ${basis}, below the voluntary registration threshold of AED 187,500. A registrant must apply for deregistration when its taxable supplies (and taxable expenses) over the previous 12 months fall below this threshold, within 20 business days. Review the last 12 months and expected supplies before applying.`,
        law: "Art. 21(1)(b) Decree-Law 8/2017; Art. 14 Executive Regulation",
      })
    else if (taxable12 < 375_000)
      insights.push({
        level: "warning",
        title: "Below the mandatory threshold — deregistration is optional",
        text: `Taxable supplies are ${fmt(taxable12)} ${basis}, between AED 187,500 and AED 375,000. After at least 12 months of registration the company may apply to deregister voluntarily. Consider whether supplies will exceed AED 375,000 in the next 30 days and whether input VAT recovery makes staying registered worthwhile.`,
        law: "Art. 21(2) Decree-Law 8/2017",
      })
    else
      insights.push({
        level: "good",
        title: "Registration is required",
        text: `Taxable supplies are ${fmt(taxable12)} ${basis}, above the mandatory threshold of AED 375,000.`,
        law: "Art. 13 Decree-Law 8/2017",
      })
    if (taxable12 >= 150_000_000 && company.vat.frequency !== "monthly")
      insights.push({ level: "warning", title: "Monthly returns", text: `Annual taxable supplies of ${fmt(taxable12)} are AED 150 million or more; the FTA normally requires monthly tax periods.`, law: "Art. 59 Executive Regulation" })
  }

  // Trend between the two latest returns.
  if (recent.length >= 2) {
    const [a, b] = recent
    const now = supplies(a.filing)
    const before = supplies(b.filing)
    if (before > 0) {
      const change = ((now - before) / before) * 100
      if (Math.abs(change) >= 20)
        insights.push({
          level: "info",
          title: `Sales ${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(0)}%`,
          text: `Taxable supplies moved from ${fmt(before)} (${b.slot.label}) to ${fmt(now)} (${a.slot.label}).${change < -50 ? " A sharp fall: check for missing invoices or credit notes, and watch the registration thresholds." : ""}`,
        })
    }
  }

  // Per-return checks on the latest filing.
  for (const { slot, filing } of recent.slice(0, 1)) {
    const t = totals(filing)
    for (const key of STANDARD) {
      const amount = val(filing, key, "amount")
      const vat = val(filing, key, "vat")
      if (amount && Math.abs(vat - amount * 0.05) > Math.max(1, amount * 0.0025))
        insights.push({ level: "warning", title: `Box ${key}: VAT is not 5%`, text: `${slot.label}: VAT of ${fmt(vat)} on ${fmt(amount)} is ${((vat / amount) * 100).toFixed(2)}%. Check for VAT-inclusive amounts or mixed-rate items.`, law: "Art. 3 Decree-Law 8/2017" })
    }
    if (t.payable < 0)
      insights.push({ level: "info", title: "Refund position", text: `${slot.label} shows recoverable VAT of ${fmt(-t.payable)}. It can be carried forward against future VAT or claimed with a refund application; keep tax invoices for every input claim.`, law: "Art. 74 Decree-Law 8/2017" })
    const output = t.due
    if (output > 0 && t.recoverable / output < 0.05 && supplies(filing) > 100_000)
      insights.push({ level: "info", title: "Very little input VAT claimed", text: `${slot.label}: input VAT is only ${((t.recoverable / output) * 100).toFixed(1)}% of output VAT. Check that VAT on rent, services and purchases from registered suppliers is being claimed.` })
    const zero = val(filing, "4", "amount")
    if (zero > 0 && zero / Math.max(1, supplies(filing)) > 0.3)
      insights.push({ level: "info", title: "High zero-rated sales", text: `${fmt(zero)} of zero-rated supplies in ${slot.label}. Keep export evidence (customs exit within 90 days, contracts showing the customer is outside the UAE) for each sale.`, law: "Art. 45 Decree-Law 8/2017; Art. 30-31 Executive Regulation" })
    if (val(filing, "5", "amount") > 0)
      insights.push({ level: "info", title: "Exempt supplies", text: `Exempt supplies of ${fmt(val(filing, "5", "amount"))} mean input VAT on shared costs must be apportioned, with an annual adjustment in the first return after the tax year ends.`, law: "Art. 55 Decree-Law 8/2017; Art. 55 Executive Regulation" })
    const rcOut = val(filing, "3", "vat")
    const rcIn = val(filing, "10", "vat")
    if (rcOut && Math.abs(rcOut - rcIn) > 1)
      insights.push({ level: "info", title: "Reverse charge not fully recovered", text: `Reverse charge VAT declared ${fmt(rcOut)} but ${fmt(rcIn)} recovered. That is right only if the services relate to exempt or blocked costs.`, law: "Art. 48 Decree-Law 8/2017" })
    if (val(filing, "6", "vat") && !rcIn)
      insights.push({ level: "warning", title: "Import VAT not recovered", text: `Import VAT of ${fmt(val(filing, "6", "vat"))} was declared but nothing is recovered in Box 10. Import VAT is normally recoverable for taxable business use.` })
    const adj = STANDARD.reduce((s, k) => s + val(filing, k, "adjustment"), 0)
    if (adj || val(filing, "9", "adjustment"))
      insights.push({ level: "info", title: "Adjustments reported", text: "Adjustments in the return (credit notes, bad debt relief, apportionment) must be supported by tax credit notes or working papers.", law: "Art. 62-64 Decree-Law 8/2017" })
    if (filing.profitMarginScheme) insights.push({ level: "info", title: "Profit margin scheme used", text: "VAT under the profit margin scheme is due on the margin only; keep records of the purchase price of each item sold.", law: "Art. 43 Decree-Law 8/2017" })
    if (val(filing, "2", "vat")) insights.push({ level: "info", title: "Tourist refunds", text: "Tourist refund amounts must match the Planet tax-free records for the period." })
  }

  // E-invoicing readiness (dates from the rulebook).
  if (taxable12 !== null)
    insights.push({
      level: "info",
      title: "E-invoicing",
      text: taxable12 >= 50_000_000 ? "With revenue of AED 50 million or more, e-invoicing applies from 1 January 2027." : "E-invoicing applies to businesses below AED 50 million from 1 July 2027. Start preparing your invoicing system and accredited service provider.",
    })

  const yearSales = yearTotals.taxableSupplies
  if (yearFiled.length && yearSales > 0)
    insights.push({ level: "good", title: "Net VAT burden", text: `For ${year?.label}, net VAT ${yearTotals.net >= 0 ? "paid" : "refundable"} is ${fmt(Math.abs(yearTotals.net))}, ${((Math.abs(yearTotals.net) / yearSales) * 100).toFixed(1)}% of taxable supplies of ${fmt(yearSales)}.` })

  return {
    filed: filed.length,
    taxableSupplies12m: taxable12 === null ? null : Math.round(taxable12),
    months12: Math.min(12, months),
    annualised,
    yearTotals: Object.fromEntries(Object.entries(yearTotals).map(([k, v]) => [k, r2(v)])) as VatAnalysis["yearTotals"],
    series,
    insights,
  }
}
