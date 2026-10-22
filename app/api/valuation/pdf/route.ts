import { renderToBuffer } from "@react-pdf/renderer"
import { ValuationPdf } from "@/components/valuation-pdf"
import { getCompany, logoDataUri } from "@/lib/company-store"
import { FinancialError, financialErrorResponse, financialOwner, listFinancialRecords } from "@/lib/financial-store"
import { INDUSTRIES, GENERAL, valueBusiness } from "@/lib/valuation"

export const runtime = "nodejs"

const rate = (value: string | null, min: number, max: number) => {
  if (value === null || value === "") return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) throw new FinancialError("Invalid valuation input.")
  return n
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    const companyId = query.get("companyId") ?? ""
    const year = Number(query.get("year"))
    if (!/^[a-f0-9-]{36}$/.test(companyId) || !Number.isInteger(year)) throw new FinancialError("Choose a company and a saved year.")
    const industry = query.get("industry") ?? undefined
    if (industry && ![...INDUSTRIES, GENERAL].some((i) => i.key === industry)) throw new FinancialError("Unknown industry.")
    const owner = await financialOwner()
    const company = await getCompany(owner, companyId)
    if (!company) throw new FinancialError("Company not found.", 404)
    const records = (await listFinancialRecords(owner)).filter((record) => record.clientId === companyId)
    const v = valueBusiness(company, records, {
      year,
      industry,
      discountRate: rate(query.get("discountRate"), 0.08, 0.4),
      terminalGrowth: rate(query.get("terminalGrowth"), 0, 0.05),
    })
    if (!v || v.year !== year) throw new FinancialError(`No saved data for ${year}.`, 404)
    const buffer = await renderToBuffer(ValuationPdf({ company, v, logo: await logoDataUri(owner, company) }))
    const filename = `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-Valuation-Brief-${year}`
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"`, "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
