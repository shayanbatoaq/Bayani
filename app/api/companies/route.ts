import { z } from "zod"
import { companyDraftSchema } from "@/lib/company"
import { companyLimit, deleteCompany, listCompanies, saveCompany } from "@/lib/company-store"
import { financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"

const bodySchema = z.object({
  id: z.string().uuid().optional(),
  revision: z.number().int().nonnegative().optional(),
  draft: companyDraftSchema,
  documents: z
    .array(
      z.object({
        type: z.enum(["tradeLicense", "moa", "vatCertificate", "ctCertificate"]),
        filename: z.string().max(255),
      })
    )
    .max(8)
    .optional(),
})

export async function GET() {
  try {
    const owner = await financialOwner()
    return Response.json(
      { companies: await listCompanies(owner), limit: companyLimit() },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return financialErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const parsed = bodySchema.safeParse(await readJson(request))
    if (!parsed.success)
      return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
    const now = new Date().toISOString()
    const company = await saveCompany(owner, {
      ...parsed.data,
      documents: parsed.data.documents?.map((doc) => ({ ...doc, uploadedAt: now })),
    })
    return Response.json({ company }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const id = new URL(request.url).searchParams.get("id") ?? ""
    if (!z.string().uuid().safeParse(id).success)
      return Response.json({ error: "Choose a company to delete." }, { status: 400 })
    await deleteCompany(owner, id)
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
