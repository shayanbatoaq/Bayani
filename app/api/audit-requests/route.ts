import { auditRequestInputSchema } from "@/lib/audit-request"
import { listAuditRequests, notifyAuditTeam, saveAuditRequest } from "@/lib/audit-store"
import { getCompany } from "@/lib/company-store"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"

export async function GET() {
  try {
    const owner = await financialOwner()
    return Response.json({ requests: await listAuditRequests(owner) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const parsed = auditRequestInputSchema.safeParse(await readJson(request, 20_000))
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
    const company = await getCompany(owner, parsed.data.companyId)
    if (!company) throw new FinancialError("Company not found.", 404)
    const saved = await saveAuditRequest(owner, parsed.data, company.name)
    const forwarded = await notifyAuditTeam(saved)
    return Response.json({ request: saved, forwarded }, { status: 201 })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
