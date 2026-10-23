import "server-only"
import { getCompany, logoDataUri } from "./company-store"
import { FinancialError, financialOwner, listFinancialRecords } from "./financial-store"
import { financialPeriod } from "./company"
import { rateOn } from "./fx"
import { series } from "./fx-server"
import { buildReport } from "./report-model"
import { ratesNote, translateRecords, type YearRates } from "./translate"

/** The years' closing, average and opening rates from the base currency into another (one rate series per year). */
export async function translationRates(base: string, target: string, years: number[], yearEndMonth: number): Promise<YearRates[]> {
  return Promise.all(
    years.map(async (year) => {
      const p = financialPeriod(year, yearEndMonth)
      const before = financialPeriod(year - 1, yearEndMonth).end
      const s = await series(base, target, before, p.end)
      const inYear = Object.entries(s.rates).filter(([d]) => d >= p.start && d <= p.end).map(([, v]) => v)
      const average = inYear.length ? Math.round((inYear.reduce((t, v) => t + v, 0) / inYear.length) * 1e6) / 1e6 : rateOn(s, p.end)
      return { year, closing: rateOn(s, p.end), average, opening: rateOn(s, before), closingDate: p.end, source: s.source }
    })
  )
}

/** Loads the company and saved years named in a report request and builds the report model. */
export async function reportFromRequest(request: Request, { forDownload = false } = {}) {
  const query = new URL(request.url).searchParams
  const companyId = query.get("companyId") ?? ""
  const year = Number(query.get("year"))
  if (!/^[a-f0-9-]{36}$/.test(companyId) || !Number.isInteger(year))
    throw new FinancialError("Choose a company and a saved year.")
  const owner = await financialOwner()
  const company = await getCompany(owner, companyId)
  if (!company) throw new FinancialError("Company not found.", 404)
  let records = (await listFinancialRecords(owner)).filter((record) => record.clientId === companyId)
  // Shown in another currency on request (the books stay in the base currency).
  const base = company.baseCurrency ?? "AED"
  const target = (query.get("currency") ?? base).toUpperCase()
  let note = ""
  if (target !== base) {
    if (!["AED", "USD", "EUR", "GBP"].includes(target)) throw new FinancialError("Choose AED, USD, EUR or GBP.")
    const years = records.map((r) => r.year).filter((y) => y >= year - 2 && y <= year)
    const rates = await translationRates(base, target, years, company.ct.yearEndMonth ?? 12)
    records = translateRecords(records.filter((r) => years.includes(r.year)), target, rates)
    note = `Translated from ${base}: ${ratesNote(base, target, rates)}.${rates.some((r) => r.source === "fallback") ? " The rate service could not be reached, so approximate rates were used: download again later for exact rates." : ""}`
  }
  const current = records.find((record) => record.year === year)
  if (!current) throw new FinancialError(`No saved data for ${year}.`, 404)
  if (forDownload && current.statements.unmapped.length)
    throw new FinancialError("Classify every trial balance head in Data Input before downloading.")
  const model = buildReport(company, records, year)
  if (note) model.currencyNote = note
  // PDFs embed the logo; the on-screen view loads it by URL.
  model.logo = forDownload ? await logoDataUri(owner, company) : company.logo ? `/api/companies/logo?id=${company.id}&v=${encodeURIComponent(company.logo.updatedAt)}` : null
  const filename = `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-Financial-Statements-${year}${target !== base ? `-${target}` : ""}`
  return { model, filename, query, records }
}
