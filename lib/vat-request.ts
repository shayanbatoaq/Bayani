import "server-only"
import { getCompany } from "./company-store"
import { FinancialError, financialOwner, listFinancialRecords } from "./financial-store"
import { readVatAnswers, registrationCheck, vatReturns } from "./vat-return"

/** The saved VAT 201 estimate for the company and period named in the request. */
export async function vatReturnFromRequest(request: Request) {
  const query = new URL(request.url).searchParams
  const companyId = query.get("companyId") ?? ""
  const periodId = query.get("period") ?? ""
  if (!/^[a-f0-9-]{36}$/.test(companyId) || !/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(periodId))
    throw new FinancialError("Choose a company and a VAT period.")
  const owner = await financialOwner()
  const company = await getCompany(owner, companyId)
  if (!company) throw new FinancialError("Company not found.", 404)
  const records = (await listFinancialRecords(owner)).filter((record) => record.clientId === companyId)
  const answers = readVatAnswers(company.vatAnswers)
  const ret = vatReturns(company, records, answers).find((item) => item.period.id === periodId)
  if (!ret) throw new FinancialError("This VAT period was not found.", 404)
  return { company, ret, answers, registration: registrationCheck(company, records, answers), filename: `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-VAT-201-${ret.period.end}` }
}
