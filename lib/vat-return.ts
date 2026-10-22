import { z } from "zod"
import { daysBetween, emirates, financialPeriod, formatLongDate, monthNames, vatPeriods, type Company, type VatPeriod } from "./company"
import { isFreeZone } from "./ct-return"
import { categoryOf, type FinancialRecord } from "./financial-statements"

/**
 * UAE VAT estimate and VAT 201 return worksheet, following the UAE VAT Rulebook
 * (v2026-10-22: Federal Decree-Law No. 8 of 2017 and its Executive Regulation as amended).
 *
 * FinScope is not a bookkeeping system: it has the trial balance by year, not invoices.
 * So every income and expense head is classified with a rule from the rulebook (with a
 * sensible default worked out from the head name, the business activity and the company's
 * location), the year's figures are spread over the VAT periods, and the boxes of the
 * VAT 201 return are estimated. The user can correct any classification or split a head
 * between treatments, and enter actual period totals to replace the estimate.
 */

export const VAT_RATE = 0.05
export const FOOTER = "Approximate estimate based on the UAE VAT Rulebook v2026-10-22. Subject to review by a qualified tax advisor."

/* ------------------------------------------------------------- rule catalogue */

export type Treatment = "standard" | "zero" | "exempt" | "oos" | "rcServices" | "rcImport" | "rcDomestic"
export type VatRule = {
  id: string
  label: string
  side: "revenue" | "expense"
  treatment: Treatment
  /** Expense rules: share of the VAT that can be recovered when used for taxable supplies. */
  recovery?: number
  recoveryRule?: string
}

export const VAT_RULES: VatRule[] = [
  // Revenue
  { id: "STD-01", side: "revenue", treatment: "standard", label: "5% — sale of goods in the UAE" },
  { id: "STD-02", side: "revenue", treatment: "standard", label: "5% — services in the UAE" },
  { id: "STD-03", side: "revenue", treatment: "standard", label: "5% — commercial property sale or lease" },
  { id: "STD-04", side: "revenue", treatment: "standard", label: "5% — hotels, restaurants, catering, events" },
  { id: "STD-06", side: "revenue", treatment: "standard", label: "5% — real estate brokerage / property management" },
  { id: "STD-12", side: "revenue", treatment: "standard", label: "5% — jewellery and gold below 99% purity" },
  { id: "STD-16", side: "revenue", treatment: "standard", label: "5% — services to non-residents used in the UAE" },
  { id: "ZR-01", side: "revenue", treatment: "zero", label: "0% — export of goods outside the GCC (with evidence, 90 days)" },
  { id: "ZR-02", side: "revenue", treatment: "zero", label: "0% — goods to other GCC states" },
  { id: "ZR-03", side: "revenue", treatment: "zero", label: "0% — services to non-resident customers (not used in UAE)" },
  { id: "ZR-04", side: "revenue", treatment: "zero", label: "0% — international transport and related services" },
  { id: "ZR-07", side: "revenue", treatment: "zero", label: "0% — first sale / lease of new residential building" },
  { id: "ZR-09", side: "revenue", treatment: "zero", label: "0% — investment gold, silver, platinum (99%+)" },
  { id: "ZR-10", side: "revenue", treatment: "zero", label: "0% — school / nursery education" },
  { id: "ZR-12", side: "revenue", treatment: "zero", label: "0% — preventive and basic healthcare" },
  { id: "ZR-06", side: "revenue", treatment: "zero", label: "0% — crude oil and natural gas" },
  { id: "EX-01", side: "revenue", treatment: "exempt", label: "Exempt — interest, finance margin" },
  { id: "EX-05", side: "revenue", treatment: "exempt", label: "Exempt — residential property resale / lease" },
  { id: "EX-06", side: "revenue", treatment: "exempt", label: "Exempt — bare land" },
  { id: "EX-07", side: "revenue", treatment: "exempt", label: "Exempt — local passenger transport" },
  { id: "EX-08", side: "revenue", treatment: "exempt", label: "Exempt — virtual assets" },
  { id: "OOS-02", side: "revenue", treatment: "oos", label: "Out of scope — dividends" },
  { id: "OOS-04", side: "revenue", treatment: "oos", label: "Out of scope — compensation / damages" },
  { id: "OOS-08", side: "revenue", treatment: "oos", label: "Out of scope — goods sold outside the UAE" },
  { id: "OOS-REV", side: "revenue", treatment: "oos", label: "Out of scope — not a supply (FX gains, capital, grants)" },
  { id: "RC-03S", side: "revenue", treatment: "rcDomestic", label: "Domestic reverse charge sale (phones, gold, scrap, hydrocarbons) — buyer accounts" },
  // Expenses
  { id: "IN-01", side: "expense", treatment: "standard", recovery: 1, recoveryRule: "IN-01", label: "5% purchase in the UAE — recoverable" },
  { id: "IN-09", side: "expense", treatment: "standard", recovery: 1, recoveryRule: "IN-09", label: "5% mandatory employee cost (statutory health insurance) — recoverable" },
  { id: "IN-10", side: "expense", treatment: "standard", recovery: 1, recoveryRule: "IN-10", label: "5% commercial vehicles used only for business — recoverable" },
  { id: "IN-05", side: "expense", treatment: "standard", recovery: 0, recoveryRule: "IN-05", label: "5% client / guest entertainment — VAT blocked" },
  { id: "IN-06", side: "expense", treatment: "standard", recovery: 0, recoveryRule: "IN-06", label: "5% cars available for private use — VAT blocked" },
  { id: "IN-07", side: "expense", treatment: "standard", recovery: 0, recoveryRule: "IN-07", label: "5% employee personal benefits — VAT blocked" },
  { id: "IN-04", side: "expense", treatment: "standard", recovery: 0, recoveryRule: "IN-04", label: "5% non-business expense — not recoverable" },
  { id: "RC-01", side: "expense", treatment: "rcServices", recovery: 1, recoveryRule: "IN-11", label: "Reverse charge — services from suppliers outside the UAE" },
  { id: "RC-02", side: "expense", treatment: "rcImport", recovery: 1, recoveryRule: "IN-11", label: "Reverse charge — goods imported into the UAE" },
  { id: "RC-03", side: "expense", treatment: "rcDomestic", recovery: 1, recoveryRule: "IN-11", label: "Domestic reverse charge purchase (phones, gold, scrap, hydrocarbons)" },
  { id: "ZR-EXP", side: "expense", treatment: "zero", recovery: 0, label: "0% purchase — no VAT charged (international flights, exports)" },
  { id: "EX-EXP", side: "expense", treatment: "exempt", recovery: 0, label: "Exempt purchase — no VAT (residential rent, interest, local passenger transport)" },
  { id: "OOS-01", side: "expense", treatment: "oos", recovery: 0, label: "Out of scope — salaries, wages, end of service" },
  { id: "OOS-07", side: "expense", treatment: "oos", recovery: 0, label: "Out of scope — government fees, visas, licences, fines" },
  { id: "OOS-10", side: "expense", treatment: "oos", recovery: 0, label: "Out of scope — donations" },
  { id: "OOS-EXP", side: "expense", treatment: "oos", recovery: 0, label: "Out of scope — not a purchase (depreciation, FX, provisions)" },
]
export const ruleById = (id: string) => VAT_RULES.find((rule) => rule.id === id)

