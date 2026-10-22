import "server-only"
import { getCompany } from "./company-store"
import { ctReturns, readAnswerStore } from "./ct-return"
import { FinancialError, financialOwner, listFinancialRecords } from "./financial-store"

/** The saved corporate tax return for the company and year named in the request. */
export async function ctReturnFromRequest(request: Request) {
  const query = new URL(request.url).searchParams
  const companyId = query.get("companyId") ?? ""
  const year = Number(query.get("year"))
  if (!/^[a-f0-9-]{36}$/.test(companyId) || !Number.isInteger(year))
    throw new FinancialError("Choose a company and a saved year.")
  const owner = await financialOwner()
  const company = await getCompany(owner, companyId)
  if (!company) throw new FinancialError("Company not found.", 404)
  const records = (await listFinancialRecords(owner)).filter((record) => record.clientId === companyId)
  const ret = ctReturns(company, records, readAnswerStore(company.ctAnswers)).find((item) => item.year === year)
  if (!ret) throw new FinancialError(`No saved data for ${year}.`, 404)
  if (!ret.inScope) throw new FinancialError(`${year} is not subject to corporate tax.`)
  return { company, ret, filename: `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-Corporate-Tax-Return-${year}` }
}
