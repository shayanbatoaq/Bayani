import { financialErrorResponse } from "@/lib/financial-store"
import { vatReturnFromRequest } from "@/lib/vat-request"
import { vatWorkbook } from "@/lib/vat-workbook"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { company, ret, registration, filename } = await vatReturnFromRequest(request)
    const buffer = await vatWorkbook(company, ret, registration)
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
