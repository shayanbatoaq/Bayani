import "server-only"
import { AED_PER_USD, ECB, FALLBACK_AED_PER, PEGGED_AED_PER, round6, type RateQuote, type RateSeries, type RateSource } from "./fx"

/**
 * AED per unit of a currency for each day of a period: fixed for AED, USD and the pegged Gulf
 * currencies, European Central Bank reference rates (via frankfurter.dev, crossed through the
 * dollar peg) for the others, an approximate value marked "fallback" when nothing can be fetched.
 */
type AedSeries = { source: RateSource; rates: Record<string, number> }
const cache = new Map<string, Promise<AedSeries>>()
const today = () => new Date().toISOString().slice(0, 10)
const back = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function aedSeries(currency: string, start: string, end: string): Promise<AedSeries> {
  if (PEGGED_AED_PER[currency]) return Promise.resolve({ source: "peg", rates: { [start]: PEGGED_AED_PER[currency] } })
  const s = start > today() ? today() : start
  const e = end > today() ? today() : end
  const key = `${currency}:${s}:${e}`
  if (!cache.has(key))
    cache.set(
      key,
      (async (): Promise<AedSeries> => {
        if (!ECB.includes(currency)) {
          if (FALLBACK_AED_PER[currency]) return { source: "fallback", rates: { [s]: FALLBACK_AED_PER[currency] } }
          throw new Error("Unsupported currency")
        }
        try {
          // A week before the start, so the first days (often a weekend) have the last published rate.
          const r = await fetch(`https://api.frankfurter.dev/v1/${back(s, 7)}..${e}?base=USD&symbols=${currency}`, { signal: AbortSignal.timeout(8000) })
          if (!r.ok) throw new Error(String(r.status))
          const d = (await r.json()) as { rates: Record<string, Record<string, number>> }
          const rates: Record<string, number> = {}
          for (const [date, row] of Object.entries(d.rates)) if (row[currency]) rates[date] = round6(AED_PER_USD / row[currency])
          if (!Object.keys(rates).length) throw new Error("no rates")
          return { source: "ECB", rates }
        } catch {
          cache.delete(key)
          if (FALLBACK_AED_PER[currency]) return { source: "fallback", rates: { [s]: FALLBACK_AED_PER[currency] } }
          throw new Error("No rate")
        }
      })(),
    )
  return cache.get(key)!
}

const at = (series: AedSeries, date: string) => {
  const days = Object.keys(series.rates).sort()
  let v = series.rates[days[0]]
  for (const d of days) {
    if (d > date) break
    v = series.rates[d]
  }
  return v
}
const worst = (a: RateSource, b: RateSource): RateSource => (a === "fallback" || b === "fallback" ? "fallback" : a === "ECB" || b === "ECB" ? "ECB" : "peg")

/** Units of `to` per unit of `from`, for every day from start to end. */
export async function series(from: string, to: string, start: string, end: string): Promise<RateSeries> {
  const [a, b] = await Promise.all([aedSeries(from, start, end), aedSeries(to, start, end)])
  const days = new Set([...Object.keys(a.rates), ...Object.keys(b.rates), start])
  const rates: Record<string, number> = {}
  for (const d of [...days].sort()) if (d >= back(start, 7) && d <= end) rates[d] = round6(at(a, d) / at(b, d))
  return { from, to, source: worst(a.source, b.source), rates }
}

export async function quote(from: string, to: string, date: string, average?: { start: string }): Promise<RateQuote> {
  if (from === to) return { from, to, rate: 1, date, source: "peg" }
  if (average) {
    const s = await series(from, to, average.start, date)
    const values = Object.entries(s.rates).filter(([d]) => d >= average.start).map(([, v]) => v)
    const rate = values.length ? round6(values.reduce((t, v) => t + v, 0) / values.length) : 0
    return { from, to, rate, date, source: s.source, average: true }
  }
  const s = await series(from, to, date, date)
  return { from, to, rate: at({ source: s.source, rates: s.rates }, date), date, source: s.source }
}
