import { categoryOf, type FinancialRecord } from "./financial-statements"
import { resolveRecords } from "./movement"

/**
 * Financial statements shown in another currency (IAS 21 translation): assets and liabilities
 * at the closing rate, income and expenses at the year's average rate, share capital at the
 * rate when the year opened; the difference that arises is shown in equity as a translation
 * difference. Rates are units of the target currency per unit of the base currency.
 */
export type YearRates = { year: number; closing: number; average: number; opening: number; closingDate: string; source: string }

const round = (n: number) => Math.round(n * 100) / 100
export const TRANSLATION = "Foreign currency translation difference"

export function translateRecords(records: FinancialRecord[], target: string, rates: YearRates[]): FinancialRecord[] {
  const byYear = new Map(rates.map((r) => [r.year, r]))
  const out: FinancialRecord[] = []
  for (const record of [...records].sort((a, b) => a.year - b.year)) {
    const r = byYear.get(record.year)
    if (!r) continue
    const rows = (record.closingRows ?? record.rows).map((row) => {
      const statement = categoryOf(row.scheduleKey)?.statement
      const rate = statement === "P&L" ? r.average : row.scheduleKey === "capital" ? r.opening : r.closing
      return { ...row, amount: round(row.amount * rate) }
    })
    // Rounding and the different rates leave a difference; it is equity's translation difference.
    const difference = round(rows.reduce((t, row) => t + row.amount, 0))
    if (difference !== 0) rows.push({ id: "translation", ledgerName: TRANSLATION, amount: -difference, scheduleKey: "retained" })
    const scale = (v: number) => round(v * r.opening)
    out.push({
      ...record,
      currency: target,
      entryMode: "closing",
      rows,
      openingEquity: record.openingEquity
        ? { capital: scale(record.openingEquity.capital), earnings: scale(record.openingEquity.earnings), retained: scale(record.openingEquity.retained), shareholder: scale(record.openingEquity.shareholder) }
        : null,
    })
  }
  return resolveRecords(out) as FinancialRecord[]
}

export function ratesNote(base: string, target: string, rates: YearRates[]) {
  return rates
    .sort((a, b) => b.year - a.year)
    .map((r) => `${r.year}: balance sheet at 1 ${base} = ${r.closing} ${target} (${r.closingDate}), profit and loss at the year's average ${r.average}`)
    .join("; ")
}