/* ------------------------------------------------------------------- answers */

const split = z.object({ rule: z.string().max(12), percent: z.number().min(0).max(100) })
export const vatHeadSchema = z.object({
  splits: z.array(split).min(1).max(6),
  usedFor: z.enum(["auto", "taxable", "exempt", "mixed"]).default("auto"),
})
export const vatProfileSchema = z.object({
  locationType: z.enum(["auto", "mainland", "free_zone", "designated_zone"]).default("auto"),
  taxGroup: z.boolean().default(false),
  /** Share of standard-rated sales made from each emirate (Box 1a-1g). */
  emirateSplit: z.record(z.string().max(40), z.number().min(0).max(100)).default({}),
  heads: z.record(z.string().max(200), vatHeadSchema).default({}),
  profitMarginScheme: z.boolean().default(false),
  signatoryName: z.string().max(120).default(""),
  signatoryMobile: z.string().max(40).default(""),
  signatoryEmail: z.string().max(120).default(""),
})
export const vatPeriodAnswersSchema = z.object({
  /** Actual totals for the period (excluding VAT); replace the estimate when entered. */
  actualSales: z.number().min(0).max(1e10).nullable().default(null),
  actualExpenses: z.number().min(0).max(1e10).nullable().default(null),
  touristRefunds: z.number().min(0).max(1e10).default(0),
  importAdjustment: z.number().min(-1e10).max(1e10).default(0),
  outputAdjustment: z.number().min(-1e10).max(1e10).default(0),
  inputAdjustment: z.number().min(-1e10).max(1e10).default(0),
})
export type VatProfile = z.infer<typeof vatProfileSchema>
export type VatPeriodAnswers = z.infer<typeof vatPeriodAnswersSchema>
export type VatAnswers = { profile: Partial<VatProfile>; periods: Record<string, Partial<VatPeriodAnswers>> }
/** Keeps only answers the user actually gave, each validated; bad values are dropped. */
export function readVatAnswers(raw: unknown): VatAnswers {
  const pick = (source: unknown, shape: Record<string, z.ZodTypeAny>) => {
    const out: Record<string, unknown> = {}
    if (!source || typeof source !== "object") return out
    for (const [field, value] of Object.entries(source)) if (shape[field]?.safeParse(value).success) out[field] = value
    return out
  }
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const periods: VatAnswers["periods"] = {}
  if (root.periods && typeof root.periods === "object")
    for (const [id, value] of Object.entries(root.periods as Record<string, unknown>))
      if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(id)) periods[id] = pick(value, vatPeriodAnswersSchema.shape) as Partial<VatPeriodAnswers>
  return { profile: pick(root.profile, vatProfileSchema.shape) as Partial<VatProfile>, periods }
}
export const vatAnswersSchema = z
  .unknown()
  .refine((value) => JSON.stringify(value ?? {}).length < 200_000, "VAT answers are too large.")
  .transform((value): VatAnswers => readVatAnswers(value))

/* --------------------------------------------------------------------- lines */

export type VatLine = {
  id: string
  name: string
  side: "revenue" | "expense"
  scheduleKey: string
  /** Annual amount excluding VAT, positive. */
  annual: number
}
export type Classification = { splits: { rule: string; percent: number }[]; reason: string; flag?: string }

