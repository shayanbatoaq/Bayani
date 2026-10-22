import { financialErrorResponse } from "@/lib/financial-store"
import { reportFromRequest } from "@/lib/report-request"

export const runtime = "nodejs"

/** Report model for the on-screen statements; the PDF and Excel files use the same model. */
export async function GET(request: Request) {
  try {
    const { model } = await reportFromRequest(request)
    return Response.json({ model }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
