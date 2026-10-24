import { listActivity, listChanges } from "@/lib/activity-store"
import { financialErrorResponse, financialOwner } from "@/lib/financial-store"

export const runtime = "nodejs"

/** The activity log, newest first; ?companyId= for one company, ?view=changes for the database's own change record. */
export async function GET(request: Request) {
  try {
    const owner = await financialOwner()
    const query = new URL(request.url).searchParams
    const companyId = query.get("companyId") ?? ""
    if (companyId && !/^[a-f0-9-]{36}$/.test(companyId)) return Response.json({ error: "Choose a company." }, { status: 400 })
    if (query.get("view") === "changes")
      return Response.json({ changes: await listChanges(owner, { companyId }), recorded: owner.startsWith("user:") }, { headers: { "Cache-Control": "private, no-store" } })
    const entries = await listActivity(owner, { companyId })
    return Response.json({ entries }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