const round2 = (n: number) => Math.round(n * 100) / 100
const lineId = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ")
const CONTRA = /depreciation|allowance|accumulated|amorti[sz]ation/i

/** Income and expense heads of a year (plus capital purchases), as VAT lines. */
export function vatLines(record: FinancialRecord, prior: FinancialRecord | null): VatLine[] {
  const rows = record.closingRows ?? record.rows
  const byName = new Map<string, VatLine>()
  for (const row of rows) {
    const category = categoryOf(row.scheduleKey)
    if (!category || category.statement !== "P&L") continue
    const side: VatLine["side"] = row.scheduleKey === "sales" || row.scheduleKey === "otherIncome" ? "revenue" : "expense"
    // Exchange differences sit on either side; keep them as one line.
    const id = lineId(row.ledgerName)
    const amount = side === "revenue" ? -row.amount : row.amount
    const existing = byName.get(id)
    if (existing) existing.annual += amount
    else byName.set(id, { id, name: row.ledgerName.trim(), side, scheduleKey: row.scheduleKey, annual: amount })
  }
  // Capital purchases: increase in the cost of fixed assets.
  const cost = (r: FinancialRecord | null) =>
    r ? (r.closingRows ?? r.rows).filter((x) => x.scheduleKey === "ppe" && !CONTRA.test(x.ledgerName) && x.amount > 0).reduce((t, x) => t + x.amount, 0) : 0
  const additions = cost(record) - cost(prior)
  if (additions > 0.5) byName.set("capital purchases (fixed assets)", { id: "capital purchases (fixed assets)", name: "Capital purchases (fixed assets)", side: "expense", scheduleKey: "ppe", annual: additions })
  return [...byName.values()].filter((line) => Math.abs(line.annual) >= 0.005).map((line) => ({ ...line, annual: round2(line.annual) }))
}

