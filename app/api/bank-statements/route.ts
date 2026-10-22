import { bankSessionSchema } from "@/lib/bank-session"
import { clearBankSession, readBankSession, writeBankSession } from "@/lib/bank-session-store"
import { getCompany } from "@/lib/company-store"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"

async function target(request: Request) {
  const query = new URL(request.url).searchParams
  const companyId = query.get("companyId") ?? ""
  const year = Number(query.get("year"))
  if (!/^[a-f0-9-]{36}$/.test(companyId) || !Number.isInteger(year) || year < 1990 || year > 2200) throw new FinancialError("Choose a company and a year.")
  const owner = await financialOwner()
  if (!(await getCompany(owner, companyId))) throw new FinancialError("Company not found.", 404)
  return { owner, companyId, year }
}

export async function GET(request: Request) {
  try {
    const { owner, companyId, year } = await target(request)
    return Response.json({ session: await readBankSession(owner, companyId, year) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const { owner, companyId, year } = await target(request)
    const parsed = bankSessionSchema.safeParse(await readJson(request, 12_000_000))
    if (!parsed.success) return Response.json({ error: "These statement lines could not be saved." }, { status: 400 })
    await writeBankSession(owner, companyId, year, parsed.data)
    return Response.json({ saved: true })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const { owner, companyId, year } = await target(request)
    await clearBankSession(owner, companyId, year)
    return Response.json({ cleared: true })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
