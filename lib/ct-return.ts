import { z } from "zod"
import { ctDueDate, daysBetween, financialPeriod, formatLongDate, type Company } from "./company"
import { scheduleLines, scheduleValue, type FinancialOutput, type FinancialRecord, type ScheduleKey } from "./financial-statements"

/**
 * UAE Corporate Tax return engine (Federal Decree-Law No. 47 of 2022 as amended).
 *
 * Builds the EmaraTax return step by step from the company's details, its saved trial
 * balances and the answers the user gives to the return's questions, computes taxable
 * income and the liability with explicit rules, and explains every figure. Amounts the
 * platform cannot know (dividends received, related-party adjustments, prior losses...)
 * are questions; an unanswered question is reported as an assumption, never as a fact.
 */

/* ------------------------------------------------------------------ rules */

export const CT = {
  rate: 0.09, // Art. 3(1)(b)
  zeroBand: 375_000, // Art. 3 with Cabinet Decision 116/2023
  regimeStart: "2023-06-01", // Art. 69: periods commencing on/after 1 June 2023
  sbrRevenueLimit: 3_000_000, // MD 73/2023 Art. 2
  sbrLastPeriodEnd: "2029-12-31", // MD 131/2026 amending MD 73/2023 Art. 2(3)
  entertainmentDisallowed: 0.5, // Art. 32
  lossOffsetCap: 0.75, // Art. 37(2)
  interestSafeHarbour: 12_000_000, // Art. 30 with Cabinet Decision 45/2023
  interestEbitdaShare: 0.3, // Art. 30(1)
  deMinimisShare: 0.05, // Cabinet Decision 100/2023 Art. 4
  deMinimisCap: 5_000_000,
  rpScheduleThreshold: 40_000_000, // FTA return guide: related party schedule
  connectedThreshold: 500_000,
  tpFileRevenue: 200_000_000, // MD 97/2023
  auditRevenue: 50_000_000, // MD 84/2025
  ifrsSmeRevenue: 50_000_000, // MD 114/2023
  cashBasisRevenue: 3_000_000,
} as const

/* ---------------------------------------------------------------- answers */

const amount = z.number().finite().min(-1e10).max(1e10).default(0)
const yes = z.boolean().default(false)

export const ctAnswersSchema = z.object({
  // 1. Taxpayer details
  entitySubType: z.string().max(120).default(""),
  address: z.string().max(300).default(""),
  mobile: z.string().max(40).default(""),
  email: z.string().max(120).default(""),
  freeZone: z.enum(["auto", "yes", "no"]).default("auto"),
  electStandardRegime: yes,
  qfzpConfirmed: yes,
  qualifyingRevenue: amount,
  nonQualifyingRevenue: amount,
  excludedTaxableIncome: amount,
  accountingBasis: z.enum(["accrual", "cash"]).default("accrual"),
  partnerInUnincorporated: yes,
  governmentEntity: yes,
  mneGroup: yes,
  foreignTaxResident: yes,
  ultimateParent: z.string().max(200).default(""),
  ultimateParentCountry: z.string().max(80).default("United Arab Emirates"),
  averageEmployees: amount,
  audited: yes,
  auditOpinion: z.enum(["Unqualified", "Qualified", "Adverse", "Disclaimer"]).default("Unqualified"),
  auditorName: z.string().max(200).default(""),
  // 2. Elections
  sbrElection: z.enum(["auto", "yes", "no"]).default("auto"),
  investmentPropertyDepreciation: yes,
  qualifyingGroupTransfer: yes,
  businessRestructuring: yes,
  foreignPE: yes,
  // 3. Accounting schedule detail the trial balance cannot show
  interestIncome: amount,
  fines: amount,
  donations: amount,
  donationsQualifying: amount,
  // 4. Accounting adjustments and exempt income
  equityMethodShare: amount,
  unrecycledGains: amount,
  realisationAdjustment: amount,
  transitionalAdjustment: amount,
  uaeDividends: amount,
  participatingIncome: amount,
  foreignPEIncome: amount,
  shippingIncome: amount,
  qualifyingGroupAdjustment: amount,
  restructuringAdjustment: amount,
  // 5. Other adjustments
  clientEntertainmentShare: z.number().min(0).max(100).default(100),
  nonDeductiblePension: amount,
  exemptIncomeExpenditure: amount,
  ownerDistributions: amount,
  notWhollyBusiness: amount,
  otherNonDeductible: amount,
  specificInterestDisallowed: amount,
  interestBroughtForward: amount,
  relatedParties: yes,
  relatedPartyAdjustment: amount,
  nonArmsLengthGains: yes,
  connectedPersons: yes,
  connectedPersonExcess: amount,
  qualifyingInvestmentFund: yes,
  priorPeriodError: yes,
  priorPeriodErrorAdjustment: amount,
  otherAdjustment: amount,
  otherAdjustmentNote: z.string().max(300).default(""),
  // 6. Losses and credits
  openingTaxLosses: amount,
  groupLossTransfer: yes,
  taxCredits: amount,
  estimatedFigures: yes,
  // 7. Declaration
  declarantFirstName: z.string().max(80).default(""),
  declarantLastName: z.string().max(80).default(""),
  declarantMobile: z.string().max(40).default(""),
  declarantEmail: z.string().max(120).default(""),
  preparedBy: z.enum(["Taxable Person", "Tax Agent", "Legal Representative"]).default("Taxable Person"),
})
export type CtAnswers = z.infer<typeof ctAnswersSchema>
export type CtAnswerKey = keyof CtAnswers
/** Saved answers per tax year; only what the user has set is stored. */
export type CtAnswerStore = Record<string, Partial<CtAnswers>>
export const ctAnswerStoreSchema = z
  .record(z.string().regex(/^\d{4}$/), z.record(z.string().max(60), z.union([z.string().max(300), z.number(), z.boolean()])))
  .transform((raw): CtAnswerStore => readAnswerStore(raw))
/** Reads stored answers leniently: unknown or invalid keys are dropped rather than failing the page. */
export function readAnswerStore(raw: unknown): CtAnswerStore {
  const out: CtAnswerStore = {}
  if (!raw || typeof raw !== "object") return out
  for (const [year, answers] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}$/.test(year) || !answers || typeof answers !== "object") continue
    const clean: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(answers as Record<string, unknown>)) {
      const field = (ctAnswersSchema.shape as Record<string, z.ZodTypeAny>)[key]
      if (field && field.safeParse(item).success) clean[key] = item
    }
    out[year] = clean as Partial<CtAnswers>
  }
  return out
}

/* ------------------------------------------------------------------- output */

export type FieldInput =
  | { key: CtAnswerKey; type: "boolean" }
  | { key: CtAnswerKey; type: "amount" }
  | { key: CtAnswerKey; type: "text" }
  | { key: CtAnswerKey; type: "select"; options: { value: string; label: string }[] }
export type FormRow = {
  label: string
  value?: string | number | boolean | null
  prior?: number | null
  kind?: "heading" | "total" | "note"
  input?: FieldInput
  /** Shown only when this answer is true (follow-up questions). */
  when?: CtAnswerKey
  /** Set from `when`: the follow-up question does not apply. */
  hidden?: boolean
  auto?: boolean
}
export type FormSection = { title: string; rows: FormRow[]; columns?: "amount" | "comparative" }
export type FormStep = { number: number; title: string; sections: FormSection[] }

export type Regime = "Out of scope" | "Small Business Relief" | "Qualifying Free Zone Person" | "Standard (9%)"
export type ReviewStatus = "Ready for filing review" | "Answers to confirm" | "Provisional liability" | "Not in scope"

export type CtReturn = {
  year: number
  periodStart: string
  periodEnd: string
  periodDays: number
  dueDate: string
  inScope: boolean
  scopeReason: string
  regime: Regime
  status: ReviewStatus
  freeZone: boolean
  revenue: number
  sbr: { eligible: boolean; elected: boolean; reasons: string[]; priorRevenue: { year: number; revenue: number | null }[] }
  accountingIncome: number
  summary: { no: number; label: string; amount: number; group: string }[]
  taxableBeforeLosses: number
  lossesBroughtForward: number
  lossesUsed: number
  lossesCarriedForward: number
  taxableIncome: number
  liability: number
  credits: number
  payable: number
  /** Standard-regime figures shown for comparison when SBR or QFZP applies. */
  ordinary: { taxableIncome: number; liability: number }
  steps: FormStep[]
  commentary: { title: string; paragraphs: string[] }[]
  disclosures: { item: string; status: "Required" | "Not required" | "Check"; reason: string }[]
  assumptions: string[]
  blockers: string[]
  warnings: string[]
}