/** Default rule for a head, from its name, the business activity and the company's location. */
export function classify(line: VatLine, activity: string, location: "mainland" | "free_zone" | "designated_zone"): Classification {
  const name = line.name.toLowerCase()
  const act = activity.toLowerCase()
  const one = (rule: string, reason: string, flag?: string): Classification => ({ splits: [{ rule, percent: 100 }], reason, flag })
  if (line.scheduleKey === "exchange") return one(line.side === "revenue" ? "OOS-REV" : "OOS-EXP", "Exchange differences are not a supply.")
  if (line.side === "revenue") {
    if (/interest|profit on deposit|murabaha/.test(name)) return one("EX-01", "Interest and finance margin are exempt (EX-01).")
    if (/dividend/.test(name)) return one("OOS-02", "Dividends are outside the scope of VAT (OOS-02).")
    if (/compensation|damages|insurance claim/.test(name)) return one("OOS-04", "Compensation with nothing supplied in return is out of scope (OOS-04).")
    if (/export/.test(name)) return one("ZR-01", "Head is named as exports: 0% if the goods leave the UAE within 90 days with evidence (ZR-01).", "J-02: keep customs exit evidence for each export.")
    if (line.scheduleKey === "otherIncome")
      return one("STD-02", "Other income could not be matched to a category, so 5% is assumed (J-13).", "J-13: describe what this other income is; scrap sales, rebates and recharges are 5%, interest is exempt, grants and capital gains on shares are outside scope.")
    if (/school|nursery|kindergarten|pre-?school/.test(act)) return one("ZR-10", "School or nursery tuition is zero-rated for recognised providers (ZR-10).", "J: confirm the provider is recognised; uniforms, transport and extracurricular fees are 5% (STD-09).")
    if (/clinic|hospital|medical cent|healthcare|health care|dental|polyclinic/.test(act)) return one("ZR-12", "Preventive and basic healthcare is zero-rated (ZR-12).", "J-07: cosmetic and elective treatment and unlisted products are 5% (STD-11); split this head if needed.")
    if (/residential/.test(act) && /leas|rent/.test(act)) return one("EX-05", "Lease of residential property is exempt (EX-05).", "J-05: the first supply within 3 years of completion is 0% (ZR-07); serviced apartments are 5%.")
    if (/brokerage|real estate (broker|agent)|property management|facility management/.test(act)) return one("STD-06", "Real estate brokerage and property management are 5% (STD-06).")
    if (/hotel|restaurant|cafe|catering|event/.test(act)) return one("STD-04", "Hospitality in the UAE is 5% (STD-04).")
    if (/freight|shipping|cargo|logistics|air ?line|international transport/.test(act))
      return one("ZR-04", "International transport and directly related services are zero-rated (ZR-04).", "J: domestic goods transport, warehousing and local delivery are 5% (STD-13); split this head if needed.")
    if (/passenger transport|taxi|limousine|bus /.test(act)) return one("EX-07", "Local passenger transport is exempt (EX-07).", "J: car rental and goods transport are 5%.")
    if (/crude|natural gas/.test(act)) return one("ZR-06", "Crude oil and natural gas are zero-rated (ZR-06).")
    if (/bullion|investment gold|precious metal/.test(act)) return one("ZR-09", "Investment precious metals of 99% purity are zero-rated (ZR-09).", "J: gold below 99% and jewellery are 5%; sales to registered dealers may be domestic reverse charge.")
    if (/jewel/.test(act)) return one("STD-12", "Jewellery is 5% (STD-12).")
    if (/bank|finance company|money exchange|exchange house|lending|microfinance/.test(act))
      return one("EX-01", "Finance margin is exempt (EX-01).", "J: explicit fees and commissions are 5% (STD-10); split this head between exempt margin and fees.")
    const services = /consult|management|advis|service|software|it |information technology|marketing|design|recruit|training|audit|account|legal|agency|media/.test(act)
    const goods = /trading|trade|retail|wholesale|e-?commerce|manufactur|supply of|sale of/.test(act)
    if (services && !goods) {
      if (location !== "mainland")
        return one("STD-02", "Services supplied in the UAE are 5% (STD-02, FZ-01: free zone services follow mainland rules).", "J-03: services to customers outside the UAE who do not use them in the UAE are 0% (ZR-03); split this head by customer location.")
      return one("STD-02", "Services supplied in the UAE are 5% (STD-02).", "J-03: if some customers are outside the UAE, that share can be 0% (ZR-03).")
    }
    if (/export|import/.test(act)) return one("STD-01", "Sale of goods in the UAE is 5% (STD-01).", "J-02: the activity includes export; exported goods with exit evidence are 0% (ZR-01). Split this head.")
    if (location === "designated_zone") return one("STD-01", "Goods sold to the mainland or consumed in the zone are 5% (FZ-04/FZ-05).", "J-08: goods sold to another Designated Zone and not consumed are out of scope (OOS-09).")
    return one(goods ? "STD-01" : "STD-02", goods ? "Sale of goods in the UAE is 5% (STD-01)." : "Supplies in the UAE are 5% by default (STD-02).")
  }
  // Expenses
  if (/salar|wage|gratuity|end of service|payroll|bonus|commission to staff/.test(name) || line.scheduleKey === "payroll")
    return one("OOS-01", "Salaries and staff benefits paid to employees are outside the scope of VAT (OOS-01).")
  if (/visa|immigration|labou?r|licen[cs]e|government|municipal|\brta\b|traffic|\bfines?\b|penalt|trade name|chamber/.test(name))
    return one("OOS-07", "Government fees, licences, visas and fines are outside the scope of VAT (OOS-07).")
  if (/donation|charity|zakat/.test(name)) return one("OOS-10", "Donations with nothing received in return are out of scope (OOS-10).")
  if (line.scheduleKey === "depreciation") return one("OOS-EXP", "Depreciation is not a purchase; VAT on the asset is claimed when it is bought (capital purchases line).")
  if (line.scheduleKey === "ppe") return one("IN-01", "Fixed assets bought in the UAE carry 5% VAT, recoverable when used for taxable supplies (IN-01).", "J: imported equipment is reverse charge (RC-02); cars available for private use are blocked (IN-06).")
  if (line.scheduleKey === "finance") {
    if (/interest|loan|finance cost|profit/.test(name)) return one("EX-EXP", "Interest charged by banks is exempt; there is no VAT to recover (EX-01).")
    return one("IN-01", "Explicit bank charges and fees carry 5% VAT (STD-10), recoverable (IN-01).")
  }
  if (line.scheduleKey === "entertainment")
    return one("IN-05", "VAT on entertaining clients and guests is blocked (IN-05).", "J: staff entertainment and office refreshments are recoverable (IN-01); split this head if part is for employees.")
  if (line.scheduleKey === "medical" || /health insurance|medical insurance/.test(name))
    return one("IN-09", "Statutory employee health insurance carries 5% VAT, recoverable (IN-09).", "J: medical costs for employees' families or optional cover are personal benefits, blocked (IN-07).")
  if (line.scheduleKey === "rent") {
    if (/accommodation|residential|flat|villa|staff housing|labour camp/.test(name)) return one("EX-EXP", "Residential rent is exempt; there is no VAT to recover (EX-05, IN-08).")
    return one("IN-01", "Commercial rent (office, shop, warehouse) is 5% and recoverable (STD-03, IN-01).", "J: if part is staff accommodation, that part is exempt (EX-05).")
  }
  if (line.scheduleKey === "travel") return one("ZR-EXP", "International air tickets are zero-rated and foreign hotels are outside UAE VAT, so no recoverable VAT is assumed (ZR-04).", "J: UAE hotels and car hire carry 5% and are recoverable for business trips; split this head if material.")
  if (line.scheduleKey === "vehicle") return one("IN-01", "Fuel, servicing and leasing of business vehicles carry 5% (IN-01).", "J: VAT on cars available for private use is blocked (IN-06).")
  if (line.scheduleKey === "insurance") {
    if (/life/.test(name)) return one("EX-EXP", "Life insurance is exempt (EX-03).")
    return one("IN-01", "General insurance (motor, property, liability) is 5% and recoverable (STD-08).")
  }
  if (/software|subscription|google|facebook|meta|linkedin|aws|amazon web|microsoft|zoom|adobe|cloud|hosting|domain/.test(name))
    return one("RC-01", "Online services from suppliers outside the UAE are reverse charged: declare 5% output and recover 5% input (RC-01).", "J-04: if the supplier is UAE-registered and charges VAT, change to 5% purchase (IN-01).")
  if (line.scheduleKey === "subscriptions") return one("OOS-07", "Fees and subscriptions are treated as government and authority fees (OOS-07).", "J-13: software and memberships from UAE suppliers are 5% (IN-01); from foreign suppliers they are reverse charge (RC-01).")
  if (line.scheduleKey === "costOfSales") {
    if (/import/.test(name)) return one("RC-02", "Imported goods: VAT on import is reverse charged and recoverable (RC-02).")
    if (/import|export|international/.test(activity.toLowerCase()))
      return one("IN-01", "Purchases from UAE suppliers carry 5% VAT, recoverable (IN-01).", "J: the activity mentions import; split the imported share to reverse charge (RC-02).")
    return one("IN-01", "Purchases from UAE suppliers carry 5% VAT, recoverable (IN-01).")
  }
  return one("IN-01", "Business expenses from UAE suppliers carry 5% VAT, recoverable (IN-01).")
}

