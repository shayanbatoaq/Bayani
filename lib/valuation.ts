import { allMetrics, cagr, type YearMetrics } from "./analytics"
import type { Company } from "./company"
import type { FinancialRecord } from "./financial-statements"

/**
 * Indicative business valuation from the saved financial statements.
 *
 * Five recognised approaches are computed and weighted by what the data supports:
 *  - Income approach: discounted cash flow (DCF) and capitalisation of maintainable earnings
 *  - Market approach: EV/EBITDA multiple and EV/revenue multiple for the identified industry
 *  - Asset approach: adjusted net asset value (book equity), used as a floor and for
 *    asset-holding businesses
 * Multiples and risk premiums are indicative ranges for small and medium private UAE
 * businesses; they are inputs the user can change, not market quotes.
 */

export type Industry = {
  key: string
  label: string
  match: RegExp
  ebitda: [number, number, number]
  revenue: [number, number]
  assetLed?: boolean
}

export const INDUSTRIES: Industry[] = [
  { key: "software", label: "IT, software and digital services", match: /software|information technology|\bit\b|digital|app |saas|web|cyber|data/i, ebitda: [5, 7, 9.5], revenue: [1, 2.5] },
  { key: "healthcare", label: "Healthcare and clinics", match: /clinic|hospital|medical|health|dental|pharmac/i, ebitda: [5, 6.5, 8], revenue: [0.8, 1.5] },
  { key: "education", label: "Education and training", match: /school|nursery|education|training|academy|institute/i, ebitda: [5, 6.5, 8], revenue: [1, 1.8] },
  { key: "consulting", label: "Professional and consultancy services", match: /consult|advis|management|audit|account|legal|recruit|marketing|design|agency|services/i, ebitda: [3.5, 5, 6.5], revenue: [0.6, 1.2] },
  { key: "logistics", label: "Logistics and transport", match: /logistic|freight|shipping|cargo|transport|courier|warehous/i, ebitda: [3.5, 4.5, 6], revenue: [0.3, 0.7] },
  { key: "manufacturing", label: "Manufacturing and industrial", match: /manufactur|factory|industrial|fabricat|production/i, ebitda: [4, 5, 6.5], revenue: [0.4, 0.9] },
  { key: "construction", label: "Construction and contracting", match: /construct|contract|building|civil|fit-?out|mep|engineering works/i, ebitda: [2.5, 3.5, 4.5], revenue: [0.2, 0.4] },
  { key: "hospitality", label: "Restaurants, hospitality and events", match: /restaurant|cafe|coffee|catering|hotel|hospitality|event|food/i, ebitda: [3, 4, 5.5], revenue: [0.3, 0.7] },
  { key: "realestate", label: "Real estate services", match: /real estate|property|brokerage|facility management/i, ebitda: [3.5, 4.5, 6], revenue: [0.5, 1] },
  { key: "retail", label: "Retail and e-commerce", match: /retail|e-?commerce|shop|store|boutique/i, ebitda: [3.5, 4.5, 6], revenue: [0.3, 0.8] },
  { key: "holding", label: "Holding and investment", match: /holding|investment|invest in/i, ebitda: [5, 6, 7], revenue: [1, 2], assetLed: true },
  { key: "trading", label: "General trading and distribution", match: /trading|trade|wholesale|distribut|import|export|supply/i, ebitda: [3, 4, 5], revenue: [0.2, 0.5] },
]
export const GENERAL: Industry = { key: "general", label: "General business", match: /.*/, ebitda: [3.5, 4.5, 5.5], revenue: [0.3, 0.8] }

export function detectIndustry(activity: string): Industry {
  return INDUSTRIES.find((industry) => industry.match.test(activity)) ?? GENERAL
}

export type ValuationInputs = {
  industry?: string
  discountRate?: number
  terminalGrowth?: number
  year?: number
}

export type Method = {
  key: "dcf" | "ebitda" | "capitalised" | "revenue" | "nav"
  name: string
  approach: "Income" | "Market" | "Asset"
  low: number
  value: number
  high: number
  weight: number
  explanation: string[]
}

export type Valuation = {
  year: number
  industry: Industry
  industryReason: string
  yearsUsed: number[]
  value: number
  low: number
  high: number
  confidence: "High" | "Medium" | "Low"
  discountRate: number
  discountBuild: { label: string; value: number }[]
  terminalGrowth: number
  maintainableEbitda: number
  maintainableProfit: number
  netCash: number
  methods: Method[]
  projection: { year: number; revenue: number; ebitda: number; fcf: number; discounted: number }[]
  summary: string[]
  drivers: string[]
  limitations: string[]
  metrics: YearMetrics[]
}

