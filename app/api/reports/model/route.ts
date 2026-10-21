import { getCompany } from "@/lib/company-store"
import {
  FinancialError,
  financialErrorResponse,
  financialOwner,
  listFinancialRecords,
} from "@/lib/financial-store"
import { buildReport } from "@/lib/report-model"

export const runtime = "nodejs"

/** Report model for the on-screen preview; the PDF is rendered from the same model. */
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    const companyId = query.get("companyId") ?? ""
    const year = Number(query.get("year"))
    if (!/^[a-f0-9-]{36}$/.test(companyId) || !Number.isInteger(year))
      throw new FinancialError("Choose a company and a saved year.")
    const owner = await financialOwner()
    const company = await getCompany(owner, companyId)
    if (!company) throw new FinancialError("Company not found.", 404)
    const records = (await listFinancialRecords(owner)).filter((record) => record.clientId === companyId)
    if (!records.some((record) => record.year === year))
      throw new FinancialError(`No saved data for ${year}.`, 404)
    return Response.json(
      { model: buildReport(company, records, year) },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return financialErrorResponse(error)
  }
}