/* ------------------------------------------------------------------ the return */

export type BoxLine = { box: string; label: string; amount: number; vat: number; adjustment: number; editable?: keyof VatPeriodAnswers; vatOnly?: boolean }
export type LineResult = {
  id: string
  name: string
  side: "revenue" | "expense"
  amount: number
  rule: string
  ruleLabel: string
  treatment: Treatment
  vat: number
  recoverablePercent: number
  recoverable: number
  reason: string
  flag?: string
  overridden: boolean
}
export type VatReturn = {
  period: VatPeriod
  stagger: string
  taxYearEnd: string
  coverage: "Estimated" | "Partial data" | "No data" | "Actual totals"
  coveredDays: number
  location: "mainland" | "free_zone" | "designated_zone"
  lines: LineResult[]
  boxes: BoxLine[]
  outputVat: number
  recoverableVat: number
  payable: number
  recoveryRate: number | null
  totals: { standard: number; zero: number; exempt: number; oos: number; reverseCharge: number; imports: number }
  commentary: string[]
  assumptions: string[]
  review: string[]
  footer: string
}

export function staggerLabel(company: Company) {
  if (company.vat.frequency === "monthly") return { label: "Monthly", taxYearEndMonth: 12 }
  const endMonth = ((company.vat.cycleStartMonth + 1) % 12) + 1 // first quarter end month (1-12)
  const stagger = ((endMonth - 1) % 3) + 1
  const lastEnd = stagger === 3 ? 12 : stagger // stagger 1 ends Jan, 2 Feb, 3 Dec
  const firstMonth = (lastEnd % 12) + 1
  return {
    label: `Stagger ${stagger} – Quarterly (${monthNames[firstMonth - 1].slice(0, 3)} to ${monthNames[lastEnd - 1].slice(0, 3)})`,
    taxYearEndMonth: lastEnd,
  }
}

function taxYearEnd(periodEnd: string, endMonth: number) {
  let year = Number(periodEnd.slice(0, 4))
  const month = Number(periodEnd.slice(5, 7))
  if (month > endMonth) year += 1
  return financialPeriod(year, endMonth).end
}

export function locationOf(company: Company, profile: Partial<VatProfile>) {
  if (profile.locationType && profile.locationType !== "auto") return profile.locationType
  return isFreeZone(company) ? "free_zone" : "mainland"
}

/** All VAT periods covered by the saved years. */
export function vatReturns(company: Company, records: FinancialRecord[], answers: VatAnswers): VatReturn[] {
  if (!company.vat.trn || !records.length) return []
  const years = records.map((record) => ({ record, ...financialPeriod(record.year, company.ct.yearEndMonth) }))
  const from = years.reduce((min, y) => (y.start < min ? y.start : min), years[0].start)
  const to = years.reduce((max, y) => (y.end > max ? y.end : max), years[0].end)
  return vatPeriods(company.vat, from, to).map((period) => buildVatReturn(company, records, period, answers))
}

