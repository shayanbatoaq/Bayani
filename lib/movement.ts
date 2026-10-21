import {
  calculateFinancials,
  categoryOf,
  type FinancialInput,
  type FinancialLedger,
  type FinancialOutput,
  type FinancialRecord,
} from "./financial-statements"

/**
 * Two ways to enter a year:
 *  - "closing":  the figures are the year's closing trial balance and are reported as entered.
 *  - "movement": the figures are what happened during the year. Balance sheet heads are
 *    carried forward from the previous year's closing balances and the movements are added;
 *    last year's profit and drawings are closed into retained earnings. P&L heads are the
 *    year's figures in both modes.
 */
export type EntryMode = "closing" | "movement"

export type PriorYear = { closingRows: FinancialLedger[]; statements: FinancialOutput }

const round = (n: number) => Math.round(n * 100) / 100
const normal = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ")
const isBalanceSheet = (key: string) => categoryOf(key)?.statement === "BS"

const CONTRA = /depreciation|allowance|accumulated|amorti[sz]ation/i
const isContra = (row: FinancialLedger) => row.scheduleKey === "ppe" && CONTRA.test(row.ledgerName)

export type AutoEntry = { ledgerName: string; amount: number; reason: string }

export function closingRowsFor(
  input: Pick<FinancialInput, "rows" | "entryMode">,
  prior: PriorYear | null
): { rows: FinancialLedger[]; carried: number; auto: AutoEntry[] } {
  const { rows, carried } = balancesFor(input, prior)
  // Depreciation always reduces the assets' book value. When the year has a depreciation
  // charge but no accumulated depreciation was entered, post the other side here.
  const charge = round(input.rows.filter((row) => row.scheduleKey === "depreciation").reduce((sum, row) => sum + row.amount, 0))
  const auto: AutoEntry[] = []
  if (charge !== 0 && !input.rows.some(isContra)) {
    const at = rows.findIndex(isContra)
    const priorAccumulated =
      input.entryMode === "movement" || !prior ? 0 : prior.closingRows.filter(isContra).reduce((sum, row) => sum + row.amount, 0)
    if (at >= 0) rows[at] = { ...rows[at], amount: round(rows[at].amount - charge) }
    else if (input.entryMode !== "movement" && priorAccumulated !== 0)
      rows.push({ id: "auto-accumulated", ledgerName: prior!.closingRows.find(isContra)!.ledgerName, amount: round(priorAccumulated - charge), scheduleKey: "ppe" })
    else rows.push({ id: "auto-accumulated", ledgerName: "Allowance for Depreciation", amount: -charge, scheduleKey: "ppe" })
    auto.push({
      ledgerName: at >= 0 ? rows[at].ledgerName : "Allowance for Depreciation",
      amount: -charge,
      reason: "Accumulated depreciation increased by the year's depreciation charge",
    })
  }
  return { rows, carried, auto }
}

function balancesFor(
  input: Pick<FinancialInput, "rows" | "entryMode">,
  prior: PriorYear | null
): { rows: FinancialLedger[]; carried: number } {
  if (input.entryMode !== "movement" || !prior) return { rows: input.rows.map((row) => ({ ...row })), carried: 0 }
  const balances = new Map<string, FinancialLedger>()
  const add = (row: FinancialLedger, id: string) => {
    const key = normal(row.ledgerName)
    const existing = balances.get(key)
    if (existing) existing.amount = round(existing.amount + row.amount)
    else balances.set(key, { ...row, id })
  }

  // 1. Carry last year's balance sheet, closing the year's profit and drawings into retained earnings.
  let carried = 0
  let retainedName = "Retained Earnings"
  for (const row of prior.closingRows) {
    if (!isBalanceSheet(row.scheduleKey) || row.scheduleKey === "dividends") continue
    if (row.scheduleKey === "retained") retainedName = row.ledgerName
    add(row, `carried-${carried++}`)
  }
  const drawings = prior.closingRows
    .filter((row) => row.scheduleKey === "dividends")
    .reduce((sum, row) => sum + row.amount, 0)
  const closedToRetained = round(-prior.statements.netProfit + drawings)
  if (closedToRetained !== 0)
    add({ id: "", ledgerName: retainedName, amount: closedToRetained, scheduleKey: "retained" }, "carried-retained")

  // 2. Add this year's movements. P&L heads have no opening balance, so they are the year's figures.
  input.rows.forEach((row, i) => {
    const key = normal(row.ledgerName)
    const existing = balances.get(key)
    if (existing) {
      existing.amount = round(existing.amount + row.amount)
      if (row.scheduleKey) existing.scheduleKey = row.scheduleKey
    } else balances.set(key, { ...row, id: row.id || `movement-${i}` })
  })

  // Heads that can sit on either side follow the sign of the resulting balance.
  const rows = [...balances.values()]
    .map((row) =>
      row.scheduleKey === "taxPayable" || row.scheduleKey === "taxReceivable"
        ? { ...row, scheduleKey: row.amount >= 0 ? "taxReceivable" : "taxPayable" }
        : row
    )
    .filter((row) => row.amount !== 0 || !isBalanceSheet(row.scheduleKey))
  return { rows, carried }
}

/** Closing balances of the previous saved year, if it is the year immediately before. */
export function priorYearOf(records: FinancialRecord[], clientId: string, year: number): PriorYear | null {
  const prior = records.find((record) => record.clientId === clientId && record.year === year - 1)
  return prior ? { closingRows: prior.closingRows ?? prior.rows, statements: prior.statements } : null
}

/** Statements for one year in either entry mode. */
export function statementsFor(input: FinancialInput, prior: PriorYear | null) {
  const { rows, carried, auto } = closingRowsFor(input, prior)
  const openingEquity = input.openingEquity ?? (input.entryMode === "movement" && prior ? prior.statements.closingEquity : null)
  return {
    closingRows: rows,
    carried,
    auto,
    statements: calculateFinancials({ ...input, rows, openingEquity }),
  }
}

/**
 * Recomputes every record oldest first, so a movement year always builds on the
 * current closing balances of the year before it, even after that year is edited.
 */
export function resolveRecords<T extends FinancialInput & { id: string; revision: number; updatedAt: string }>(
  records: T[]
): (T & { closingRows: FinancialLedger[]; statements: FinancialOutput })[] {
  const done: (T & { closingRows: FinancialLedger[]; statements: FinancialOutput })[] = []
  for (const record of [...records].sort((a, b) => a.year - b.year)) {
    const prior = priorYearOf(done as unknown as FinancialRecord[], record.clientId, record.year)
    const { closingRows, statements } = statementsFor(record, prior)
    done.push({ ...record, closingRows, statements })
  }
  return done
}
