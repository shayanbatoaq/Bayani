"use client"

import { useEffect, useState } from "react"
import { financialPeriod, type Company } from "@/lib/company"
import type { FinancialRecord } from "@/lib/financial-statements"
import { fetchRate } from "@/lib/fx"
import { translateRecords, type YearRates } from "@/lib/translate"

/**
 * The company's figures in another currency (AED for tax returns), translated with the closing,
 * average and opening rates of each year. Returns the records unchanged when no translation is needed.
 */
export function useTranslatedRecords(company: Company | undefined, records: FinancialRecord[], target: string) {
  const base = company?.baseCurrency ?? "AED"
  const key = company && target !== base ? `${company.id}|${target}|${records.map((r) => `${r.year}:${r.revision}`).join(",")}` : ""
  const [state, setState] = useState<{ key: string; records: FinancialRecord[]; rates: YearRates[]; error?: string } | null>(null)
  useEffect(() => {
    if (!key || !company) return
    let cancelled = false
    const yearEnd = company.ct.yearEndMonth ?? 12
    Promise.all(
      records.map(async (r) => {
        const p = financialPeriod(r.year, yearEnd)
        const before = financialPeriod(r.year - 1, yearEnd).end
        const [closing, average, opening] = await Promise.all([fetchRate(base, target, p.end), fetchRate(base, target, p.end, p.start), fetchRate(base, target, before)])
        return { year: r.year, closing: closing.rate, average: average.rate, opening: opening.rate, closingDate: closing.date, source: closing.source }
      }),
    )
      .then((rates) => !cancelled && setState({ key, records: translateRecords(records, target, rates), rates }))
      .catch((cause) => !cancelled && setState({ key, records: [], rates: [], error: cause instanceof Error ? cause.message : "No rates." }))
    return () => {
      cancelled = true
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!key) return { records, rates: [] as YearRates[], loading: false, error: "" }
  if (state?.key !== key) return { records: [] as FinancialRecord[], rates: [] as YearRates[], loading: true, error: "" }
  return { records: state.records, rates: state.rates, loading: false, error: state.error ?? "" }
}
