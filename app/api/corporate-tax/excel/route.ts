import { ctReturnFromRequest } from "@/lib/ct-request"
import { ctWorkbook } from "@/lib/ct-workbook"
import { financialErrorResponse } from "@/lib/financial-store"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { company, ret, filename } = await ctReturnFromRequest(request)
    const buffer = await ctWorkbook(company, ret)
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
