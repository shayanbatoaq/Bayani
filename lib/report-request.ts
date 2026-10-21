import "server-only"
import { getCompany } from "./company-store"
import { FinancialError, financialOwner, listFinancialRecords } from "./financial-store"
import { buildReport } from "./report-model"

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
  const records = (await listFinancialRecords(owner)).filter((record) => record.clientId === companyId)
  const current = records.find((record) => record.year === year)
  if (!current) throw new FinancialError(`No saved data for ${year}.`, 404)
  if (forDownload && current.statements.unmapped.length)
    throw new FinancialError("Classify every trial balance head in Data Input before downloading.")
  const model = buildReport(company, records, year)
  const filename = `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-Financial-Statements-${year}`
  return { model, filename, query }
}
