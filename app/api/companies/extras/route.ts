import { z } from "zod"
import { companyExtrasSchema } from "@/lib/company"
import { ctAnswerStoreSchema } from "@/lib/ct-return"
import { vatFilingsStoreSchema, vatSettingsSchema } from "@/lib/vat-filings"
import { updateCompanyExtras } from "@/lib/company-store"
import { financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"

const bodySchema = z.object({
  id: z.string().uuid(),
  customHeads: companyExtrasSchema.shape.customHeads.optional(),
  vatOverrides: companyExtrasSchema.shape.vatOverrides.optional(),
  ctAnswers: ctAnswerStoreSchema.optional(),
  vatFilings: vatFilingsStoreSchema.refine((v) => Object.keys(v).length <= 400, "Too many VAT returns.").optional(),
  vatSettings: vatSettingsSchema.optional(),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const parsed = bodySchema.safeParse(await readJson(request))
    if (!parsed.success)
      return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
    const { id, ...fields } = parsed.data
    // Only fields that were sent are changed.
    const patch = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
    const company = await updateCompanyExtras(owner, id, patch)
    return Response.json({ company }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
