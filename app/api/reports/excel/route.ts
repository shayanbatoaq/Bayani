import { financialErrorResponse } from "@/lib/financial-store"
import { reportFromRequest } from "@/lib/report-request"
import { reportWorkbook } from "@/lib/report-workbook"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { model, filename } = await reportFromRequest(request, { forDownload: true })
    const buffer = await reportWorkbook(model)
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