const round = (n: number) => Math.round(n)
let CUR = "AED"
const k = (n: number) => `${CUR} ${Math.round(n).toLocaleString("en-US")}`
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`

/** Weighted average favouring recent years (3:2:1). */
function maintainable(values: number[]) {
  const recent = values.slice(-3)
  const weights = recent.map((_, i) => i + 1)
  const total = weights.reduce((t, w) => t + w, 0)
  return recent.reduce((t, v, i) => t + v * weights[i], 0) / total
}

export function valueBusiness(company: Company, records: FinancialRecord[], inputs: ValuationInputs = {}): Valuation | null {
  // Valuations are in the company's base currency.
  CUR = company.baseCurrency ?? "AED"
  const all = allMetrics(records)
  if (!all.length) return null
  const year = inputs.year && all.some((m) => m.year === inputs.year) ? inputs.year : all[all.length - 1].year
  const metrics = all.filter((m) => m.year <= year)
  const latest = metrics[metrics.length - 1]
  const used = metrics.slice(-3)
  const detected = detectIndustry(`${company.businessActivity} ${company.name}`)
  const industry = (inputs.industry && [...INDUSTRIES, GENERAL].find((i) => i.key === inputs.industry)) || detected
  const industryReason = inputs.industry && inputs.industry !== detected.key
    ? `Set by you (the business activity suggests ${detected.label.toLowerCase()}).`
    : detected === GENERAL
      ? "The business activity did not match a specific sector, so general SME benchmarks are used."
      : `Identified from the licensed activity "${company.businessActivity}".`

  /* ---- earnings base ---- */
  const maintainableEbitda = maintainable(used.map((m) => m.ebitda))
  const maintainableProfit = maintainable(used.map((m) => m.netProfit))
  const revenueGrowth = cagr(used.map((m) => m.revenue))
  const lastGrowth = used.length >= 2 && used[used.length - 2].revenue > 0 ? latest.revenue / used[used.length - 2].revenue - 1 : null
  const netCash = latest.cash - latest.debt

  /* ---- discount rate: build-up method ---- */
  const companyRisk = 0.03 + (used.length < 3 ? 0.02 : 0) + (latest.netProfit <= 0 ? 0.02 : 0)
  const discountBuild = [
    { label: "Risk-free rate (US Treasury 10-year; the dirham is pegged to the dollar)", value: 0.045 },
    { label: "Equity market risk premium", value: 0.06 },
    { label: "Small private company premium", value: 0.06 },
    { label: `Company-specific risk${used.length < 3 ? " (short trading history)" : ""}${latest.netProfit <= 0 ? " (losses)" : ""}`, value: companyRisk },
  ]
  const builtRate = discountBuild.reduce((t, x) => t + x.value, 0)
  const r = inputs.discountRate ?? builtRate
  const g = inputs.terminalGrowth ?? Math.min(0.03, Math.max(0.02, (revenueGrowth ?? 0.02) / 2))

  const methods: Method[] = []

  /* ---- DCF ---- */
  const margin = latest.revenue > 0 ? maintainableEbitda / Math.max(1, maintainable(used.map((m) => m.revenue))) : 0
  const depRate = latest.revenue > 0 ? latest.depreciation / latest.revenue : 0
  const wcRate = latest.revenue > 0 ? (latest.receivables + latest.inventory - latest.payables) / latest.revenue : 0
  const startGrowth = Math.max(-0.1, Math.min(0.25, revenueGrowth ?? lastGrowth ?? 0.03))
  const projection: Valuation["projection"] = []
  const dcfAt = (rate: number, terminal: number) => {
    let revenue = latest.revenue
    let pv = 0
    let fcfLast = 0
    const rows: Valuation["projection"] = []
    for (let t = 1; t <= 5; t++) {
      const gt = startGrowth + ((terminal - startGrowth) * (t - 1)) / 4
      const next = revenue * (1 + gt)
      const ebitda = next * margin
      const dep = next * depRate
      const ebit = ebitda - dep
      const tax = Math.max(0, ebit - 375_000) * 0.09
      const capex = dep
      const deltaWc = (next - revenue) * wcRate
      const fcf = ebitda - tax - capex - deltaWc
      const discounted = fcf / Math.pow(1 + rate, t - 0.5)
      pv += discounted
      rows.push({ year: year + t, revenue: round(next), ebitda: round(ebitda), fcf: round(fcf), discounted: round(discounted) })
      revenue = next
      fcfLast = fcf
    }
    const terminalValue = (fcfLast * (1 + terminal)) / (rate - terminal)
    const pvTerminal = terminalValue / Math.pow(1 + rate, 5)
    return { ev: pv + pvTerminal, rows, pvTerminal, pv }
  }
  const profitable = maintainableEbitda > 0 && latest.revenue > 0
  if (profitable) {
    const base = dcfAt(r, g)
    projection.push(...base.rows)
    const lowCase = dcfAt(r + 0.02, Math.max(0, g - 0.01))
    const highCase = dcfAt(Math.max(g + 0.04, r - 0.02), g + 0.005)
    methods.push({
      key: "dcf",
      name: "Discounted cash flow",
      approach: "Income",
      low: lowCase.ev + netCash,
      value: base.ev + netCash,
      high: highCase.ev + netCash,
      weight: 0,
      explanation: [
        `Revenue of ${k(latest.revenue)} is projected for five years, starting at ${pct(startGrowth)} growth${revenueGrowth !== null ? ` (the ${used.length}-year compound growth)` : ""} and easing to ${pct(g)} by year five.`,
        `EBITDA margin is held at the maintainable ${pct(margin)}. Capital expenditure equals depreciation, working capital moves with sales at ${pct(wcRate)} of revenue, and corporate tax is 9% above AED 375,000.`,
        `Free cash flows are discounted at ${pct(r)} and a terminal value is added at ${pct(g)} long-term growth. The terminal value is ${pct(base.pvTerminal / Math.max(1, base.ev), 0)} of enterprise value.`,
        `Enterprise value ${k(base.ev)}, plus net cash of ${k(netCash)}, gives equity value of ${k(base.ev + netCash)}.`,
      ],
    })
  }

  /* ---- EV/EBITDA ---- */
  if (profitable) {
    const [lo, mid, hi] = industry.ebitda
    methods.push({
      key: "ebitda",
      name: "EBITDA multiple",
      approach: "Market",
      low: maintainableEbitda * lo + netCash,
      value: maintainableEbitda * mid + netCash,
      high: maintainableEbitda * hi + netCash,
      weight: 0,
      explanation: [
        `Maintainable EBITDA is ${k(maintainableEbitda)}: the weighted average of ${used.map((m) => `${m.year} ${k(m.ebitda)}`).join(", ")}, giving the latest year most weight.`,
        `Private ${industry.label.toLowerCase()} businesses of this size typically change hands at ${lo}x–${hi}x EBITDA; ${mid}x is applied.`,
        `${k(maintainableEbitda)} × ${mid} = ${k(maintainableEbitda * mid)} enterprise value, plus net cash of ${k(netCash)}.`,
      ],
    })
  }

  /* ---- Capitalised earnings ---- */
  if (maintainableProfit > 0) {
    const cap = (rate: number) => maintainableProfit / Math.max(0.02, rate - g)
    methods.push({
      key: "capitalised",
      name: "Capitalised maintainable earnings",
      approach: "Income",
      low: cap(r + 0.02),
      value: cap(r),
      high: cap(Math.max(g + 0.04, r - 0.02)),
      weight: 0,
      explanation: [
        `Maintainable net profit is ${k(maintainableProfit)} (weighted average of the last ${used.length} year${used.length === 1 ? "" : "s"}).`,
        `It is divided by the capitalisation rate of ${pct(r - g)} (discount rate ${pct(r)} less ${pct(g)} growth), a multiple of ${(1 / (r - g)).toFixed(1)}x earnings.`,
      ],
    })
  }

  /* ---- Revenue multiple ---- */
  if (latest.revenue > 0) {
    const [lo, hi] = industry.revenue
    const mid = (lo + hi) / 2
    methods.push({
      key: "revenue",
      name: "Revenue multiple",
      approach: "Market",
      low: latest.revenue * lo + netCash,
      value: latest.revenue * mid + netCash,
      high: latest.revenue * hi + netCash,
      weight: 0,
      explanation: [
        `Revenue of ${k(latest.revenue)} × ${mid.toFixed(2)}x (sector range ${lo}x–${hi}x), plus net cash of ${k(netCash)}.`,
        profitable ? "Used as a cross-check only, because profits give a better measure of value." : "Used because the business is not yet profitable, so earnings methods do not apply.",
      ],
    })
  }

  /* ---- Net assets ---- */
  methods.push({
    key: "nav",
    name: "Net asset value",
    approach: "Asset",
    low: latest.equity * 0.9,
    value: latest.equity,
    high: latest.equity,
    weight: 0,
    explanation: [
      `Total assets of ${k(latest.totalAssets)} less liabilities of ${k(latest.totalLiabilities)} = book equity of ${k(latest.equity)} at the end of ${year}.`,
      "Assets are taken at book value; receivables, inventory and fixed assets may need adjusting to realisable or market value.",
    ],
  })

  /* ---- weighting ---- */
  const set = (key: Method["key"], weight: number) => {
    const m = methods.find((x) => x.key === key)
    if (m) m.weight = weight
  }
  let basis: string
  if (industry.assetLed) {
    set("nav", 0.6)
    set("capitalised", 0.4)
    basis = "As an asset-holding business, its value lies mainly in what it owns: net assets carry 60% and capitalised earnings 40%."
  } else if (!profitable) {
    set("revenue", 0.5)
    set("nav", 0.5)
    basis = "The business is not yet generating positive EBITDA, so earnings methods are not reliable. Value is based equally on a revenue multiple and on net assets."
  } else if (used.length >= 2) {
    set("dcf", 0.35)
    set("ebitda", 0.4)
    set("capitalised", 0.25)
    basis = `With ${used.length} years of profitable results, the market EBITDA multiple carries 40%, the DCF 35% and capitalised earnings 25%. Revenue multiple and net assets are cross-checks.`
  } else {
    set("ebitda", 0.5)
    set("capitalised", 0.3)
    set("dcf", 0.2)
    basis = "Only one year of data is saved, so the market multiple carries 50%, capitalised earnings 30% and the DCF, which relies on growth trends, only 20%."
  }
  const weighted = methods.filter((m) => m.weight > 0)
  const totalWeight = weighted.reduce((t, m) => t + m.weight, 0) || 1
  const blend = (pick: (m: Method) => number) => weighted.reduce((t, m) => t + pick(m) * m.weight, 0) / totalWeight
  let value = blend((m) => m.value)
  let low = blend((m) => m.low)
  let high = blend((m) => m.high)
  const nav = latest.equity
  let floorNote = ""
  if (nav > value && nav > 0) {
    floorNote = ` Net assets of ${k(nav)} exceed the earnings-based value, so net asset value sets the floor.`
    value = nav
    low = Math.max(low, nav * 0.9)
    high = Math.max(high, nav)
  }
  value = Math.max(0, value)
  low = Math.max(0, Math.min(low, value))
  high = Math.max(high, value)

  const confidence: Valuation["confidence"] =
    used.length >= 3 && profitable && Math.abs(latest.ratios.netMargin ?? 0) < 0.6 ? "High" : used.length >= 2 && profitable ? "Medium" : "Low"

  const summary = [
    `${company.name} is valued at about ${k(value)} (range ${k(low)} to ${k(high)}) on a going-concern basis at the end of ${year}.`,
    `Sector: ${industry.label}. ${industryReason}`,
    `Data used: ${used.map((m) => m.year).join(", ")} — revenue ${k(latest.revenue)}${revenueGrowth !== null ? `, ${pct(revenueGrowth)} a year compound growth` : ""}; EBITDA ${k(latest.ebitda)} (${latest.revenue > 0 ? pct(latest.ebitda / latest.revenue) : "n/a"} margin); net profit ${k(latest.netProfit)}; net assets ${k(latest.equity)}; net cash ${k(netCash)}.`,
    `${basis}${floorNote}`,
    `Confidence: ${confidence.toLowerCase()} — ${confidence === "High" ? "three or more years of consistent profitable results." : confidence === "Medium" ? "profitable, but a short history; more years of data will narrow the range." : "limited history or no profits yet, so the range is wide."}`,
  ]
  const drivers = [
    `Each ${CUR} 100,000 of extra sustainable EBITDA adds about ${k(100_000 * industry.ebitda[1])} at the sector multiple.`,
    `A 1% lower discount rate (for example from audited accounts, recurring contracts or less dependence on the owner) adds roughly ${k(profitable ? (dcfAt(r - 0.01, g).ev - dcfAt(r, g).ev) * 0.35 + (maintainableProfit / Math.max(0.02, r - 0.01 - g) - maintainableProfit / Math.max(0.02, r - g)) * 0.25 : 0)} to the weighted value.`,
    latest.ratios.receivableDays !== null && latest.ratios.receivableDays > 60 ? `Customers take ${Math.round(latest.ratios.receivableDays)} days to pay; collecting faster releases cash and raises value.` : "Working capital is not a major drag on value.",
  ]
  const limitations = [
    "Owner and director pay are taken as recorded; if they differ from a market salary, maintainable earnings should be adjusted.",
    "One-off income or costs are not removed automatically; review the years used for unusual items.",
    "Multiples and premiums are indicative ranges for private UAE SMEs, not quotes from comparable transactions.",
    "This is an indicative estimate to support discussions. A formal valuation for a sale, dispute, bank or regulator needs an independent valuer under International Valuation Standards.",
  ]

  return {
    year,
    industry,
    industryReason,
    yearsUsed: used.map((m) => m.year),
    value: round(value),
    low: round(low),
    high: round(high),
    confidence,
    discountRate: r,
    discountBuild,
    terminalGrowth: g,
    maintainableEbitda: round(maintainableEbitda),
    maintainableProfit: round(maintainableProfit),
    netCash: round(netCash),
    methods: methods.map((m) => ({ ...m, low: round(m.low), value: round(m.value), high: round(m.high) })),
    projection,
    summary,
    drivers,
    limitations,
    metrics,
  }
}
