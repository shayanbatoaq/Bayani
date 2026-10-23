import { financialPeriod, formatLongDate, monthNames, quarterCycleLabel, type Company } from "./company"
import {
  calculateCashFlow,
  scheduleLines,
  scheduleValue,
  type FinancialOutput,
  type FinancialRecord,
  type ScheduleKey,
} from "./financial-statements"

/**
 * Presentation model for the financial statements pack:
 * cover, index, statement of financial position, statement of comprehensive
 * income, statement of changes in equity, statement of cash flows and the
 * numbered schedules behind them. Every figure comes from the saved trial
 * balances; nothing here calculates tax or applies judgement.
 */

export type RowKind = "section" | "heading" | "subtotal" | "total" | "spacer"
export type Row = {
  label: string
  note?: number
  current: number | null
  prior: number | null
  kind?: RowKind
}
export type ScheduleTable = {
  head: string[]
  body: string[][]
  /** Index of numeric columns, right aligned. */
  numeric: number[]
  totalLast?: boolean
}
export type Schedule = {
  number: number
  title: string
  paragraphs?: string[]
  rows?: Row[]
  table?: ScheduleTable
}
export type EquityTable = {
  year: number
  columns: string[]
  lines: { label: string; values: number[]; kind?: "total" }[]
}
export type DetailItem = { label: string; lines: string[] }
export type ReportModel = {
  companyName: string
  /** Company logo: a data URI for PDFs, or a URL for the on-screen view. */
  logo?: string | null
  /** Company details page shown after the index. */
  details: DetailItem[]
  /** Cover line, e.g. "DUBAI - UNITED ARAB EMIRATES". */
  location: string
  /** Signature line, e.g. "Dubai, U.A.E.". */
  place: string
  currency: string
  /** When shown in a currency other than the books': the rates used. */
  currencyNote?: string
  year: number
  priorYear: number | null
  periodEnd: string
  periodEndText: string
  bs: Row[]
  income: Row[]
  equity: EquityTable[]
  cashFlow: Row[]
  schedules: Schedule[]
  warnings: string[]
}

const round = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** Fixed schedule numbers, so a reader always finds, say, cash at schedule 7. */
export const SCHEDULE = {
  ppe: 1,
  financialAssets: 2,
  inventories: 3,
  receivables: 4,
  advances: 5,
  relatedReceivable: 6,
  cash: 7,
  nonCurrentLiabilities: 8,
  payables: 9,
  accruals: 10,
  relatedPayable: 11,
  endOfService: 12,
  shareCapital: 13,
  shareholder: 14,
  sales: 15,
  costOfSales: 16,
  otherIncome: 17,
  admin: 18,
  finance: 19,
} as const

/** Engine note group → schedule number. */
const FROM_ENGINE_NOTE: Record<number, number> = {
  3: SCHEDULE.ppe,
  4: SCHEDULE.financialAssets,
  5: SCHEDULE.inventories,
  6: SCHEDULE.receivables,
  7: SCHEDULE.advances,
  8: SCHEDULE.relatedReceivable,
  9: SCHEDULE.cash,
  10: SCHEDULE.nonCurrentLiabilities,
  11: SCHEDULE.payables,
  12: SCHEDULE.accruals,
  13: SCHEDULE.relatedPayable,
  14: SCHEDULE.endOfService,
  15: SCHEDULE.shareholder,
  16: SCHEDULE.sales,
  17: SCHEDULE.costOfSales,
  21: SCHEDULE.otherIncome,
  18: SCHEDULE.admin,
  19: SCHEDULE.finance,
}

