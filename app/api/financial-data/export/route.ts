import { renderToBuffer } from "@react-pdf/renderer"
import { FinancialReportPdf } from "@/components/financial-report-pdf"
import {
  financialOwner,
  listFinancialRecords,
  financialErrorResponse,
  FinancialError,
} from "@/lib/financial-store"
import {
  createFinancialWorkbook,
  reportSheets,
  type ReportSheet,
} from "@/lib/financial-workbook"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    const clientId = query.get("clientId")
    const years = [
      ...new Set((query.get("years") ?? "").split(",").map(Number)),
    ]
    const selected = [...new Set((query.get("sheets") ?? "").split(","))]
    const format = query.get("format")
    if (
      !clientId ||
      !years.length ||
      years.length > 10 ||
      years.some(
        (year) => !Number.isInteger(year) || year < 1900 || year > 2200
      ) ||
      !selected.length ||
      selected.some((sheet) => !reportSheets.includes(sheet as ReportSheet)) ||
      !["xlsx", "pdf"].includes(format ?? "")
    )
      throw new FinancialError(
        "Choose a client, up to 10 saved years, and at least one statement."
      )
    const all = await listFinancialRecords(await financialOwner())
    const records = all
      .filter(
        (record) => record.clientId === clientId && years.includes(record.year)
      )
      .sort((a, b) => b.year - a.year)
    if (records.length !== years.length)
      throw new FinancialError(
        "One or more selected years are not available.",
        404
      )
    if (new Set(records.map((record) => record.currency)).size !== 1)
      throw new FinancialError("Choose years with the same reporting currency.")
    if (records.some((record) => record.statements.unmapped.length))
      throw new FinancialError(
        "Allocate every ledger to a financial schedule before downloading."
      )
    const sheets = reportSheets.filter((sheet) => selected.includes(sheet))
    const buffer =
      format === "xlsx"
        ? await createFinancialWorkbook(records, sheets)
        : await renderToBuffer(FinancialReportPdf({ records, sheets }))
    const filename = `financial-statements-${records.map((record) => record.year).join("-")}.${format}`
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
