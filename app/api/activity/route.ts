import { listActivity } from "@/lib/activity-store"
import { financialErrorResponse, financialOwner } from "@/lib/financial-store"

export const runtime = "nodejs"

/** The activity log, newest first; ?companyId= for one company. */
export async function GET(request: Request) {
  try {
    const owner = await financialOwner()
    const companyId = new URL(request.url).searchParams.get("companyId") ?? ""
    if (companyId && !/^[a-f0-9-]{36}$/.test(companyId)) return Response.json({ error: "Choose a company." }, { status: 400 })
    const entries = await listActivity(owner, { companyId })
    return Response.json({ entries }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
