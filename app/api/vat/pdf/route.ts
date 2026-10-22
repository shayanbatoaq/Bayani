import { renderToBuffer } from "@react-pdf/renderer"
import { VatReturnPdf } from "@/components/vat-return-pdf"
import { financialErrorResponse } from "@/lib/financial-store"
import { vatReturnFromRequest } from "@/lib/vat-request"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { company, ret, answers, registration, filename } = await vatReturnFromRequest(request)
    const buffer = await renderToBuffer(VatReturnPdf({ company, ret, answers, registration }))
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"`, "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
