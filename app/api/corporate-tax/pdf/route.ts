import { renderToBuffer } from "@react-pdf/renderer"
import { CtReturnPdf } from "@/components/ct-return-pdf"
import { logoDataUri } from "@/lib/company-store"
import { ctReturnFromRequest } from "@/lib/ct-request"
import { financialErrorResponse } from "@/lib/financial-store"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { company, ret, filename, owner } = await ctReturnFromRequest(request)
    const buffer = await renderToBuffer(CtReturnPdf({ company, ret, logo: await logoDataUri(owner, company) }))
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"`, "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