/* ------------------------------------------------------------------ helpers */

const r0 = (n: number) => Math.round(n) || 0
const money = (n: number) => `AED ${Math.round(n).toLocaleString("en-US")}`
const value = (s: FinancialOutput | null, key: ScheduleKey) => (s ? scheduleValue(s, key) : 0)
const bs = (s: FinancialOutput | null, row: number) => (s ? (s.bs.find((line) => line.row === row)?.amount ?? 0) : 0)

const FREE_ZONE =
  /free ?zone|\bFZ|freezone|\b(DMCC|JAFZA|DAFZA|RAKEZ|DIEZA|IFZA|DWTC|ADGM|DIFC|KEZAD|KIZAD|SAIF|SHAMS|SPC|AFZ|UAQ FTZ|FTZ|DSO)\b|meydan|silicon oasis|hamriyah|creative city|twofour54|masdar|dubai south|science park|media city|internet city|knowledge park|healthcare city|studio city|maritime city|world trade cent/i
export function isFreeZone(company: Pick<Company, "authority" | "legalForm" | "name">) {
  const mainland = /department of econom|economic development|\bDED\b|\bDET\b|municipality/i
  if (mainland.test(company.authority)) return false
  return FREE_ZONE.test(company.authority) || /\b(FZE|FZCO|FZ-?LLC|FZC)\b/i.test(`${company.legalForm} ${company.name}`)
}

export function entitySubType(legalForm: string) {
  if (/public joint stock|pjsc/i.test(legalForm)) return "UAE Public Joint Stock Company"
  if (/branch/i.test(legalForm)) return "Branch of a Foreign Company"
  if (/partnership|partner/i.test(legalForm)) return "UAE Partnership"
  return "UAE Private Company (Incl. an Establishment)"
}

/** Revenue for Small Business Relief and threshold tests: all accounting income. */
function revenueOf(s: FinancialOutput) {
  const fxGain = Math.max(0, -value(s, "exchange"))
  return value(s, "sales") + value(s, "otherIncome") + fxGain
}

function periodFor(company: Company, year: number) {
  const period = financialPeriod(year, company.ct.yearEndMonth)
  const first = company.ct.firstPeriodStart
  // A first tax period can start part-way through the financial year.
  if (first && first > period.start && first <= period.end) return { start: first, end: period.end }
  return period
}

function inScopeOf(company: Company, start: string, end: string) {
  if (start < CT.regimeStart) return { inScope: false, reason: `The period began before 1 June 2023, so it is outside UAE corporate tax (Art. 69).` }
  if (company.ct.firstPeriodStart && end < company.ct.firstPeriodStart)
    return { inScope: false, reason: `The period ends before the first tax period on the CT registration (${formatLongDate(company.ct.firstPeriodStart)}).` }
  return { inScope: true, reason: "" }
}

/* --------------------------------------------------------------- the engine */

type Carry = { losses: number; interest: number }

/** Every saved year, oldest first, so losses carry from one return to the next. */
export function ctReturns(company: Company, records: FinancialRecord[], store: CtAnswerStore = {}): CtReturn[] {
  const sorted = [...records].sort((a, b) => a.year - b.year)
  const carry: Carry = { losses: 0, interest: 0 }
  const out: CtReturn[] = []
  for (const record of sorted) out.push(buildCtReturn(company, sorted, record.year, store[String(record.year)] ?? {}, carry))
  return out
}

