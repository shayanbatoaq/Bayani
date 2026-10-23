/**
 * Exchange rates. AED is pegged to the US dollar at 3.6725 (Central Bank of the UAE); USD,
 * EUR and GBP cross rates are the European Central Bank reference rates. Every rate used is
 * shown to the user and can be changed.
 */
export const CURRENCIES = ["AED", "USD", "EUR", "GBP"] as const
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6
export type Currency = (typeof CURRENCIES)[number]
export const CURRENCY_NAMES: Record<string, string> = { AED: "UAE dirham", USD: "US dollar", EUR: "Euro", GBP: "British pound" }
export const AED_PER_USD = 3.6725

/** Units of `to` for one unit of `from`, given AED values of one unit of each currency. */
export function crossRate(from: string, to: string, aedPer: Record<string, number>) {
  if (from === to) return 1
  const a = from === "AED" ? 1 : aedPer[from]
  const b = to === "AED" ? 1 : aedPer[to]
  if (!a || !b) return 0
  return round6(a / b)
}
/** To the fils, rounding halves up reliably (3856.125 → 3856.13, which binary floating point would round down). */
export const round2 = (n: number) => (Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toPrecision(15)))) / 100 || 0

/** Gulf currencies fixed to the US dollar (central bank pegs), as AED per unit. */
export const PEGGED_AED_PER: Record<string, number> = {
  AED: 1,
  USD: AED_PER_USD,
  SAR: round6(AED_PER_USD / 3.75),
  QAR: round6(AED_PER_USD / 3.64),
  OMR: round6(AED_PER_USD / 0.3845),
  BHD: round6(AED_PER_USD / 0.376),
}
/** Currencies with European Central Bank reference rates. */
export const ECB = ["EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "HKD", "INR", "SGD", "TRY", "SEK", "NOK", "DKK", "NZD", "ZAR", "PLN", "CZK", "HUF", "KRW", "MYR", "PHP", "THB", "IDR", "BRL", "MXN", "ILS"]
/** Approximate values used only when no rate can be fetched; marked as approximate for the user to check. */
export const FALLBACK_AED_PER: Record<string, number> = { ...PEGGED_AED_PER, EUR: 4.3, GBP: 4.95, KWD: 12.0, PKR: 0.013, EGP: 0.075, INR: 0.042, CHF: 4.5, JPY: 0.024, CNY: 0.51, CAD: 2.65, AUD: 2.4, TRY: 0.09, SGD: 2.8, HKD: 0.47 }

export type RateSource = "ECB" | "peg" | "fallback" | "user"
export type RateQuote = { from: string; to: string; rate: number; date: string; source: RateSource; average?: boolean }
/** Units of `to` per unit of `from` for each day (weekends and holidays carry the last rate). */
export type RateSeries = { from: string; to: string; source: RateSource; rates: Record<string, number> }

/** The rate on a date from a series: that day's, else the last one before it, else the first. */
export function rateOn(series: RateSeries | undefined, date: string) {
  if (!series) return 0
  if (series.rates[date]) return series.rates[date]
  const days = Object.keys(series.rates).sort()
  let found = 0
  for (const d of days) {
    if (d > date) break
    found = series.rates[d]
  }
  return found || series.rates[days[0]] || 0
}

export function rateLabel(q: Pick<RateQuote, "from" | "to" | "rate">) {
  return `1 ${q.from} = ${q.rate.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${q.to}`
}

export function money(n: number, currency?: string, digits = 2) {
  const v = (Math.round(n * 100) / 100 || 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return currency ? `${currency} ${v}` : v
}

/** Reads a currency mentioned on a document (code, symbol or name); AED when nothing else is shown. */
export function currencyIn(text: string): Currency | null {
  const t = text.replace(/\s+/g, " ")
  const count = (re: RegExp) => (t.match(re) ?? []).length
  const scores: [Currency, number][] = [
    ["AED", count(/\b(AED|DHS?|dirhams?)\b|د\.إ/gi)],
    ["USD", count(/\bUSD\b|US\$|\$\s?\d|\bUS dollars?\b/gi)],
    ["EUR", count(/\bEUR\b|€|\beuros?\b/gi)],
    ["GBP", count(/\bGBP\b|£|\bpounds? sterling\b/gi)],
  ]
  const best = scores.sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : null
}

/** Browser: the rate for a date, or the average over start..date. */
export async function fetchRate(from: string, to: string, date: string, start?: string): Promise<RateQuote> {
  if (from === to) return { from, to, rate: 1, date, source: "peg" }
  const q = new URLSearchParams({ from, to, date })
  if (start) q.set("start", start)
  const r = await fetch(`/api/fx?${q}`)
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || "No rate.")
  return d.quote
}

export async function fetchSeries(from: string, to: string, start: string, end: string): Promise<RateSeries> {
  if (from === to) return { from, to, source: "peg", rates: { [start]: 1 } }
  const r = await fetch(`/api/fx?${new URLSearchParams({ from, to, start, date: end, series: "1" })}`)
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || "No rates.")
  return d.series
}