export function buildVatReturn(company: Company, records: FinancialRecord[], period: VatPeriod, answers: VatAnswers): VatReturn {
  const profile = vatProfileSchema.parse(answers.profile ?? {})
  const pa = vatPeriodAnswersSchema.parse(answers.periods?.[period.id] ?? {})
  const location = locationOf(company, answers.profile ?? {})
  const assumptions: string[] = []
  const review: string[] = []
  if (!answers.profile?.locationType)
    assumptions.push(`Location treated as ${location === "free_zone" ? "a free zone (non-designated) — services follow mainland rules (FZ-01)" : "mainland"} from the licensing authority. Change it on the VAT profile.`)
  if (location === "free_zone") review.push("J-08: if the free zone is a Designated Zone, goods moving between Designated Zones are out of scope. Confirm on the VAT profile.")
  assumptions.push("Trial balance amounts are taken as excluding VAT (D1).")

  /* ---- spread each year over the period ---- */
  const sorted = [...records].sort((a, b) => a.year - b.year)
  const years = sorted.map((record, i) => ({ record, prior: sorted[i - 1]?.year === record.year - 1 ? sorted[i - 1] : null, ...financialPeriod(record.year, company.ct.yearEndMonth) }))
  const amounts = new Map<string, VatLine & { amount: number }>()
  let covered = 0
  for (const y of years) {
    const start = period.start > y.start ? period.start : y.start
    const end = period.end < y.end ? period.end : y.end
    if (start > end) continue
    const overlap = daysBetween(start, end)
    const fraction = overlap / daysBetween(y.start, y.end)
    covered += overlap
    for (const line of vatLines(y.record, y.prior)) {
      const existing = amounts.get(line.id)
      if (existing) existing.amount += line.annual * fraction
      else amounts.set(line.id, { ...line, amount: line.annual * fraction })
    }
  }
  const periodDays = daysBetween(period.start, period.end)
  let coverage: VatReturn["coverage"] = covered === 0 ? "No data" : covered < periodDays ? "Partial data" : "Estimated"
  if (coverage === "Partial data") review.push(`Saved trial balances cover ${covered} of ${periodDays} days of this period. Save the missing year in Data Input or enter actual totals.`)
  if (coverage !== "No data") assumptions.push("The year's figures are spread evenly over its days; seasonal businesses should enter actual period totals.")

  // Actual period totals scale the estimate.
  const list = [...amounts.values()]
  const scale = (side: "revenue" | "expense", actual: number | null, include: (line: VatLine) => boolean) => {
    if (actual === null) return
    const estimate = list.filter((l) => l.side === side && include(l)).reduce((t, l) => t + l.amount, 0)
    if (estimate > 0) for (const l of list) if (l.side === side && include(l)) l.amount *= actual / estimate
    coverage = "Actual totals"
  }
  scale("revenue", pa.actualSales, (l) => l.scheduleKey !== "exchange")
  scale("expense", pa.actualExpenses, (l) => !["payroll", "depreciation", "exchange"].includes(l.scheduleKey))

  /* ---- classify ---- */
  const lines: LineResult[] = []
  for (const line of list) {
    const auto = classify(line, company.businessActivity, location)
    const saved = profile.heads[line.id]
    const splits = saved?.splits?.length ? saved.splits : auto.splits
    const total = splits.reduce((t, s) => t + s.percent, 0) || 100
    for (const part of splits) {
      const rule = ruleById(part.rule) ?? ruleById(line.side === "revenue" ? "STD-02" : "IN-01")!
      const amount = (line.amount * part.percent) / total
      // Output VAT on standard sales; VAT paid or self-accounted on standard and reverse-charge purchases.
      const charged = rule.treatment === "standard" || (rule.side === "expense" && ["rcServices", "rcImport", "rcDomestic"].includes(rule.treatment))
      const vat = charged ? amount * VAT_RATE : 0
      lines.push({
        id: line.id,
        name: line.name,
        side: line.side,
        amount,
        rule: rule.id,
        ruleLabel: rule.label,
        treatment: rule.treatment,
        vat,
        recoverablePercent: rule.side === "expense" ? (rule.recovery ?? 0) : 0,
        recoverable: 0,
        reason: saved ? "Set on the VAT profile." : auto.reason,
        flag: saved ? undefined : auto.flag,
        overridden: Boolean(saved),
      })
    }
    if (!saved && auto.flag) review.push(`${line.name}: ${auto.flag}`)
  }
  if (profile.taxGroup) review.push("Tax group: supplies between members of the same VAT group are out of scope (OOS-06) and the return is filed by the representative member.")

  /* ---- supplies ---- */
  const sum = (filter: (l: LineResult) => boolean, pick: (l: LineResult) => number = (l) => l.amount) => lines.filter(filter).reduce((t, l) => t + pick(l), 0)
  const standardSales = sum((l) => l.side === "revenue" && l.treatment === "standard")
  const zeroSales = sum((l) => l.side === "revenue" && l.treatment === "zero")
  const exemptSales = sum((l) => l.side === "revenue" && l.treatment === "exempt")
  const oosSales = sum((l) => l.side === "revenue" && l.treatment === "oos")
  const rcSales = sum((l) => l.side === "revenue" && l.treatment === "rcDomestic")

  /* ---- input recovery (D3/D4) ---- */
  const taxable = standardSales + zeroSales + rcSales
  const mixed = exemptSales > 0.5
  const recoveryRate = mixed ? Math.round((taxable / (taxable + exemptSales)) * 100) / 100 : null
  if (mixed)
    review.push(
      `Exempt supplies were made, so VAT on costs used for both taxable and exempt supplies is apportioned at ${Math.round((recoveryRate ?? 0) * 100)}%. The rulebook's input-tax method (D4) needs the costs attributed to each; the supply-value ratio is used as an approximation until 2028, when it becomes the legal formula.`
    )
  for (const l of lines) {
    if (l.side !== "expense") continue
    const head = profile.heads[l.id]
    const usedFor = head?.usedFor && head.usedFor !== "auto" ? head.usedFor : mixed ? "mixed" : "taxable"
    const base = l.recoverablePercent
    const share = usedFor === "taxable" ? 1 : usedFor === "exempt" ? 0 : (recoveryRate ?? 1)
    l.recoverablePercent = base * share
    l.recoverable = l.vat * l.recoverablePercent
  }

  /* ---- boxes ---- */
  const emirateShare: Record<string, number> = Object.keys(profile.emirateSplit).length ? profile.emirateSplit : { [company.emirate || "Dubai"]: 100 }
  const shareTotal = Object.values(emirateShare).reduce((t, n) => t + n, 0) || 100
  if (!answers.profile?.emirateSplit) assumptions.push(`All standard-rated sales are reported in ${company.emirate || "Dubai"} (Box 1), where the company is established.`)
  const boxEmirates: [string, string][] = [
    ["1a", "Abu Dhabi"],
    ["1b", "Dubai"],
    ["1c", "Sharjah"],
    ["1d", "Ajman"],
    ["1e", "Umm Al Quwain"],
    ["1f", "Ras Al Khaimah"],
    ["1g", "Fujairah"],
  ]
  const primary = company.emirate && emirates.includes(company.emirate as (typeof emirates)[number]) ? company.emirate : "Dubai"
  const box1 = boxEmirates.map(([box, emirate]) => {
    const amount = (standardSales * (emirateShare[emirate] ?? 0)) / shareTotal + (emirate === primary ? rcSales : 0)
    return {
      box,
      label: `Standard rated supplies in ${emirate}`,
      amount,
      vat: ((standardSales * (emirateShare[emirate] ?? 0)) / shareTotal) * VAT_RATE,
      adjustment: emirate === primary ? pa.outputAdjustment : 0,
      editable: emirate === primary ? ("outputAdjustment" as const) : undefined,
    }
  })
  const rcServices = sum((l) => l.side === "expense" && (l.treatment === "rcServices" || l.treatment === "rcDomestic"))
  const imports = sum((l) => l.side === "expense" && l.treatment === "rcImport")
  const box2 = { box: "2", label: "Tax refunds provided to tourists under the Tax Refunds for Tourists Scheme", amount: -pa.touristRefunds / VAT_RATE, vat: -pa.touristRefunds, adjustment: 0, editable: "touristRefunds" as const, vatOnly: true }
  const box3 = { box: "3", label: "Supplies subject to the reverse charge provisions", amount: rcServices, vat: rcServices * VAT_RATE, adjustment: 0 }
  const box4 = { box: "4", label: "Zero rated supplies", amount: zeroSales, vat: 0, adjustment: 0 }
  const box5 = { box: "5", label: "Exempt supplies", amount: exemptSales, vat: 0, adjustment: 0 }
  const box6 = { box: "6", label: "Goods imported into the UAE", amount: imports, vat: imports * VAT_RATE, adjustment: 0 }
  const box7 = { box: "7", label: "Adjustments to goods imported into the UAE", amount: pa.importAdjustment, vat: pa.importAdjustment * VAT_RATE, adjustment: 0, editable: "importAdjustment" as const }
  const outputRows: BoxLine[] = [...box1, box2, box3, box4, box5, box6, box7]
  const box8 = {
    box: "8",
    label: "Totals",
    amount: outputRows.reduce((t, b) => t + b.amount, 0),
    vat: outputRows.reduce((t, b) => t + b.vat, 0),
    adjustment: outputRows.reduce((t, b) => t + b.adjustment, 0),
  }
  const stdExpenses = lines.filter((l) => l.side === "expense" && l.treatment === "standard")
  const box9 = {
    box: "9",
    label: "Standard rated expenses",
    amount: stdExpenses.reduce((t, l) => t + l.amount * (l.vat ? l.recoverable / l.vat : 0), 0),
    vat: stdExpenses.reduce((t, l) => t + l.recoverable, 0),
    adjustment: pa.inputAdjustment,
    editable: "inputAdjustment" as const,
  }
  const rcLines = lines.filter((l) => l.side === "expense" && ["rcServices", "rcImport", "rcDomestic"].includes(l.treatment))
  const box10 = {
    box: "10",
    label: "Supplies subject to the reverse charge provisions",
    amount: rcLines.reduce((t, l) => t + l.amount * (l.vat ? l.recoverable / l.vat : 0), 0),
    vat: rcLines.reduce((t, l) => t + l.recoverable, 0),
    adjustment: 0,
  }
  const box11 = { box: "11", label: "Totals", amount: box9.amount + box10.amount, vat: box9.vat + box10.vat, adjustment: box9.adjustment }
  const due = box8.vat + box8.adjustment
  const recoverable = box11.vat + box11.adjustment
  const payable = due - recoverable
  const boxes: BoxLine[] = [
    ...outputRows,
    box8,
    box9,
    box10,
    box11,
    { box: "12", label: "Total value of due tax for the period", amount: due, vat: due, adjustment: 0 },
    { box: "13", label: "Total value of recoverable tax for the period", amount: recoverable, vat: recoverable, adjustment: 0 },
    { box: "14", label: payable >= 0 ? "Payable tax for the period" : "Refundable tax for the period", amount: payable, vat: payable, adjustment: 0 },
  ].map((b) => ({ ...b, amount: round2(b.amount), vat: round2(b.vat), adjustment: round2(b.adjustment) }))

  const blocked = sum((l) => l.side === "expense" && l.treatment === "standard", (l) => l.vat - l.recoverable)
  const { label: stagger, taxYearEndMonth } = staggerLabel(company)
  const money = (n: number) => `AED ${round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const commentary: string[] = []
  if (coverage === "No data") commentary.push("No trial balance covers this period, so the return cannot be estimated. Save the year in Data Input or enter actual totals.")
  else {
    commentary.push(
      `For ${formatLongDate(period.start)} to ${formatLongDate(period.end)}, estimated output VAT is ${money(box8.vat)} on standard-rated supplies of ${money(standardSales)}${rcServices || imports ? ` plus reverse-charge and import VAT of ${money((rcServices + imports) * VAT_RATE)}` : ""}. Recoverable input VAT is ${money(box11.vat)}, so ${payable >= 0 ? `${money(payable)} is payable` : `${money(-payable)} is refundable`} by ${formatLongDate(period.dueDate)} (28 days after the period end).`
    )
    if (zeroSales || exemptSales || oosSales)
      commentary.push(`Other income: zero-rated ${money(zeroSales)} (no VAT, input VAT still recoverable), exempt ${money(exemptSales)} (no VAT, related input VAT not recoverable) and outside scope ${money(oosSales)} (not reported).`)
    if (rcServices || imports)
      commentary.push(`Reverse charge: ${money(rcServices + imports)} of purchases from outside the UAE are self-accounted — 5% is declared as output (Boxes 3 and 6) and recovered as input (Box 10), so the net cost is nil when used for taxable supplies.`)
    if (blocked > 0.5) commentary.push(`${money(blocked)} of input VAT is not recoverable (blocked costs such as client entertainment, or costs used for exempt supplies).`)
    if (standardSales > 0) {
      const salesVat = box1.reduce((t, b) => t + b.vat, 0)
      commentary.push(`VAT charged on sales averages ${((salesVat / Math.max(1, standardSales + zeroSales + exemptSales)) * 100).toFixed(1)}% of all sales, and recoverable input VAT offsets ${((box11.vat / Math.max(1, box8.vat)) * 100).toFixed(0)}% of the VAT due.`)
    }
  }

  return {
    period,
    stagger,
    taxYearEnd: taxYearEnd(period.end, taxYearEndMonth),
    coverage,
    coveredDays: covered,
    location,
    lines: lines.map((l) => ({ ...l, amount: round2(l.amount), vat: round2(l.vat), recoverable: round2(l.recoverable) })),
    boxes,
    outputVat: round2(due),
    recoverableVat: round2(recoverable),
    payable: round2(payable),
    recoveryRate,
    totals: { standard: round2(standardSales), zero: round2(zeroSales), exempt: round2(exemptSales), oos: round2(oosSales), reverseCharge: round2(rcServices), imports: round2(imports) },
    commentary,
    assumptions,
    review: [...new Set(review)],
    footer: FOOTER,
  }
}

/* ------------------------------------------------------------- registration */

export type RegistrationCheck = { rule: string; result: string; taxableSupplies: number; year: number | null }

/** Registration and filing-frequency test on the latest saved year (D6). */
export function registrationCheck(company: Company, records: FinancialRecord[], answers: VatAnswers): RegistrationCheck {
  const latest = [...records].sort((a, b) => b.year - a.year)[0]
  if (!latest) return { rule: "", result: "No saved year to test.", taxableSupplies: 0, year: null }
  const prior = records.find((r) => r.year === latest.year - 1) ?? null
  const profile = vatProfileSchema.parse(answers.profile ?? {})
  const location = locationOf(company, answers.profile ?? {})
  let taxable = 0
  let zeroOnly = true
  for (const line of vatLines(latest, prior)) {
    const splits = profile.heads[line.id]?.splits ?? classify(line, company.businessActivity, location).splits
    const total = splits.reduce((t, s) => t + s.percent, 0) || 100
    for (const part of splits) {
      const rule = ruleById(part.rule)
      if (!rule) continue
      const amount = (line.annual * part.percent) / total
      if (line.side === "revenue" && (rule.treatment === "standard" || rule.treatment === "zero" || rule.treatment === "rcDomestic")) {
        taxable += amount
        if (rule.treatment !== "zero") zeroOnly = false
      }
      if (line.side === "expense" && rule.treatment === "rcImport") taxable += amount
    }
  }
  const money = `AED ${Math.round(taxable).toLocaleString("en-US")}`
  if (taxable >= 150_000_000) return { rule: "REG-06", result: `Taxable supplies of ${money} are AED 150 million or more: monthly VAT returns are required.`, taxableSupplies: taxable, year: latest.year }
  if (taxable > 375_000)
    return {
      rule: "REG-01",
      result: company.vat.trn ? `Taxable supplies of ${money} in ${latest.year} are above AED 375,000: registration is mandatory, and the company is registered.` : `Taxable supplies of ${money} in ${latest.year} are above AED 375,000: the company must register within 30 days.`,
      taxableSupplies: taxable,
      year: latest.year,
    }
  if (taxable >= 187_500)
    return { rule: "REG-02", result: `Taxable supplies of ${money} are between AED 187,500 and AED 375,000: voluntary registration is possible (J-11: watch the mandatory threshold).`, taxableSupplies: taxable, year: latest.year }
  if (taxable > 0 && zeroOnly) return { rule: "REG-04", result: "Only zero-rated supplies: an exception from registration can be requested.", taxableSupplies: taxable, year: latest.year }
  return { rule: "REG-03", result: `Taxable supplies of ${money} are below AED 187,500: registration is not possible unless the expenses test is met.`, taxableSupplies: taxable, year: latest.year }
}
