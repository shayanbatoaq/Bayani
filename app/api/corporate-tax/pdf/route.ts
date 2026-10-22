import { renderToBuffer } from "@react-pdf/renderer"
import { CtReturnPdf } from "@/components/ct-return-pdf"
import { ctReturnFromRequest } from "@/lib/ct-request"
import { financialErrorResponse } from "@/lib/financial-store"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { company, ret, filename } = await ctReturnFromRequest(request)
    const buffer = await renderToBuffer(CtReturnPdf({ company, ret }))
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"`, "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
