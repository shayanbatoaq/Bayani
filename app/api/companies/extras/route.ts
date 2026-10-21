import { z } from "zod"
import { companyExtrasSchema } from "@/lib/company"
import { updateCompanyExtras } from "@/lib/company-store"
import { financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"

const bodySchema = z.object({
  id: z.string().uuid(),
  customHeads: companyExtrasSchema.shape.customHeads.optional(),
  vatOverrides: companyExtrasSchema.shape.vatOverrides.optional(),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const parsed = bodySchema.safeParse(await readJson(request))
    if (!parsed.success)
      return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
    const { id, ...patch } = parsed.data
    const company = await updateCompanyExtras(owner, id, patch)
    return Response.json({ company }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