export function buildCtReturn(
  company: Company,
  records: FinancialRecord[],
  year: number,
  saved: Partial<CtAnswers>,
  carry: Carry = { losses: 0, interest: 0 }
): CtReturn {
  const answers = ctAnswersSchema.parse(saved)
  const record = records.find((item) => item.year === year)
  if (!record) throw new Error(`No saved data for ${year}.`)
  const prior = records.find((item) => item.year === year - 1) ?? null
  const s = record.statements
  const p = prior?.statements ?? null
  const { start, end } = periodFor(company, year)
  const days = daysBetween(start, end)
  const scope = inScopeOf(company, start, end)
  const warnings: string[] = []
  const blockers: string[] = []
  const assumptions: string[] = []
  const assume = (key: CtAnswerKey, text: string) => {
    if (!(key in saved)) assumptions.push(text)
  }

  /* ---- taxpayer classification ---- */
  const freeZone = answers.freeZone === "auto" ? isFreeZone(company) : answers.freeZone === "yes"
  if (answers.freeZone === "auto")
    assumptions.push(
      freeZone
        ? `Treated as a Free Zone Person because the licensing authority is "${company.authority || company.legalForm}". Confirm on the Taxpayer Details step.`
        : `Treated as a mainland company because the licensing authority is "${company.authority || "not recorded"}". Confirm on the Taxpayer Details step.`
    )
  const revenue = revenueOf(s)

  /* ---- accounting schedules (EmaraTax step 3) ---- */
  const financeRows = (record.closingRows ?? record.rows).filter((row) => row.scheduleKey === "finance")
  const interestExpense = financeRows.filter((row) => /interest|loan|finance cost|profit on|murabaha|lease/i.test(row.ledgerName)).reduce((t, row) => t + row.amount, 0)
  const bankCharges = value(s, "finance") - interestExpense
  const adminTotal = scheduleLines.filter((line) => line.note === 18).reduce((t, line) => t + value(s, line.key), 0)
  const salaries = value(s, "payroll") + value(s, "medical")
  const depreciation = value(s, "depreciation")
  const entertainment = value(s, "entertainment")
  const fines = answers.fines
  const donations = answers.donations
  const otherExpenses = adminTotal - salaries - depreciation - entertainment - fines - donations + bankCharges
  if (otherExpenses < -0.5) warnings.push("Fines and donations entered are more than the other expenses in the trial balance. Check the amounts.")
  const nonOperating = salaries + depreciation + fines + donations + entertainment + otherExpenses
  const dividendsReceived = answers.uaeDividends + Math.max(0, answers.participatingIncome)
  const interestIncome = answers.interestIncome
  const otherNonOperating = value(s, "otherIncome") - dividendsReceived - interestIncome
  if (otherNonOperating < -0.5) warnings.push("Dividends and interest income entered exceed Other Income in the trial balance. Record them in the trial balance first.")
  const fx = value(s, "exchange")
  const gross = value(s, "sales") - value(s, "costOfSales")
  const netProfit = s.netProfit
  const rebuilt = gross - nonOperating + dividendsReceived + otherNonOperating + (interestIncome - interestExpense) - fx
  if (Math.abs(rebuilt - netProfit) >= 1) warnings.push(`The accounting schedule does not agree to net profit by ${money(rebuilt - netProfit)}.`)
  const pFin = p ? value(p, "finance") : 0
  const priorAdmin = p ? scheduleLines.filter((line) => line.note === 18).reduce((t, line) => t + value(p, line.key), 0) : 0
  const ebitda = netProfit + depreciation + interestExpense - interestIncome
  const priorEbitda = p ? p.netProfit + value(p, "depreciation") : null

  /* ---- adjustments (EmaraTax steps 4 and 5) ---- */
  const accountingIncome = netProfit
  const L = {
    equity: -answers.equityMethodShare,
    partnerships: 0,
    partnershipDisposal: 0,
    unrecycled: answers.unrecycledGains,
    realisation: answers.realisationAdjustment,
    transitional: answers.transitionalAdjustment,
    uaeDividends: -answers.uaeDividends,
    participating: -answers.participatingIncome,
    foreignPE: -answers.foreignPEIncome,
    shipping: -answers.shippingIncome,
    groupTransfer: answers.qualifyingGroupAdjustment,
    restructuring: answers.restructuringAdjustment,
  }
  const entertainmentAddBack = entertainment * (answers.clientEntertainmentShare / 100) * CT.entertainmentDisallowed
  const donationsAddBack = Math.max(0, donations - answers.donationsQualifying)
  const nonDeductible =
    entertainmentAddBack +
    answers.nonDeductiblePension +
    donationsAddBack +
    answers.exemptIncomeExpenditure +
    answers.ownerDistributions +
    answers.notWhollyBusiness +
    fines +
    answers.otherNonDeductible

  // Net interest: general limitation (Art. 30) after the specific rule (Art. 31).
  const netInterest = interestExpense - interestIncome
  const safeHarbour = (CT.interestSafeHarbour * days) / 365
  const preInterest =
    accountingIncome + Object.values(L).reduce((t, n) => t + n, 0) + nonDeductible + answers.specificInterestDisallowed
  const taxEbitda = preInterest + Math.max(0, netInterest - answers.specificInterestDisallowed) + depreciation
  const allowance = Math.max(safeHarbour, CT.interestEbitdaShare * Math.max(0, taxEbitda))
  const deductibleInterest = Math.max(0, netInterest - answers.specificInterestDisallowed)
  const generalDisallowed = netInterest > safeHarbour ? Math.max(0, deductibleInterest - allowance) : 0
  const headroom = Math.max(0, allowance - deductibleInterest)
  const interestBf = carry.interest + answers.interestBroughtForward
  const interestUsed = Math.min(interestBf, headroom)
  const interestAdjustment = answers.specificInterestDisallowed + generalDisallowed - interestUsed

  const rpAdjustment = answers.relatedPartyAdjustment + answers.connectedPersonExcess
  const otherAdj = answers.priorPeriodErrorAdjustment + answers.otherAdjustment
  const taxableBeforeLosses =
    accountingIncome + Object.values(L).reduce((t, n) => t + n, 0) + nonDeductible + interestAdjustment + rpAdjustment + otherAdj

  /* ---- Small Business Relief ---- */
  const priorScoped = records
    .filter((item) => item.year < year)
    .filter((item) => {
      const pp = periodFor(company, item.year)
      return inScopeOf(company, pp.start, pp.end).inScope
    })
  const priorRevenue = priorScoped.map((item) => ({ year: item.year, revenue: revenueOf(item.statements) }))
  // Missing saved years between the first CT period and this one cannot be tested.
  const firstScopedYear = Math.min(year, ...priorScoped.map((item) => item.year))
  const gaps: number[] = []
  for (let y = firstScopedYear; y < year; y++) if (!records.some((item) => item.year === y)) gaps.push(y)
  const sbrReasons: string[] = []
  const qfzpCandidate = freeZone && !answers.electStandardRegime
  if (revenue > CT.sbrRevenueLimit) sbrReasons.push(`revenue of ${money(revenue)} is above AED 3,000,000`)
  const breach = priorRevenue.find((item) => item.revenue > CT.sbrRevenueLimit)
  if (breach) sbrReasons.push(`revenue in ${breach.year} (${money(breach.revenue)}) was above AED 3,000,000, and a breach in any earlier tax period ends eligibility`)
  if (end > CT.sbrLastPeriodEnd) sbrReasons.push("the relief is only available for tax periods ending on or before 31 December 2029")
  if (qfzpCandidate && answers.qfzpConfirmed) sbrReasons.push("a Qualifying Free Zone Person cannot elect Small Business Relief")
  if (answers.mneGroup) sbrReasons.push("members of large multinational groups cannot elect the relief")
  const sbrEligible = scope.inScope && sbrReasons.length === 0
  if (sbrEligible && gaps.length)
    warnings.push(`Revenue for ${gaps.join(", ")} is not saved, so the earlier-period revenue test for Small Business Relief is not fully verified.`)
  const sbrElected = sbrEligible && answers.sbrElection !== "no"
  if (sbrEligible && answers.sbrElection === "auto")
    assumptions.push("Small Business Relief is assumed to be elected because the company is eligible. Change this on the Elections step if you do not want to elect it.")

  /* ---- regime and liability ---- */
  let regime: Regime = scope.inScope ? "Standard (9%)" : "Out of scope"
  if (scope.inScope && sbrElected) regime = "Small Business Relief"

  // Standard computation (also shown for comparison).
  // Opening losses are entered once, on the year they were first available.
  const lossesAvailable = scope.inScope ? carry.losses + Math.max(0, answers.openingTaxLosses) : carry.losses
  const lossesUsedStd = taxableBeforeLosses > 0 ? Math.min(lossesAvailable, taxableBeforeLosses * CT.lossOffsetCap) : 0
  const taxableStd = taxableBeforeLosses - lossesUsedStd
  const liabilityStd = Math.max(0, taxableStd - CT.zeroBand) * CT.rate

  let lossesUsed = 0
  let taxableIncome = 0
  let liability = 0
  let lossesCarried = lossesAvailable
  const qfzpNotes: string[] = []
  if (regime === "Standard (9%)" && qfzpCandidate) {
    if (!answers.qfzpConfirmed) {
      blockers.push(
        "Free Zone status: confirm whether the company meets every Qualifying Free Zone Person condition (adequate substance, qualifying income, audited accounts, arm's-length pricing, no standard-regime election). Until then the 9% standard regime is used."
      )
    } else {
      const total = answers.qualifyingRevenue + answers.nonQualifyingRevenue
      const limit = Math.min(CT.deMinimisShare * total, CT.deMinimisCap)
      if (total <= 0) blockers.push("Enter the qualifying and non-qualifying revenue split to apply the Qualifying Free Zone Person regime.")
      else if (answers.nonQualifyingRevenue > limit) {
        warnings.push(
          `Non-qualifying revenue of ${money(answers.nonQualifyingRevenue)} exceeds the de minimis limit of ${money(limit)} (lower of 5% of revenue and AED 5 million). The company ceases to be a Qualifying Free Zone Person for this period and the following four tax periods (Art. 18-19, Cabinet Decision 100/2023), so the standard regime applies.`
        )
      } else {
        if (!answers.audited) blockers.push("A Qualifying Free Zone Person must prepare audited financial statements (MD 84/2025). Confirm the audit on the Taxpayer Details step.")
        regime = "Qualifying Free Zone Person"
        qfzpNotes.push(
          `Non-qualifying revenue (${money(answers.nonQualifyingRevenue)}) is within the de minimis limit of ${money(limit)}, so qualifying income is taxed at 0%.`
        )
      }
    }
  }
  if (regime === "Standard (9%)") {
    lossesUsed = lossesUsedStd
    taxableIncome = taxableStd
    liability = liabilityStd
    lossesCarried = lossesAvailable - lossesUsed + (taxableBeforeLosses < 0 ? -taxableBeforeLosses : 0)
  } else if (regime === "Qualifying Free Zone Person") {
    // 0% on qualifying income; 9% on excluded/non-qualifying taxable income without the AED 375,000 band.
    taxableIncome = Math.max(0, taxableBeforeLosses)
    liability = Math.max(0, answers.excludedTaxableIncome) * CT.rate
    lossesCarried = lossesAvailable
  } else if (regime === "Small Business Relief") {
    // Treated as having no taxable income; no new losses arise, existing losses are kept.
    taxableIncome = 0
    liability = 0
    lossesCarried = lossesAvailable
  }
  if (!scope.inScope) lossesCarried = carry.losses
  const credits = Math.min(Math.max(0, answers.taxCredits), liability)
  const payable = liability - credits
  carry.losses = Math.max(0, lossesCarried)
  carry.interest = Math.max(0, interestBf - interestUsed + generalDisallowed)

  /* ---- assumptions for unanswered questions ---- */
  assume("audited", "Financial statements are treated as not audited.")
  assume("uaeDividends", "No dividends from UAE resident companies were received.")
  assume("relatedParties", "No transactions with related parties were reported.")
  assume("connectedPersons", "No payments to connected persons (owners, directors, their relatives) were reported.")
  if (entertainment) assume("clientEntertainmentShare", `All entertainment (${money(entertainment)}) is treated as client entertainment, 50% non-deductible.`)
  assume("openingTaxLosses", "No tax losses from before the first year saved in FinScope.")
  assume("averageEmployees", "Average number of employees is not entered.")

  /* ---- FTA tax summary (26 lines) ---- */
  const sbr = regime === "Small Business Relief"
  const z = (n: number) => (sbr ? 0 : r0(n))
  const summary: CtReturn["summary"] = [
    { no: 1, group: "Accounting Income", label: "Accounting Income for the Tax Period", amount: z(accountingIncome) },
    { no: 2, group: "Accounting Adjustments", label: "Share of profits / (losses) relating to investments accounted for under the Equity Method of Accounting", amount: z(L.equity) },
    { no: 3, group: "Accounting Adjustments", label: "Accounting net profits / (losses) derived from Unincorporated Partnerships", amount: 0 },
    { no: 4, group: "Accounting Adjustments", label: "Gains / (losses) on the disposal of an interest in an Unincorporated Partnership which meets the conditions of the Participation Exemption", amount: 0 },
    { no: 5, group: "Accounting Adjustments", label: "Gains / (losses) reported in the Financial Statements that would not subsequently be recognised in the income statement", amount: z(L.unrecycled) },
    { no: 6, group: "Accounting Adjustments", label: "Realisation basis adjustments", amount: z(L.realisation) },
    { no: 7, group: "Accounting Adjustments", label: "Transitional adjustments", amount: z(L.transitional) },
    { no: 8, group: "Exempt Income", label: "Dividends and profit distributions received from UAE Resident Persons", amount: z(L.uaeDividends) },
    { no: 9, group: "Exempt Income", label: "Income / (losses) from Participating Interests", amount: z(L.participating) },
    { no: 10, group: "Exempt Income", label: "Taxable Income / (Tax Losses) from Foreign Permanent Establishments", amount: z(L.foreignPE) },
    { no: 11, group: "Exempt Income", label: "Income / (losses) from international aircraft / shipping", amount: z(L.shipping) },
    { no: 12, group: "Reliefs", label: "Adjustments arising from transfers within a Qualifying Group", amount: z(L.groupTransfer) },
    { no: 13, group: "Reliefs", label: "Adjustments arising from Business Restructuring Relief", amount: z(L.restructuring) },
    { no: 14, group: "Non-deductible Expenditure", label: "Adjustments for non-deductible expenditure", amount: z(nonDeductible) },
    { no: 15, group: "Non-deductible Expenditure", label: "Adjustments for Interest expenditure", amount: z(interestAdjustment) },
    { no: 16, group: "Other adjustments", label: "Adjustments for transactions with Related Parties and Connected Persons", amount: z(rpAdjustment) },
    { no: 17, group: "Other adjustments", label: "Adjustments for income and expenditure derived from Qualifying Investment Funds", amount: 0 },
    { no: 18, group: "Other adjustments", label: "Other adjustments", amount: z(otherAdj) },
    { no: 19, group: "Tax Liability and Tax Credits", label: "Taxable Income / (Tax Loss) before any Tax Loss adjustments", amount: z(taxableBeforeLosses) },
    { no: 20, group: "Tax Liability and Tax Credits", label: "Tax Losses utilised in the current tax Period", amount: z(lossesUsed) },
    { no: 21, group: "Tax Liability and Tax Credits", label: "Tax Losses claimed from other group entities", amount: 0 },
    { no: 22, group: "Tax Liability and Tax Credits", label: "Pre-Grouping Tax Losses", amount: 0 },
    { no: 23, group: "Tax Liability and Tax Credits", label: "Taxable Income / (Tax Loss) for the Tax Period", amount: sbr ? 0 : r0(regime === "Standard (9%)" ? taxableIncome : taxableBeforeLosses) },
    { no: 24, group: "Tax Liability and Tax Credits", label: "Corporate Tax Liability", amount: r0(liability) },
    { no: 25, group: "Tax Liability and Tax Credits", label: "Tax Credits", amount: r0(credits) },
    { no: 26, group: "Tax Liability and Tax Credits", label: "Corporate Tax Payable", amount: r0(payable) },
  ]

  /* ---- return steps ---- */
  const b = (key: CtAnswerKey): FieldInput => ({ key, type: "boolean" })
  const a = (key: CtAnswerKey): FieldInput => ({ key, type: "amount" })
  const t = (key: CtAnswerKey): FieldInput => ({ key, type: "text" })
  const cmp = (label: string, current: number, priorValue: number | null, kind?: FormRow["kind"]): FormRow => ({
    label,
    value: z(current),
    prior: sbr ? 0 : priorValue === null ? null : r0(priorValue),
    kind,
    auto: true,
  })
  const partnerNames = company.partners.map((partner) => partner.name).join(", ")
  const activities = company.businessActivity.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
  const steps: FormStep[] = [
    {
      number: 1,
      title: "Taxpayer Details",
      sections: [
        {
          title: "Taxpayer Details",
          rows: [
            { label: "TRN", value: company.ct.trn || "Not registered", auto: true },
            { label: "Taxable Person Name in English", value: company.name, auto: true },
            { label: "Entity Type", value: "Legal Person - Incorporated", auto: true },
            { label: "Entity Sub-Type", value: answers.entitySubType || entitySubType(company.legalForm), input: t("entitySubType") },
            { label: "Primary Business", value: activities[0] ?? "", auto: true },
          ],
        },
        {
          title: "Address Details",
          rows: [
            { label: "Address", value: answers.address, input: t("address") },
            { label: "Emirate", value: company.emirate, auto: true },
            { label: "Mobile Number", value: answers.mobile, input: t("mobile") },
            { label: "Email ID", value: answers.email, input: t("email") },
          ],
        },
        {
          title: "Taxable Person Information",
          rows: [
            { label: "Is the Taxable Person a partner in one or more Unincorporated Partnerships?", value: answers.partnerInUnincorporated, input: b("partnerInUnincorporated") },
            { label: "Is the Tax Return being completed by a Government Entity, Government Controlled Entity, Extractive Business or Non-Extractive Natural Resource Business?", value: answers.governmentEntity, input: b("governmentEntity") },
            { label: "What is the Taxable Person's Revenue derived during the Tax Period? (AED)", value: r0(revenue), auto: true },
            {
              label: "Has the Taxable Person's Financial Statements been prepared under the cash or accrual basis?",
              value: answers.accountingBasis === "cash" ? "Cash" : "Accrual",
              input: { key: "accountingBasis", type: "select", options: [{ value: "accrual", label: "Accrual" }, { value: "cash", label: "Cash" }] },
            },
            { label: "Does the Taxable Person conduct more than one Business or Business Activity?", value: activities.length > 1, auto: true },
            { label: "How many Businesses or Business Activities does the Taxable Person conduct?", value: Math.max(1, activities.length), auto: true },
            { label: "Business activities (as per the registration data)", value: company.businessActivity, auto: true },
            { label: "Is the Taxable Person a member of a Multinational Enterprise Group?", value: answers.mneGroup, input: b("mneGroup") },
            { label: "Is the Taxable Person incorporated or otherwise established or recognised under the laws of the UAE or under the laws of a Free Zone?", value: true, auto: true },
            { label: "Is the Taxable Person tax resident in a foreign jurisdiction under an applicable Double Taxation Agreement?", value: answers.foreignTaxResident, input: b("foreignTaxResident") },
          ],
        },
        {
          title: "Free Zones",
          rows: [
            {
              label: "Is the taxpayer incorporated, established, or otherwise registered in a Free Zone?",
              value: freeZone,
              input: { key: "freeZone", type: "select", options: [{ value: "auto", label: `Automatic (${isFreeZone(company) ? "Yes" : "No"})` }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
            },
            ...(freeZone
              ? [
                  { label: "Is the Taxable Person making an election to be subject to Corporate Tax under the standard Corporate Tax regime?", value: answers.electStandardRegime, input: b("electStandardRegime") },
                  ...(!answers.electStandardRegime
                    ? [
                        { label: "Does the company meet all Qualifying Free Zone Person conditions (substance, qualifying income, audited accounts, arm's length, transfer pricing documentation)?", value: answers.qfzpConfirmed, input: b("qfzpConfirmed") },
                        { label: "Qualifying revenue (AED)", value: answers.qualifyingRevenue, input: a("qualifyingRevenue"), when: "qfzpConfirmed" as CtAnswerKey },
                        { label: "Non-qualifying revenue (AED)", value: answers.nonQualifyingRevenue, input: a("nonQualifyingRevenue"), when: "qfzpConfirmed" as CtAnswerKey },
                        { label: "Taxable income from excluded activities / domestic PE / mainland immovable property, taxed at 9% (AED)", value: answers.excludedTaxableIncome, input: a("excludedTaxableIncome"), when: "qfzpConfirmed" as CtAnswerKey },
                      ]
                    : []),
                ]
              : []),
          ],
        },
        {
          title: "Shareholding Details",
          rows: [
            { label: "Shareholders (from the MOA)", value: partnerNames, auto: true },
            { label: "Name of the ultimate parent company of the Taxable Person", value: answers.ultimateParent || "N/A", input: t("ultimateParent") },
            { label: "Country of tax residency of the ultimate parent company", value: answers.ultimateParentCountry, input: t("ultimateParentCountry") },
          ],
        },
      ],
    },
    {
      number: 2,
      title: "Elections",
      sections: [
        {
          title: "Elections",
          rows: [
            { label: "Would the Taxable Person like to elect to apply depreciation adjustments on investment properties held at fair value?", value: answers.investmentPropertyDepreciation, input: b("investmentPropertyDepreciation") },
          ],
        },
        {
          title: "Small Business Relief",
          rows: [
            { label: "Revenue in the Tax Period (AED)", value: r0(revenue), auto: true },
            ...(sbrEligible
              ? [
                  {
                    label: "Would the Taxable Person like to make an election for Small Business Relief?",
                    value: sbrElected,
                    input: { key: "sbrElection", type: "select", options: [{ value: "auto", label: "Yes (recommended)" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }] } as FieldInput,
                  },
                ]
              : [{ label: "Small Business Relief", value: `Not available: ${sbrReasons.join("; ")}`, kind: "note" as const }]),
          ],
        },
        ...(sbr
          ? []
          : [
              {
                title: "Transfers within a Qualifying Group",
                rows: [{ label: "Did the Taxable Person transfer any assets or liabilities to a member of the same Qualifying Group during the Tax Period?", value: answers.qualifyingGroupTransfer, input: b("qualifyingGroupTransfer") }],
              },
              {
                title: "Business Restructuring Relief",
                rows: [{ label: "Did the Taxable Person transfer a Business or an independent part of a Business during the Tax Period under which Business Restructuring Relief may apply?", value: answers.businessRestructuring, input: b("businessRestructuring") }],
              },
              {
                title: "Foreign Permanent Establishment Income",
                rows: [{ label: "Does the Taxable Person have any Foreign Permanent Establishments?", value: answers.foreignPE, input: b("foreignPE") }],
              },
            ]),
      ],
    },
    {
      number: 3,
      title: "Accounting Schedules",
      sections: [
        {
          title: "Statement of Profit or Loss",
          columns: "comparative",
          rows: [
            cmp("Operating Revenue (AED)", value(s, "sales"), p ? value(p, "sales") : null),
            cmp("Expenditure incurred in deriving operating revenue (AED)", value(s, "costOfSales"), p ? value(p, "costOfSales") : null),
            cmp("Gross Profit / Loss (AED)", gross, p ? value(p, "sales") - value(p, "costOfSales") : null, "total"),
            { label: "Non-operating Expense", kind: "heading" },
            cmp("Salaries, wages and related charges (AED)", salaries, p ? value(p, "payroll") + value(p, "medical") : null),
            cmp("Depreciation and amortisation (AED)", depreciation, p ? value(p, "depreciation") : null),
            { ...cmp("Fines and penalties (AED)", fines, p ? 0 : null), input: a("fines"), auto: false },
            { ...cmp("Donations (AED)", donations, p ? 0 : null), input: a("donations"), auto: false },
            cmp("Client entertainment expenses (AED)", entertainment, p ? value(p, "entertainment") : null),
            cmp("Other expenses (AED)", otherExpenses, p ? priorAdmin - value(p, "payroll") - value(p, "medical") - value(p, "depreciation") - value(p, "entertainment") + pFin : null),
            cmp("Non-operating expenses (Excluding other items listed below) (AED)", nonOperating, p ? priorAdmin + pFin : null, "total"),
            { label: "Non-operating Revenue", kind: "heading" },
            cmp("Dividends received (AED)", dividendsReceived, p ? 0 : null),
            cmp("Other non-operating revenue (AED)", otherNonOperating, p ? value(p, "otherIncome") : null),
            { label: "Other Items", kind: "heading" },
            { ...cmp("Interest Income (AED)", interestIncome, p ? 0 : null), input: a("interestIncome"), auto: false },
            cmp("Interest Expenditure (AED)", interestExpense, p ? 0 : null),
            cmp("Net Interest Income / (Expense) (AED)", interestIncome - interestExpense, p ? 0 : null, "total"),
            cmp("Gains on Disposal of Assets (AED)", 0, p ? 0 : null),
            cmp("Losses on Disposal of Assets (AED)", 0, p ? 0 : null),
            cmp("Net gains / (losses) on disposal of assets (AED)", 0, p ? 0 : null, "total"),
            cmp("Foreign exchange gains (AED)", Math.max(0, -fx), p ? Math.max(0, -value(p, "exchange")) : null),
            cmp("Foreign exchange losses (AED)", Math.max(0, fx), p ? Math.max(0, value(p, "exchange")) : null),
            cmp("Net Gains / (losses) on foreign exchange (AED)", -fx, p ? -value(p, "exchange") : null, "total"),
            cmp("Net profit / (loss) (AED)", netProfit, p ? p.netProfit : null, "total"),
          ],
        },
        {
          title: "Statement of Other Comprehensive Income",
          columns: "comparative",
          rows: [
            cmp("Income that will not be reclassified to the income statement (AED)", 0, p ? 0 : null),
            cmp("Losses that will not be reclassified to the income statement (AED)", 0, p ? 0 : null),
            cmp("Income that may be reclassified to the income statement (AED)", 0, p ? 0 : null),
            cmp("Losses that may be reclassified to the income statement (AED)", 0, p ? 0 : null),
            cmp("Other income reported in other comprehensive income for the year, net of tax (AED)", 0, p ? 0 : null),
            cmp("Other losses reported in other comprehensive income for the year, net of tax (AED)", 0, p ? 0 : null),
            cmp("Total comprehensive income for the year (AED)", netProfit, p ? p.netProfit : null, "total"),
          ],
        },
        {
          title: "Statement of Financial Position",
          columns: "comparative",
          rows: [
            cmp("Total current assets (AED)", bs(s, 22), p ? bs(p, 22) : null),
            { label: "Non-current Assets", kind: "heading" },
            cmp("Property, plant and equipment (AED)", bs(s, 11), p ? bs(p, 11) : null),
            cmp("Intangible assets (AED)", 0, p ? 0 : null),
            cmp("Financial assets (AED)", bs(s, 12), p ? bs(p, 12) : null),
            cmp("Other non-current assets (AED)", 0, p ? 0 : null),
            cmp("Total non-current assets (AED)", bs(s, 13), p ? bs(p, 13) : null, "total"),
            cmp("Total assets (AED)", bs(s, 25), p ? bs(p, 25) : null, "total"),
            { label: "Liabilities", kind: "heading" },
            cmp("Total current liabilities (AED)", bs(s, 42), p ? bs(p, 42) : null),
            cmp("Total non-current liabilities (AED)", bs(s, 34), p ? bs(p, 34) : null),
            cmp("Total liabilities (AED)", bs(s, 42) + bs(s, 34), p ? bs(p, 42) + bs(p, 34) : null, "total"),
            { label: "Equity", kind: "heading" },
            cmp("Share capital (AED)", bs(s, 46), p ? bs(p, 46) : null),
            cmp("Retained earnings (AED)", bs(s, 47) + bs(s, 48), p ? bs(p, 47) + bs(p, 48) : null),
            cmp("Other equity (AED)", bs(s, 49), p ? bs(p, 49) : null),
            cmp("Total equity (AED)", bs(s, 50), p ? bs(p, 50) : null, "total"),
            cmp("Total equity and liabilities (AED)", bs(s, 52), p ? bs(p, 52) : null, "total"),
            { label: "Average number of employees during the Tax Period", value: answers.averageEmployees, input: a("averageEmployees") },
            cmp("Earnings Before Interest, Tax, Depreciation and Amortisation (EBITDA) (AED)", ebitda, priorEbitda, "total"),
          ],
        },
        {
          title: "Audit",
          rows: [
            { label: "Have the Financial Statements been audited?", value: answers.audited, input: b("audited") },
            {
              label: "What was the audit opinion?",
              value: answers.auditOpinion,
              when: "audited",
              input: { key: "auditOpinion", type: "select", options: ["Unqualified", "Qualified", "Adverse", "Disclaimer"].map((v) => ({ value: v, label: v })) },
            },
            { label: "What is the name of the auditor?", value: answers.auditorName, when: "audited", input: t("auditorName") },
          ],
        },
      ],
    },
    {
      number: 4,
      title: "Accounting Adjustments and Exempt Income",
      sections: [
        {
          title: "Accounting Income",
          columns: "amount",
          rows: [
            { label: "Accounting Income for the Tax Period (AED)", value: z(accountingIncome), auto: true },
            { label: "Share of profits / (losses) from investments accounted for under the Equity Method included above (AED)", value: answers.equityMethodShare, input: a("equityMethodShare") },
            { label: "Gains / (losses) in the Financial Statements that will not subsequently be recognised in the Income Statement (AED)", value: answers.unrecycledGains, input: a("unrecycledGains") },
            { label: "Realisation basis adjustment (AED)", value: answers.realisationAdjustment, input: a("realisationAdjustment") },
          ],
        },
        {
          title: "Transitional Adjustments",
          columns: "amount",
          rows: [{ label: "Transitional adjustment for Qualifying Immovable Property, Intangible Assets, Financial Assets or Liabilities (AED)", value: answers.transitionalAdjustment, input: a("transitionalAdjustment") }],
        },
        {
          title: "Exempt Income",
          columns: "amount",
          rows: [
            { label: "Dividends or profit distributions received from UAE Resident Persons, included in income (AED)", value: answers.uaeDividends, input: a("uaeDividends") },
            { label: "Income / (losses) from Participating Interests (AED)", value: answers.participatingIncome, input: a("participatingIncome") },
            { label: "Income / (losses) from Foreign Permanent Establishments (elected exemption) (AED)", value: answers.foreignPEIncome, input: a("foreignPEIncome"), when: "foreignPE" },
            { label: "Income from international aircraft / shipping (AED)", value: answers.shippingIncome, input: a("shippingIncome") },
            { label: "Adjustments from transfers within a Qualifying Group (AED)", value: answers.qualifyingGroupAdjustment, input: a("qualifyingGroupAdjustment"), when: "qualifyingGroupTransfer" },
            { label: "Adjustments from Business Restructuring Relief (AED)", value: answers.restructuringAdjustment, input: a("restructuringAdjustment"), when: "businessRestructuring" },
          ],
        },
      ],
    },
    {
      number: 5,
      title: "Other Adjustments",
      sections: [
        {
          title: "Adjustments for Non-deductible Expenditure",
          columns: "amount",
          rows: [
            { label: `Share of entertainment that is for clients, suppliers or shareholders (%) — entertainment in the accounts ${money(entertainment)}`, value: answers.clientEntertainmentShare, input: a("clientEntertainmentShare") },
            { label: "Non-deductible Entertainment expenditure (AED)", value: z(entertainmentAddBack), auto: true },
            { label: "Non-deductible Pension contributions (AED)", value: answers.nonDeductiblePension, input: a("nonDeductiblePension") },
            { label: "Donations to Qualifying Public Benefit Entities (deductible) (AED)", value: answers.donationsQualifying, input: a("donationsQualifying") },
            { label: "Charitable donations made to entities that are not Qualifying Public Benefit Entities (AED)", value: z(donationsAddBack), auto: true },
            { label: "Fines and penalties (non-deductible, from the Accounting Schedules) (AED)", value: z(fines), auto: true },
            { label: "Expenditure incurred in deriving Exempt Income other than interest expenditure (AED)", value: answers.exemptIncomeExpenditure, input: a("exemptIncomeExpenditure") },
            { label: "Dividends, profit distributions or benefits of a similar nature paid to an owner of the Taxable Person (AED)", value: answers.ownerDistributions, input: a("ownerDistributions") },
            { label: "Expenses not wholly and exclusively incurred for the purpose of the Business (AED)", value: answers.notWhollyBusiness, input: a("notWhollyBusiness") },
            { label: "Other non-deductible expenditure (AED)", value: answers.otherNonDeductible, input: a("otherNonDeductible") },
            { label: "Total non-deductible expenditure (AED)", value: z(nonDeductible), kind: "total", auto: true },
          ],
        },
        {
          title: "Adjustments for Interest Income / Expenditure",
          columns: "amount",
          rows: [
            { label: "Has the Taxable Person incurred Net Interest Expenditure in the current Tax Period which together with any Net Interest Expenditure carried forward exceeds AED 12 million?", value: netInterest + interestBf > CT.interestSafeHarbour, auto: true },
            { label: "Net interest expenditure for the period (AED)", value: z(netInterest), auto: true },
            { label: "Amounts which are non-deductible as a result of the Specific Interest Deduction Limitation Rule (AED)", value: answers.specificInterestDisallowed, input: a("specificInterestDisallowed") },
            { label: "Net interest expenditure brought forward from before FinScope (AED)", value: answers.interestBroughtForward, input: a("interestBroughtForward") },
            { label: "Disallowed under the General Interest Deduction Limitation Rule (AED)", value: z(generalDisallowed), auto: true },
            { label: "Brought-forward Net Interest Expenditure deducted this period (AED)", value: z(interestUsed), auto: true },
            { label: "Adjustment for interest expenditure (AED)", value: z(interestAdjustment), kind: "total", auto: true },
          ],
        },
        {
          title: "Transactions with Related Parties and Connected Persons",
          columns: "amount",
          rows: [
            { label: "Were there any transactions with Related Parties in the current Tax Period?", value: answers.relatedParties, input: b("relatedParties") },
            { label: "Transfer pricing adjustment to arm's length (increase / (decrease)) (AED)", value: answers.relatedPartyAdjustment, input: a("relatedPartyAdjustment"), when: "relatedParties" },
            { label: "Were there any gains / losses realised in the current Tax Period in relation to assets/liabilities previously received from a Related Party at a non-arm's length price?", value: answers.nonArmsLengthGains, input: b("nonArmsLengthGains") },
            { label: "Were there any transactions with Connected Persons in the current Tax Period?", value: answers.connectedPersons, input: b("connectedPersons") },
            { label: "Payments to Connected Persons above market value (non-deductible) (AED)", value: answers.connectedPersonExcess, input: a("connectedPersonExcess"), when: "connectedPersons" },
          ],
        },
        {
          title: "Adjustments for Income and Expenditure derived from a Qualifying Investment Fund",
          rows: [{ label: "Has the Taxable Person been an investor in a Qualifying Investment Fund in the current Tax Period or any previous Tax Periods?", value: answers.qualifyingInvestmentFund, input: b("qualifyingInvestmentFund") }],
        },
        {
          title: "Other Adjustments",
          columns: "amount",
          rows: [
            { label: "Has the Taxable Person made an error in a prior Tax Period where the tax impact is AED 10,000 or less?", value: answers.priorPeriodError, input: b("priorPeriodError") },
            { label: "Prior-period error adjustment (AED)", value: answers.priorPeriodErrorAdjustment, input: a("priorPeriodErrorAdjustment"), when: "priorPeriodError" },
            { label: "Any other adjustments not captured above (AED)", value: answers.otherAdjustment, input: a("otherAdjustment") },
            { label: "Description of other adjustments", value: answers.otherAdjustmentNote, input: t("otherAdjustmentNote") },
          ],
        },
      ],
    },
    {
      number: 6,
      title: "Tax Liability and Tax Credits",
      sections: [
        { title: "Taxable Income", columns: "amount", rows: [{ label: "Taxable Income / (Tax Loss) before any Tax Loss adjustments (AED)", value: z(taxableBeforeLosses), auto: true }] },
        {
          title: "Tax Losses",
          columns: "amount",
          rows: [
            { label: "Does the Taxable Person wish to claim Tax Losses from, or surrender Tax Losses to, another group entity?", value: answers.groupLossTransfer, input: b("groupLossTransfer") },
            { label: "Tax losses brought forward from before the first year saved in FinScope (AED)", value: answers.openingTaxLosses, input: a("openingTaxLosses") },
            { label: "Tax losses available at the start of the period (AED)", value: r0(lossesAvailable), auto: true },
            { label: "Tax Losses utilised in current Tax Period (AED)", value: z(lossesUsed), auto: true },
            { label: "Tax Losses claimed from other group entities (AED)", value: 0, auto: true },
            { label: "Tax losses carried forward (AED)", value: r0(Math.max(0, lossesCarried)), auto: true },
          ],
        },
        {
          title: "Tax Calculations and Tax Credits",
          columns: "amount",
          rows: [
            { label: "Taxable Income / (Tax Loss) for the Tax Period (AED)", value: summary[22].amount, auto: true },
            { label: "Corporate Tax Liability (AED)", value: r0(liability), kind: "total", auto: true },
            { label: "Tax credits (withholding / foreign tax credit) to use (AED)", value: answers.taxCredits, input: a("taxCredits") },
            { label: "Corporate Tax payable (AED)", value: r0(payable), kind: "total", auto: true },
          ],
        },
        {
          title: "Estimated / Provisional figures included in the CT Return",
          rows: [{ label: "Have any estimated figures been included in the Corporate Tax Return?", value: answers.estimatedFigures, input: b("estimatedFigures") }],
        },
        {
          title: "Additional Attachments",
          rows: [
            { label: "Financial Statements", value: "Attach the signed financial statements (download from Reports)", kind: "note" },
            { label: "Documentation to support the market value of Qualifying Immovable Property at the start of the first tax period", value: answers.transitionalAdjustment ? "Required" : "Not applicable", kind: "note" },
            { label: "Tax residency certificate in the foreign jurisdiction", value: answers.foreignTaxResident ? "Required" : "Not applicable", kind: "note" },
          ],
        },
      ],
    },
    {
      number: 7,
      title: "Review and Declaration",
      sections: [
        {
          title: "Review and Declaration",
          rows: [
            { label: "First Name in English", value: answers.declarantFirstName, input: t("declarantFirstName") },
            { label: "Last Name in English", value: answers.declarantLastName, input: t("declarantLastName") },
            { label: "Mobile Number", value: answers.declarantMobile, input: t("declarantMobile") },
            { label: "Email ID", value: answers.declarantEmail, input: t("declarantEmail") },
            {
              label: "Confirm who the Tax Return is being prepared by",
              value: answers.preparedBy,
              input: { key: "preparedBy", type: "select", options: ["Taxable Person", "Tax Agent", "Legal Representative"].map((v) => ({ value: v, label: v })) },
            },
            {
              label: "I confirm I have been granted full authority to complete this Tax Return on behalf of the relevant Taxable Person, and the information provided, including any schedules, is to the best of my knowledge complete and accurate at the date of submission.",
              value: "Confirmed on submission in EmaraTax",
              kind: "note",
            },
          ],
        },
      ],
    },
  ]

  for (const step of steps)
    for (const section of step.sections)
      for (const row of section.rows) if (row.when) row.hidden = !answers[row.when]

  /* ---- checks that affect reliability ---- */
  if (Math.abs(s.balanceDifference) >= 0.01) blockers.push(`The trial balance for ${year} is out by ${money(s.balanceDifference)}. Correct it in Data Input before filing.`)
  if (s.unmapped.length) blockers.push(`${s.unmapped.length} trial balance heads are not classified in Data Input.`)
  if (!company.ct.trn) blockers.push("No corporate tax TRN is recorded on the Dashboard.")
  if (answers.mneGroup) blockers.push("Multinational group member: Domestic Minimum Top-up Tax and transfer pricing documentation need a specialist review.")
  if (answers.partnerInUnincorporated || answers.governmentEntity || answers.qualifyingInvestmentFund)
    blockers.push("A specialist regime applies (partnership, government / natural resource business or investment fund). The ordinary computation is shown but needs specialist review.")
  if (answers.groupLossTransfer) blockers.push("Group loss transfers need the other entity's return and the 75% ownership conditions verified (Art. 38).")
  if (answers.foreignPE && !answers.foreignPEIncome) warnings.push("Foreign Permanent Establishment: enter the income if the exemption is elected; otherwise include it as taxable and consider foreign tax credits.")
  if (days < 360 || days > 371)
    warnings.push(`This tax period is ${days} days long. Check whether the AED 375,000 band and the AED 12 million interest threshold are pro-rated for this period before filing.`)

  const status: ReviewStatus = !scope.inScope
    ? "Not in scope"
    : blockers.length
      ? "Provisional liability"
      : assumptions.length
        ? "Answers to confirm"
        : "Ready for filing review"

  /* ---- disclosures register ---- */
  const disclosures: CtReturn["disclosures"] = [
    { item: "Corporate tax return", status: scope.inScope ? "Required" : "Not required", reason: scope.inScope ? `Due with payment by ${formatLongDate(ctDueDate(end))} (nine months after period end, Art. 53). A return is required even when tax is nil.` : scope.reason },
    {
      item: "Audited financial statements",
      status: regime === "Qualifying Free Zone Person" || revenue > CT.auditRevenue ? "Required" : "Not required",
      reason: regime === "Qualifying Free Zone Person" ? "Every Qualifying Free Zone Person must maintain audited statements (MD 84/2025)." : revenue > CT.auditRevenue ? "Revenue exceeds AED 50 million (MD 84/2025)." : "Revenue is AED 50 million or less and the company is not a Qualifying Free Zone Person. Licensing rules may still require an audit.",
    },
    { item: "Related party transactions schedule", status: answers.relatedParties ? "Check" : "Not required", reason: answers.relatedParties ? "Required when related-party transactions exceed AED 40 million in total; report categories above AED 4 million. Downward adjustments must be disclosed whatever their size (CTP011)." : "No related-party transactions reported." },
    { item: "Connected persons schedule", status: answers.connectedPersons ? "Check" : "Not required", reason: answers.connectedPersons ? "Required where payments or benefits to a connected person exceed AED 500,000 in the period." : "No connected-person payments reported." },
    { item: "Master file and local file (transfer pricing)", status: revenue >= CT.tpFileRevenue || answers.mneGroup ? "Required" : "Not required", reason: revenue >= CT.tpFileRevenue ? "Revenue is AED 200 million or more (MD 97/2023)." : answers.mneGroup ? "Member of a multinational group: check the AED 3.15 billion group revenue test." : "Revenue below AED 200 million and not part of a large multinational group." },
    { item: "Interest limitation schedule", status: netInterest + interestBf > CT.interestSafeHarbour ? "Required" : "Not required", reason: `Net interest expenditure is ${money(netInterest)} against the AED 12 million threshold.` },
    { item: "Tax loss schedule", status: lossesAvailable > 0 || taxableBeforeLosses < 0 ? "Required" : "Not required", reason: lossesAvailable > 0 || taxableBeforeLosses < 0 ? "Losses are being used or carried forward; keep the loss ledger by period." : "No tax losses arise or are carried forward." },
    { item: "Exempt income schedule", status: answers.uaeDividends || answers.participatingIncome || answers.foreignPEIncome ? "Required" : "Not required", reason: "Dividends, participation and foreign PE income require supporting schedules and evidence." },
    { item: "Free zone qualifying income schedule", status: regime === "Qualifying Free Zone Person" ? "Required" : freeZone ? "Check" : "Not required", reason: freeZone ? "Revenue must be split into qualifying and non-qualifying income with the de minimis test." : "Mainland company." },
    { item: "Corporate tax note in the financial statements (IAS 12)", status: scope.inScope ? "Required" : "Not required", reason: "Disclose current tax expense, payable and the reconciliation of accounting profit to tax." },
    { item: "Record keeping", status: "Required", reason: "Keep accounts, ledgers and supporting documents for at least seven years after the period end." },
  ]

  /* ---- commentary ---- */
  const periodText = `${formatLongDate(start)} to ${formatLongDate(end)}`
  const commentary: CtReturn["commentary"] = []
  if (!scope.inScope) {
    commentary.push({ title: "Conclusion", paragraphs: [`${company.name}: the period ${periodText} is not subject to UAE corporate tax. ${scope.reason}`] })
  } else {
    const lead =
      regime === "Small Business Relief"
        ? `${company.name} has elected Small Business Relief for ${periodText}. It is treated as having no taxable income, so corporate tax is nil. The simplified return is still due by ${formatLongDate(ctDueDate(end))}.`
        : regime === "Qualifying Free Zone Person"
          ? `${company.name} is computed as a Qualifying Free Zone Person for ${periodText}. Qualifying income is taxed at 0%${liability ? `; ${money(answers.excludedTaxableIncome)} of excluded income is taxed at 9% without the AED 375,000 band, giving ${money(liability)}` : ""}. Corporate tax payable: ${money(payable)}, due by ${formatLongDate(ctDueDate(end))}.`
          : `Corporate tax payable by ${company.name} for ${periodText} is ${money(payable)} under the standard regime, due with the return by ${formatLongDate(ctDueDate(end))}.`
    commentary.push({
      title: "Conclusion",
      paragraphs: [
        lead,
        `Review status: ${status}.${blockers.length ? ` ${blockers.length} matter${blockers.length === 1 ? "" : "s"} must be resolved before filing.` : ""}${assumptions.length ? ` ${assumptions.length} question${assumptions.length === 1 ? " is" : "s are"} still on a default answer; confirm ${assumptions.length === 1 ? "it" : "them"} in the return steps.` : ""}`,
      ],
    })

    const scopeParas = [
      `${company.name} is a ${company.legalForm || "company"} licensed by ${company.authority || "the licensing authority"}${company.emirate ? `, ${company.emirate}` : ""}. As a juridical person incorporated in the UAE it is a resident person and is taxable on its worldwide income (Art. 11).`,
      freeZone
        ? answers.electStandardRegime
          ? "It is a Free Zone Person that has elected the standard regime, so its whole taxable income is taxed at 9% above AED 375,000 and Small Business Relief may be considered."
          : regime === "Qualifying Free Zone Person"
            ? `It is a Free Zone Person that confirms it meets the Qualifying Free Zone Person conditions. ${qfzpNotes.join(" ")} A failure of any condition removes the 0% rate for that period and the next four tax periods.`
            : "It is a Free Zone Person. A free zone licence alone does not give the 0% rate: the Qualifying Free Zone Person conditions must be confirmed, and until they are, the standard 9% computation is used."
        : "It is a mainland company, so the standard regime applies: 0% on taxable income up to AED 375,000 and 9% above it (Art. 3).",
    ]
    commentary.push({ title: "Scope and regime", paragraphs: scopeParas })

    const sbrParas = [
      `Revenue for the period is ${money(revenue)}.${priorRevenue.length ? ` Earlier tax periods: ${priorRevenue.map((item) => `${item.year} ${money(item.revenue)}`).join(", ")}.` : " There are no earlier tax periods saved."}`,
      sbrEligible
        ? `The company qualifies for Small Business Relief: revenue is within AED 3,000,000 in this and every earlier tax period, and the period ends by 31 December 2029 (MD 73/2023 as amended by MD 131/2026). ${sbrElected ? `Electing it saves ${money(liabilityStd)} compared with the standard computation (taxable income ${money(taxableStd)}).` : `It has not been elected; the standard computation gives ${money(liabilityStd)}.`} Under the relief no tax loss can be created for this period, but losses brought forward are preserved for later years.`
        : `Small Business Relief is not available because ${sbrReasons.join("; ")}.`,
    ]
    commentary.push({ title: "Small Business Relief", paragraphs: sbrParas })

    const comp: string[] = [`The computation starts from accounting net profit before tax of ${money(accountingIncome)} (Art. 20).`]
    if (entertainmentAddBack) comp.push(`Entertainment: ${money(entertainment)} is in the accounts; ${answers.clientEntertainmentShare}% is entertainment of clients, shareholders or suppliers, of which 50% is not deductible (Art. 32), adding ${money(entertainmentAddBack)}. Staff entertainment is fully deductible.`)
    if (fines) comp.push(`Fines and penalties of ${money(fines)} are not deductible (Art. 33), except amounts awarded as compensation for damages or breach of contract.`)
    if (donationsAddBack) comp.push(`Donations of ${money(donationsAddBack)} to bodies that are not Qualifying Public Benefit Entities are not deductible (Art. 33).`)
    if (answers.ownerDistributions) comp.push(`Distributions to owners of ${money(answers.ownerDistributions)} charged in profit are not deductible (Art. 33).`)
    if (answers.notWhollyBusiness) comp.push(`Expenses of ${money(answers.notWhollyBusiness)} not wholly and exclusively for the business are added back (Art. 28).`)
    if (answers.uaeDividends) comp.push(`Dividends of ${money(answers.uaeDividends)} from UAE resident companies are exempt and deducted (Art. 22).`)
    if (answers.participatingIncome) comp.push(`Income of ${money(answers.participatingIncome)} from participating interests is exempt (Art. 23, MD 302/2024), subject to the 5% / AED 4 million ownership and 12-month holding conditions.`)
    if (interestAdjustment) comp.push(`Interest: net interest expenditure of ${money(netInterest)} is tested against the higher of AED 12 million and 30% of tax EBITDA; the adjustment is ${money(interestAdjustment)} (Art. 30-31). Disallowed interest is carried forward for up to 10 periods.`)
    else if (netInterest > 0) comp.push(`Net interest expenditure of ${money(netInterest)} is below the AED 12 million threshold, so it is fully deductible under the general interest limitation (Art. 30).`)
    if (rpAdjustment) comp.push(`Related party and connected person adjustments of ${money(rpAdjustment)} bring transactions to arm's length or remove payments above market value (Art. 34-36).`)
    if (otherAdj) comp.push(`Other adjustments: ${money(otherAdj)}${answers.otherAdjustmentNote ? ` (${answers.otherAdjustmentNote})` : ""}.`)
    comp.push(`Taxable income before losses is ${money(taxableBeforeLosses)}.`)
    if (regime === "Standard (9%)") {
      if (lossesAvailable > 0)
        comp.push(`Tax losses available are ${money(lossesAvailable)}. Losses can reduce taxable income by at most 75% (Art. 37), so ${money(lossesUsed)} is used and ${money(Math.max(0, lossesCarried))} is carried forward, subject to the 50% ownership continuity or same-business conditions (Art. 39).`)
      if (taxableBeforeLosses < 0) comp.push(`The period produces a tax loss of ${money(-taxableBeforeLosses)}, carried forward without time limit.`)
      comp.push(
        taxableIncome > CT.zeroBand
          ? `Corporate tax: 0% on the first AED 375,000 and 9% on ${money(taxableIncome - CT.zeroBand)}, giving ${money(liability)}.`
          : `Taxable income of ${money(Math.max(0, taxableIncome))} is within the AED 375,000 band taxed at 0%, so no corporate tax is due.`
      )
    }
    if (credits) comp.push(`Tax credits of ${money(credits)} are set against the liability (limited to the UAE tax on the same income, Art. 47). Corporate tax payable is ${money(payable)}.`)
    commentary.push({ title: "How the tax is calculated", paragraphs: comp })

    const note =
      regime === "Small Business Relief"
        ? `The Company is subject to UAE Corporate Tax under Federal Decree-Law No. 47 of 2022. For the period ended ${formatLongDate(end)} the Company elected Small Business Relief; accordingly no current tax expense has been recognised. Deferred tax has not been recognised as the Company expects to remain eligible for the relief.`
        : `The Company is subject to UAE Corporate Tax under Federal Decree-Law No. 47 of 2022 at 9% on taxable income above AED 375,000. Current tax expense for the period is ${money(liability)}${payable ? `, of which ${money(payable)} is payable at ${formatLongDate(end)}` : ""}. Reconciliation: accounting profit ${money(accountingIncome)}; tax adjustments ${money(taxableBeforeLosses - accountingIncome)}; losses utilised ${money(lossesUsed)}; taxable income ${money(Math.max(0, taxableIncome))}. Deferred tax has been assessed separately.`
    commentary.push({ title: "Draft tax note for the financial statements (IAS 12)", paragraphs: [note, "Record the current tax charge in the books: Dr Corporate tax expense, Cr Corporate tax payable. The accounting profit used here is before corporate tax."] })
  }

  return {
    year,
    periodStart: start,
    periodEnd: end,
    periodDays: days,
    dueDate: ctDueDate(end),
    inScope: scope.inScope,
    scopeReason: scope.reason,
    regime,
    status,
    freeZone,
    revenue: r0(revenue),
    sbr: { eligible: sbrEligible, elected: sbrElected, reasons: sbrReasons, priorRevenue },
    accountingIncome: r0(accountingIncome),
    summary,
    taxableBeforeLosses: r0(taxableBeforeLosses),
    lossesBroughtForward: r0(lossesAvailable),
    lossesUsed: r0(lossesUsed),
    lossesCarriedForward: r0(Math.max(0, lossesCarried)),
    taxableIncome: r0(taxableIncome),
    liability: r0(liability),
    credits: r0(credits),
    payable: r0(payable),
    ordinary: { taxableIncome: r0(taxableStd), liability: r0(liabilityStd) },
    steps,
    commentary,
    disclosures,
    assumptions,
    blockers,
    warnings,
  }
}
