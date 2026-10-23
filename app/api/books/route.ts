import { z } from "zod"
import { booksActionSchema } from "@/lib/books"
import { readBooks, updateBooks } from "@/lib/books-store"
import { getCompany } from "@/lib/company-store"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"

const companyIdSchema = z.string().regex(/^[a-f0-9-]{36}$/)

async function company(companyId: unknown) {
  const parsed = companyIdSchema.safeParse(companyId)
  if (!parsed.success) throw new FinancialError("Choose a company.")
  const owner = await financialOwner()
  if (!(await getCompany(owner, parsed.data))) throw new FinancialError("Company not found.", 404)
  return { owner, companyId: parsed.data }
}

export async function GET(request: Request) {
  try {
    const { owner, companyId } = await company(new URL(request.url).searchParams.get("companyId"))
    return Response.json({ books: await readBooks(owner, companyId) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

const bodySchema = z.object({ companyId: z.string(), revision: z.number().int().nonnegative(), change: booksActionSchema })

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const parsed = bodySchema.safeParse(await readJson(request, 2_000_000))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return Response.json({ error: issue?.message && !/^Invalid/.test(issue.message) ? issue.message : "Some details are missing or not valid." }, { status: 400 })
    }
    const { owner, companyId } = await company(parsed.data.companyId)
    const books = await updateBooks(owner, companyId, parsed.data.revision, parsed.data.change)
    return Response.json({ books })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
