import {
  daysBetween,
  financialPeriod,
  ctDueDate,
  vatPeriods,
  type Company,
  type VatOverride,
  type VatPeriod,
} from "./company"
import { scheduleValue, type FinancialRecord } from "./financial-statements"

export const VAT_RATE = 0.05
export const CT_RATE = 0.09
export const CT_ZERO_BAND = 375_000
export const CT_REGIME_START = "2023-06-01"
/** Small Business Relief: revenue threshold and last eligible period end (Ministerial Decision No. 131, extending MD 73 of 2023). */
export const SBR_REVENUE_LIMIT = 3_000_000
export const SBR_LAST_PERIOD_END = "2029-12-31"
export const ENTERTAINMENT_DISALLOWED = 0.5

const round = (n: number) => Math.round(n * 100) / 100

/** Annual figures used to estimate VAT, from a saved year. */
export function vatBase(record: FinancialRecord) {
  const s = record.statements
  const sales = scheduleValue(s, "sales")
  const admin =
    s.schedules.find((line) => line.row === 91)?.amount ?? 0 // total note 18
  const excluded = scheduleValue(s, "payroll") + scheduleValue(s, "depreciation")
  return {
    sales,
    standardExpenses: round(
      Math.max(0, scheduleValue(s, "costOfSales") + admin - excluded)
    ),
  }
}

export type VatRow = VatPeriod & {
  source: "Entered" | "Estimated" | "Partial data"
  standardSales: number
  zeroRatedSales: number
  exemptSales: number
  standardExpenses: number
  outputVat: number
  inputVat: number
  netVat: number
  coveredDays: number
}

export function vatSchedule(company: Company, records: FinancialRecord[]): VatRow[] {
  if (!company.vat.trn || !records.length) return []
  const years = records.map((record) => ({
    record,
    ...financialPeriod(record.year, company.ct.yearEndMonth),
  }))
  const from = years.reduce((min, y) => (y.start < min ? y.start : min), years[0].start)
  const to = years.reduce((max, y) => (y.end > max ? y.end : max), years[0].end)
  return vatPeriods(company.vat, from, to).map((period) => {
    let sales = 0
    let expenses = 0
    let covered = 0
    for (const y of years) {
      const start = period.start > y.start ? period.start : y.start
      const end = period.end < y.end ? period.end : y.end
      if (start > end) continue
      const overlap = daysBetween(start, end)
      const fraction = overlap / daysBetween(y.start, y.end)
      const base = vatBase(y.record)
      sales += base.sales * fraction
      expenses += base.standardExpenses * fraction
      covered += overlap
    }
    const override: VatOverride | undefined = company.vatOverrides[period.id]
    const values = override ?? {
      standardSales: round(sales),
      zeroRatedSales: 0,
      exemptSales: 0,
      standardExpenses: round(expenses),
    }
    const outputVat = round(values.standardSales * VAT_RATE)
    const inputVat = round(values.standardExpenses * VAT_RATE)
    return {
      ...period,
      ...values,
      source: override
        ? "Entered"
        : covered < daysBetween(period.start, period.end)
          ? "Partial data"
          : "Estimated",
      outputVat,
      inputVat,
      netVat: round(outputVat - inputVat),
      coveredDays: covered,
    }
  })
}

export type CtRow = {
  year: number
  periodStart: string
  periodEnd: string
  dueDate: string
  status: "In scope" | "Before CT regime" | "Before registration"
  revenue: number
  accountingProfit: number
  entertainmentAddBack: number
  taxableIncome: number
  lossBroughtForward: number
  lossUsed: number
  lossCarriedForward: number
  taxableAfterLosses: number
  ctStandard: number
  sbrEligible: boolean
}

export function ctSchedule(company: Company, records: FinancialRecord[]): CtRow[] {
  if (!company.ct.trn) return []
  let losses = 0
  return [...records]
    .sort((a, b) => a.year - b.year)
    .map((record) => {
      const s = record.statements
      const { start, end } = financialPeriod(record.year, company.ct.yearEndMonth)
      const status: CtRow["status"] =
        start < CT_REGIME_START
          ? "Before CT regime"
          : company.ct.firstPeriodStart && end < company.ct.firstPeriodStart
            ? "Before registration"
            : "In scope"
      const revenue = round(scheduleValue(s, "sales") + scheduleValue(s, "otherIncome"))
      const addBack = round(scheduleValue(s, "entertainment") * ENTERTAINMENT_DISALLOWED)
      const taxable = round(s.netProfit + addBack)
      const row: CtRow = {
        year: record.year,
        periodStart: start,
        periodEnd: end,
        dueDate: ctDueDate(end),
        status,
        revenue,
        accountingProfit: s.netProfit,
        entertainmentAddBack: addBack,
        taxableIncome: taxable,
        lossBroughtForward: 0,
        lossUsed: 0,
        lossCarriedForward: 0,
        taxableAfterLosses: 0,
        ctStandard: 0,
        sbrEligible: false,
      }
      if (status !== "In scope") return row
      row.lossBroughtForward = losses
      if (taxable < 0) {
        losses = round(losses - taxable)
      } else {
        // Losses may offset up to 75% of taxable income.
        row.lossUsed = round(Math.min(losses, taxable * 0.75))
        losses = round(losses - row.lossUsed)
      }
      row.lossCarriedForward = losses
      row.taxableAfterLosses = round(Math.max(0, taxable - row.lossUsed))
      row.ctStandard = round(Math.max(0, row.taxableAfterLosses - CT_ZERO_BAND) * CT_RATE)
      row.sbrEligible = revenue <= SBR_REVENUE_LIMIT && end <= SBR_LAST_PERIOD_END
      return row
    })
}
