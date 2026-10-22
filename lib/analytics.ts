import { scheduleLines, scheduleValue, type FinancialOutput, type FinancialRecord } from "./financial-statements"

/** Year figures and ratios used by the Snap View and the valuation. */
export type YearMetrics = {
  year: number
  revenue: number
  costOfSales: number
  grossProfit: number
  otherIncome: number
  operatingExpenses: number
  financeCosts: number
  depreciation: number
  interest: number
  ebitda: number
  ebit: number
  netProfit: number
  payroll: number
  cash: number
  receivables: number
  inventory: number
  otherCurrentAssets: number
  currentAssets: number
  nonCurrentAssets: number
  totalAssets: number
  payables: number
  currentLiabilities: number
  nonCurrentLiabilities: number
  totalLiabilities: number
  debt: number
  equity: number
  shareCapital: number
  ratios: {
    grossMargin: number | null
    ebitdaMargin: number | null
    netMargin: number | null
    currentRatio: number | null
    quickRatio: number | null
    cashRatio: number | null
    debtToEquity: number | null
    liabilitiesToAssets: number | null
    returnOnEquity: number | null
    returnOnAssets: number | null
    assetTurnover: number | null
    receivableDays: number | null
    payableDays: number | null
    inventoryDays: number | null
    cashConversionDays: number | null
    payrollToRevenue: number | null
    interestCover: number | null
  }
  expenseMix: { label: string; value: number }[]
}

const bs = (s: FinancialOutput, row: number) => s.bs.find((line) => line.row === row)?.amount ?? 0
const inc = (s: FinancialOutput, row: number) => s.income.find((line) => line.row === row)?.amount ?? 0
const div = (a: number, b: number) => (Math.abs(b) < 0.005 ? null : a / b)

export function metricsFor(record: FinancialRecord): YearMetrics {
  const s = record.statements
  const v = (key: Parameters<typeof scheduleValue>[1]) => scheduleValue(s, key)
  const revenue = inc(s, 10)
  const costOfSales = -inc(s, 11)
  const grossProfit = inc(s, 12)
  const otherIncome = inc(s, 13)
  const operatingExpenses = -inc(s, 14)
  const financeCosts = -inc(s, 15)
  const netProfit = inc(s, 16)
  const depreciation = v("depreciation")
  const interestRows = (record.closingRows ?? record.rows).filter((row) => row.scheduleKey === "finance" && /interest|loan|finance cost|profit on/i.test(row.ledgerName))
  const interest = interestRows.reduce((t, row) => t + row.amount, 0)
  const ebit = netProfit + interest
  const ebitda = ebit + depreciation
  const cash = bs(s, 21)
  const receivables = bs(s, 18)
  const inventory = bs(s, 17)
  const currentAssets = bs(s, 22)
  const nonCurrentAssets = bs(s, 13)
  const totalAssets = bs(s, 25)
  const payables = bs(s, 38)
  const currentLiabilities = bs(s, 42)
  const nonCurrentLiabilities = bs(s, 34)
  const totalLiabilities = currentLiabilities + nonCurrentLiabilities
  const debt = v("directorLoan") + v("longTermLiabilities")
  const equity = bs(s, 50)
  const purchases = costOfSales || operatingExpenses
  const adminLines = scheduleLines.filter((line) => line.note === 18)
  const expenseMix = adminLines
    .map((line) => ({ label: line.label as string, value: v(line.key) }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
  const top = expenseMix.slice(0, 5)
  const rest = expenseMix.slice(5).reduce((t, item) => t + item.value, 0)
  if (rest > 0) top.push({ label: "Other", value: rest })
  return {
    year: record.year,
    revenue,
    costOfSales,
    grossProfit,
    otherIncome,
    operatingExpenses,
    financeCosts,
    depreciation,
    interest,
    ebitda,
    ebit,
    netProfit,
    payroll: v("payroll"),
    cash,
    receivables,
    inventory,
    otherCurrentAssets: currentAssets - cash - receivables - inventory,
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    payables,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities,
    debt,
    equity,
    shareCapital: v("capital"),
    ratios: {
      grossMargin: div(grossProfit, revenue),
      ebitdaMargin: div(ebitda, revenue),
      netMargin: div(netProfit, revenue),
      currentRatio: div(currentAssets, currentLiabilities),
      quickRatio: div(currentAssets - inventory, currentLiabilities),
      cashRatio: div(cash, currentLiabilities),
      debtToEquity: equity > 0 ? div(totalLiabilities, equity) : null,
      liabilitiesToAssets: div(totalLiabilities, totalAssets),
      returnOnEquity: equity > 0 ? div(netProfit, equity) : null,
      returnOnAssets: div(netProfit, totalAssets),
      assetTurnover: div(revenue, totalAssets),
      receivableDays: revenue > 0 ? (receivables / revenue) * 365 : null,
      payableDays: purchases > 0 ? (payables / purchases) * 365 : null,
      inventoryDays: costOfSales > 0 ? (inventory / costOfSales) * 365 : null,
      cashConversionDays: null,
      payrollToRevenue: div(v("payroll"), revenue),
      interestCover: interest > 0 ? ebit / interest : null,
    },
    expenseMix: top,
  }
}

export function allMetrics(records: FinancialRecord[]) {
  return [...records]
    .sort((a, b) => a.year - b.year)
    .map((record) => {
      const m = metricsFor(record)
      const r = m.ratios
      if (r.receivableDays !== null || r.inventoryDays !== null || r.payableDays !== null)
        r.cashConversionDays = (r.receivableDays ?? 0) + (r.inventoryDays ?? 0) - (r.payableDays ?? 0)
      return m
    })
}

export const growth = (now: number, before: number | undefined | null) => (before && Math.abs(before) > 0.005 ? (now - before) / Math.abs(before) : null)

/** Compound annual growth between the first and last of a series of positive values. */
export function cagr(values: number[]) {
  const clean = values.filter((x) => x > 0)
  if (clean.length < 2) return null
  return Math.pow(clean[clean.length - 1] / clean[0], 1 / (clean.length - 1)) - 1
}

export type HealthItem = { label: string; score: number; note: string }
/** A simple 0-100 score from profitability, liquidity, leverage and growth. */
export function healthScore(m: YearMetrics, prior: YearMetrics | null) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n))
  const r = m.ratios
  const items: HealthItem[] = [
    { label: "Profitability", score: clamp(r.netMargin === null ? 40 : 50 + r.netMargin * 250), note: r.netMargin === null ? "No revenue yet" : `Net margin ${(r.netMargin * 100).toFixed(1)}%` },
    { label: "Liquidity", score: clamp(r.currentRatio === null ? 70 : r.currentRatio * 45), note: r.currentRatio === null ? "No current liabilities" : `Current ratio ${r.currentRatio.toFixed(2)}` },
    { label: "Leverage", score: clamp(r.liabilitiesToAssets === null ? 60 : 100 - r.liabilitiesToAssets * 100), note: r.liabilitiesToAssets === null ? "No assets" : `${(r.liabilitiesToAssets * 100).toFixed(0)}% of assets funded by liabilities` },
    { label: "Growth", score: clamp(prior ? 50 + (growth(m.revenue, prior.revenue) ?? 0) * 150 : 50), note: prior ? `Revenue ${((growth(m.revenue, prior.revenue) ?? 0) * 100).toFixed(1)}% vs ${prior.year}` : "One year of data" },
  ]
  return { score: Math.round(items.reduce((t, i) => t + i.score, 0) / items.length), items }
}