const SCHEDULE_TITLES: Record<number, string> = {
  [SCHEDULE.ppe]: "Property, plant and equipment",
  [SCHEDULE.financialAssets]: "Financial assets",
  [SCHEDULE.inventories]: "Inventories",
  [SCHEDULE.receivables]: "Trade receivables",
  [SCHEDULE.advances]: "Advances, deposits and prepayments",
  [SCHEDULE.relatedReceivable]: "Due from related party",
  [SCHEDULE.cash]: "Cash and cash equivalents",
  [SCHEDULE.nonCurrentLiabilities]: "Non-current liabilities",
  [SCHEDULE.payables]: "Trade payables",
  [SCHEDULE.accruals]: "Accruals, provisions and other payables",
  [SCHEDULE.relatedPayable]: "Due to related party",
  [SCHEDULE.endOfService]: "Employees' end of service benefits",
  [SCHEDULE.shareCapital]: "Share capital",
  [SCHEDULE.shareholder]: "Shareholders' current account",
  [SCHEDULE.sales]: "Sales",
  [SCHEDULE.costOfSales]: "Cost of sales",
  [SCHEDULE.otherIncome]: "Other income",
  [SCHEDULE.admin]: "Administrative and general expenses",
  [SCHEDULE.finance]: "Bank charges and interest",
}

const LINE_LABELS: Partial<Record<ScheduleKey, string>> = {
  taxReceivable: "Duties and taxes",
  otherReceivables: "Other receivables",
  cash: "Cash in hand",
  bank: "Cash at bank",
  longTermLiabilities: "Other non-current liabilities",
  accruals: "Accruals and provisions",
  customerAdvances: "Advances from customers",
  taxPayable: "Duties and taxes",
  otherPayables: "Other payables",
  consultancy: "Finance consultancy",
  entertainment: "Meals and entertainment",
  rent: "Rent and warehouse",
  payroll: "Staff salaries and benefits",
  printing: "Printing and stationery",
  finance: "Bank charges and interest",
  exchange: "Bank revaluations and exchange differences",
}

