import { renderToBuffer } from "@react-pdf/renderer"
import { StatementsPdf, type PageMarks } from "@/components/statements-pdf"
import { getCompany } from "@/lib/company-store"
import {
  FinancialError,
  financialErrorResponse,
  financialOwner,
  listFinancialRecords,
} from "@/lib/financial-store"
import { buildReport } from "@/lib/report-model"

export const runtime = "nodejs"

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
    const current = records.find((record) => record.year === year)
    if (!current) throw new FinancialError(`No saved data for ${year}.`, 404)
    if (current.statements.unmapped.length)
      throw new FinancialError("Classify every trial balance head in Data Input before downloading.")
    const model = buildReport(company, records, year)
    // First pass lays the document out to learn section page numbers for the index.
    const marks: PageMarks = {}
    await renderToBuffer(StatementsPdf({ model, onPage: (name, page) => (marks[name] = page) }))
    const buffer = await renderToBuffer(StatementsPdf({ model, pages: marks }))
    const filename = `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-Financial-Statements-${year}.pdf`
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${query.get("inline") ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