export function buildReport(company: Company, records: FinancialRecord[], year: number): ReportModel {
  const byYear = new Map(records.map((record) => [record.year, record]))
  const current = byYear.get(year)
  if (!current) throw new Error(`No saved data for ${year}.`)
  const prior = byYear.get(year - 1) ?? null
  const prior2 = byYear.get(year - 2) ?? null
  const c = current.statements
  const p = prior?.statements ?? null
  const v = (key: ScheduleKey) => scheduleValue(c, key)
  const pv = (key: ScheduleKey) => (p ? scheduleValue(p, key) : null)
  const period = financialPeriod(year, company.ct.yearEndMonth)
  const periodEndText = formatLongDate(period.end)
  const warnings: string[] = []

  /* ---------- statement of financial position ---------- */
  const bsAmount = (output: FinancialOutput | null, row: number) =>
    output ? (output.bs.find((line) => line.row === row)?.amount ?? 0) : null
  const line = (row: number, label: string, note?: number, kind?: RowKind): Row => ({
    label,
    note,
    current: bsAmount(c, row),
    prior: bsAmount(p, row),
    kind,
  })
  const heading = (label: string, kind: RowKind = "heading"): Row => ({ label, current: null, prior: null, kind })
  const spacer: Row = { label: "", current: null, prior: null, kind: "spacer" }
  const bs: Row[] = [
    heading("ASSETS", "section"),
    heading("NON-CURRENT ASSETS"),
    line(11, "Property, plant and equipment", SCHEDULE.ppe),
    line(12, "Financial assets", SCHEDULE.financialAssets),
    line(13, "TOTAL NON-CURRENT ASSETS", undefined, "subtotal"),
    spacer,
    heading("CURRENT ASSETS"),
    line(17, "Inventories", SCHEDULE.inventories),
    line(18, "Trade receivables", SCHEDULE.receivables),
    line(19, "Advances, deposits and prepayments", SCHEDULE.advances),
    line(20, "Due from related party", SCHEDULE.relatedReceivable),
    line(21, "Cash and cash equivalents", SCHEDULE.cash),
    line(22, "TOTAL CURRENT ASSETS", undefined, "subtotal"),
    spacer,
    line(25, "TOTAL ASSETS", undefined, "total"),
    spacer,
    heading("LIABILITIES AND EQUITY", "section"),
    heading("NON-CURRENT LIABILITIES"),
    line(32, "Loan from director"),
    line(33, "Other non-current liabilities"),
    line(34, "TOTAL NON-CURRENT LIABILITIES", SCHEDULE.nonCurrentLiabilities, "subtotal"),
    spacer,
    heading("CURRENT LIABILITIES"),
    line(38, "Trade payables", SCHEDULE.payables),
    line(39, "Accruals, provisions and other payables", SCHEDULE.accruals),
    line(40, "Due to related party", SCHEDULE.relatedPayable),
    line(41, "Employees' end of service benefits", SCHEDULE.endOfService),
    line(42, "TOTAL CURRENT LIABILITIES", undefined, "subtotal"),
    spacer,
    heading("EQUITY"),
    line(46, "Share capital", SCHEDULE.shareCapital),
    line(47, "Current year earnings"),
    line(48, "Retained earnings"),
    line(49, "Shareholders' current account", SCHEDULE.shareholder),
    line(50, "TOTAL EQUITY", undefined, "subtotal"),
    spacer,
    line(52, "TOTAL EQUITY AND LIABILITIES", undefined, "total"),
  ]
  const assets = bsAmount(c, 25) ?? 0
  const equityAndLiabilities = bsAmount(c, 52) ?? 0
  if (Math.abs(assets - equityAndLiabilities) >= 0.01)
    warnings.push(
      `Total assets (${money(assets)}) and total equity and liabilities (${money(equityAndLiabilities)}) differ by ${money(round(assets - equityAndLiabilities))}. Check the trial balance in Data Input.`
    )

  /* ---------- statement of comprehensive income ---------- */
  const incomeRow = (output: FinancialOutput | null, row: number) =>
    output ? (output.income.find((item) => item.row === row)?.amount ?? 0) : null
  const pl = (row: number, label: string, note?: number, kind?: RowKind): Row => ({
    label,
    note,
    current: incomeRow(c, row),
    prior: incomeRow(p, row),
    kind,
  })
  const income: Row[] = [
    pl(10, "SALES", SCHEDULE.sales, "heading"),
    pl(11, "Cost of sales", SCHEDULE.costOfSales),
    pl(12, "GROSS PROFIT", undefined, "subtotal"),
    spacer,
    pl(13, "Other income", SCHEDULE.otherIncome),
    pl(14, "Administrative and general expenses", SCHEDULE.admin),
    pl(15, "Bank charges and interest", SCHEDULE.finance),
    pl(16, "NET PROFIT / (LOSS) FOR THE YEAR", undefined, "total"),
  ]

  /* ---------- changes in equity ---------- */
  const columns = ["Share capital", "Current year earnings", "Retained earnings", "Shareholders' current account", "Total"]
  const equityFor = (record: FinancialRecord): EquityTable => {
    const recordPeriod = financialPeriod(record.year, company.ct.yearEndMonth)
    const lines = record.statements.equity
    const values = (index: number) => lines[index]?.values.map((value) => value ?? 0) ?? [0, 0, 0, 0, 0]
    // Without opening equity entered, the previous saved year's closing balances are the opening balances.
    const previous = byYear.get(record.year - 1)
    const openingKnown = lines[0]?.values.some((value) => value !== null)
    const opening = !openingKnown && previous ? previous.statements.equity.at(-1)!.values.map((value) => value ?? 0) : values(0)
    const moved = (index: number) => values(index).some((value) => Math.abs(value) >= 0.005)
    const out: EquityTable["lines"] = [
      { label: `Balance as at ${formatLongDate(recordPeriod.start)}`, values: opening },
      { label: `Net profit / (loss) for the year`, values: values(1) },
    ]
    if (moved(2)) out.push({ label: "Transfer of prior-year earnings", values: values(2) })
    if (moved(3)) out.push({ label: "Dividends / drawings", values: values(3) })
    // Net movements is the balancing figure, so each column foots to the closing balance.
    const closing = values(lines.length - 1)
    const listed = out.map((item) => item.values)
    out.push({
      label: "Net movements",
      values: closing.map((value, col) => round(value - listed.reduce((sum, item) => sum + item[col], 0))),
    })
    out.push({ label: `As at ${formatLongDate(recordPeriod.end)}`, values: closing, kind: "total" })
    return { year: record.year, columns, lines: out }
  }
  const equity = [prior, current].filter((record): record is FinancialRecord => Boolean(record)).map(equityFor)

  /* ---------- cash flows ---------- */
  const cf = calculateCashFlow(c, p)
  const cfPrior = p ? calculateCashFlow(p, prior2?.statements ?? null) : null
  const cashFlow: Row[] = cf.lines.map((item, i) => ({
    label: item.label,
    current: item.amount,
    prior: cfPrior ? cfPrior.lines[i].amount : null,
    kind: item.kind === "total" ? ("subtotal" as const) : item.kind,
    note: item.label.startsWith("Cash and cash equivalents at end") ? SCHEDULE.cash : undefined,
  }))
  const endRow = cashFlow.at(-1)
  if (endRow) endRow.kind = "total"
  if (cf.firstYear)
    warnings.push(
      `No data saved for ${year - 1}: the cash flow statement treats opening balances as nil. Save ${year - 1} in Data Input for accurate movements.`
    )
  if (Math.abs(cf.difference) >= 0.01)
    warnings.push(`Cash flow does not reconcile to cash and cash equivalents by ${money(cf.difference)} ${current.currency}.`)
  for (const record of [current, prior])
    if (record)
      for (const warning of record.statements.warnings)
        if (!(warning.startsWith("Opening equity is missing") && byYear.has(record.year - 1)))
          warnings.push(`${record.year}: ${warning}`)

  /* ---------- schedules ---------- */
  const schedules: Schedule[] = []
  const linesOf = (engineNote: number) => scheduleLines.filter((item) => item.note === engineNote)
  const labelOf = (key: ScheduleKey, label: string) => LINE_LABELS[key] ?? sentence(label.replace(/ - closing balance$/, ""))
  const total = (rows: Row[], label = "Total"): Row => ({
    label,
    current: round(rows.reduce((sum, row) => sum + (row.current ?? 0), 0)),
    prior: p ? round(rows.reduce((sum, row) => sum + (row.prior ?? 0), 0)) : null,
    kind: "total",
  })
  const plain = (engineNote: number) => {
    const rows = linesOf(engineNote).map((item) => ({
      label: labelOf(item.key, item.label),
      current: v(item.key),
      prior: pv(item.key),
    }))
    return [...rows, total(rows)]
  }

  // 1 Property, plant and equipment: cost, accumulated depreciation and net book value.
  schedules.push({ number: SCHEDULE.ppe, title: SCHEDULE_TITLES[SCHEDULE.ppe], rows: ppeMovement(current, prior, prior2) })
  for (const engineNote of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    schedules.push({ number: FROM_ENGINE_NOTE[engineNote], title: SCHEDULE_TITLES[FROM_ENGINE_NOTE[engineNote]], rows: plain(engineNote) })

  // 12 End of service benefits: movement in the provision.
  const eosOpen = p ? scheduleValue(p, "endOfService") : 0
  const eosOpenPrior = prior2 ? scheduleValue(prior2.statements, "endOfService") : 0
  schedules.push({
    number: SCHEDULE.endOfService,
    title: SCHEDULE_TITLES[SCHEDULE.endOfService],
    rows: [
      { label: "Balance at the beginning of the year", current: eosOpen, prior: p ? eosOpenPrior : null },
      { label: "Provided / (paid) during the year, net", current: round(v("endOfService") - eosOpen), prior: p ? round(scheduleValue(p, "endOfService") - eosOpenPrior) : null },
      { label: "Balance at the end of the year", current: v("endOfService"), prior: pv("endOfService"), kind: "total" },
    ],
  })

  // 13 Share capital with the shareholding.
  const capital = v("capital")
  const partnerValues = company.partners.map((partner) =>
    partner.shareValue > 0 ? partner.shareValue : round((capital * partner.sharePercent) / 100)
  )
  const partnerTotal = round(partnerValues.reduce((sum, value) => sum + value, 0))
  if (capital && company.partners.length && Math.abs(partnerTotal - capital) >= 0.01)
    warnings.push(
      `Partner share values on the Dashboard (${money(partnerTotal)}) differ from share capital in the trial balance (${money(capital)}).`
    )
  schedules.push({
    number: SCHEDULE.shareCapital,
    title: SCHEDULE_TITLES[SCHEDULE.shareCapital],
    paragraphs: [
      `The authorised, issued and fully paid share capital of the Company is ${current.currency} ${money(capital)}, held as follows:`,
    ],
    table: {
      head: ["Shareholder", "Nationality", "Share %", current.currency],
      numeric: [2, 3],
      totalLast: true,
      body: [
        ...company.partners.map((partner, i) => [partner.name, partner.nationality, money(partner.sharePercent), money(partnerValues[i])]),
        ["Total", "", money(company.partners.reduce((sum, partner) => sum + partner.sharePercent, 0)), money(partnerTotal)],
      ],
    },
  })

  // 14 Shareholders' current account: opening, movement, closing (equity sign).
  const shOpen = p ? scheduleValue(p, "shareholder") : (current.openingEquity?.shareholder ?? 0)
  const shOpenPrior = p ? (prior2 ? scheduleValue(prior2.statements, "shareholder") : (prior!.openingEquity?.shareholder ?? 0)) : null
  schedules.push({
    number: SCHEDULE.shareholder,
    title: SCHEDULE_TITLES[SCHEDULE.shareholder],
    rows: [
      { label: "Beginning balance", current: shOpen, prior: shOpenPrior },
      { label: "Net movement during the year", current: round(v("shareholder") - shOpen), prior: p && shOpenPrior !== null ? round(scheduleValue(p, "shareholder") - shOpenPrior) : null },
      { label: "Ending balance", current: v("shareholder"), prior: pv("shareholder"), kind: "total" },
    ],
  })

  for (const engineNote of [16, 17, 21, 18, 19])
    schedules.push({ number: FROM_ENGINE_NOTE[engineNote], title: SCHEDULE_TITLES[FROM_ENGINE_NOTE[engineNote]], rows: plain(engineNote) })
  schedules.sort((a, b) => a.number - b.number)

  const emirate = company.emirate || ""
  return {
    companyName: company.name.toUpperCase(),
    details: companyDetails(company, period),
    location: `${emirate ? `${emirate.toUpperCase()} - ` : ""}UNITED ARAB EMIRATES`,
    place: `${emirate ? `${emirate}, ` : ""}U.A.E.`,
    currency: current.currency,
    year,
    priorYear: p ? year - 1 : null,
    periodEnd: period.end,
    periodEndText,
    bs,
    income,
    equity,
    cashFlow,
    schedules,
    warnings,
  }
}

function companyDetails(company: Company, period: { start: string; end: string }): DetailItem[] {
  const or = (value: string) => value || "Not provided"
  const vat = company.vat.trn
    ? [
        `TRN ${company.vat.trn}`,
        company.vat.frequency === "monthly"
          ? "Monthly returns"
          : `Quarterly returns (${quarterCycleLabel(company.vat.cycleStartMonth)})`,
        ...(company.vat.effectiveDate ? [`Effective from ${formatLongDate(company.vat.effectiveDate)}`] : []),
      ]
    : ["Not registered"]
  const yearEnd = monthNames[company.ct.yearEndMonth - 1]
  const ct = company.ct.trn
    ? [
        `TRN ${company.ct.trn}`,
        `Tax period: financial year ending ${yearEnd} (this period ${formatLongDate(period.start)} to ${formatLongDate(period.end)})`,
        ...(company.ct.firstPeriodStart ? [`First tax period starts ${formatLongDate(company.ct.firstPeriodStart)}`] : []),
      ]
    : ["Not registered"]
  return [
    { label: "Company name", lines: [company.name] },
    { label: "Legal type", lines: [or(company.legalForm)] },
    { label: "Licensing authority", lines: [or([company.authority, company.emirate].filter(Boolean).join(", "))] },
    { label: "License number", lines: [or(company.licenseNumber)] },
    { label: "License issue date", lines: [or(company.licenseIssueDate ? formatLongDate(company.licenseIssueDate) : "")] },
    { label: "Business activity", lines: [or(company.businessActivity)] },
    {
      label: "Owners",
      lines: company.partners.length
        ? company.partners.map((partner) => `${partner.name}${partner.nationality ? ` (${partner.nationality})` : ""} – ${money(partner.sharePercent)}%`)
        : ["Not provided"],
    },
    { label: "Manager", lines: [or(company.manager)] },
    { label: "VAT registration", lines: vat },
    { label: "Corporate tax registration", lines: ct },
  ]
}

/** Splits the PPE heads into cost and accumulated depreciation and builds the movement. */
function ppeMovement(
  current: FinancialRecord,
  prior: FinancialRecord | null,
  prior2: FinancialRecord | null
): Row[] {
  const contra = /depreciation|allowance|accumulated|amorti[sz]ation/i
  const split = (record: FinancialRecord | null) => {
    if (!record) return { cost: 0, accumulated: 0 }
    let cost = 0
    let accumulated = 0
    for (const row of record.closingRows ?? record.rows) {
      if (row.scheduleKey !== "ppe") continue
      if (contra.test(row.ledgerName) || row.amount < 0) accumulated -= row.amount
      else cost += row.amount
    }
    return { cost: round(cost), accumulated: round(accumulated) }
  }
  const charge = (record: FinancialRecord | null) => (record ? scheduleValue(record.statements, "depreciation") : 0)
  const movement = (record: FinancialRecord | null, opening: FinancialRecord | null) => {
    const close = split(record)
    const open = split(opening)
    const dep = charge(record)
    return {
      costOpen: open.cost,
      additions: round(close.cost - open.cost),
      costClose: close.cost,
      accOpen: open.accumulated,
      charge: dep,
      adjustment: round(close.accumulated - open.accumulated - dep),
      accClose: close.accumulated,
      nbv: round(close.cost - close.accumulated),
    }
  }
  const a = movement(current, prior)
  const b = prior ? movement(prior, prior2) : null
  const row = (label: string, key: keyof typeof a, kind?: RowKind): Row => ({ label, current: a[key], prior: b ? b[key] : null, kind })
  const rows: Row[] = [
    { label: "Cost", current: null, prior: null, kind: "heading" },
    row("At the beginning of the year", "costOpen"),
    row("Additions / (disposals), net", "additions"),
    row("At the end of the year", "costClose", "subtotal"),
    { label: "Accumulated depreciation", current: null, prior: null, kind: "heading" },
    row("At the beginning of the year", "accOpen"),
    row("Charge for the year", "charge"),
  ]
  if (Math.abs(a.adjustment) >= 0.01 || (b && Math.abs(b.adjustment) >= 0.01)) rows.push(row("Disposals / adjustments", "adjustment"))
  rows.push(row("At the end of the year", "accClose", "subtotal"))
  rows.push({ label: "", current: null, prior: null, kind: "spacer" })
  rows.push(row("Net book value", "nbv", "total"))
  return rows
}

function sentence(label: string) {
  if (label !== label.toUpperCase()) return label.charAt(0).toUpperCase() + label.slice(1)
  const lower = label.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Sections listed in the index, in page order. */
export const reportIndex = [
  { key: "details", label: "Company details" },
  { key: "bs", label: "Statement of financial position" },
  { key: "income", label: "Statement of comprehensive income" },
  { key: "equity", label: "Statement of changes in equity" },
  { key: "cashFlow", label: "Statement of cash flows" },
  { key: "schedules", label: "Schedules to the financial statements" },
] as const
export type IndexKey = (typeof reportIndex)[number]["key"]
