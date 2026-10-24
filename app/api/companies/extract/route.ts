import { z } from "zod"
import { extractCompany } from "@/lib/document-extract"
import { chargeAiCall } from "@/lib/ai-allowance"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"
export const maxDuration = 120

/** Documents are read in the browser (text layer or OCR); only their text is sent here. */
const bodySchema = z.object({
  documents: z
    .array(
      z.object({
        type: z.enum(["tradeLicense", "moa", "vatCertificate", "ctCertificate"]),
        filename: z.string().max(255).optional(),
        text: z.string().max(600_000),
      })
    )
    .min(1, "Upload at least one document.")
    .max(8),
})

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const parsed = bodySchema.safeParse(await readJson(request, 3_000_000))
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
    // Past the day's AI allowance the document rules still read the documents.
    const useAi = await chargeAiCall(owner, "document").then(() => true, (error) => (error instanceof FinancialError && error.status === 429 ? false : Promise.reject(error)))
    const report = await extractCompany(parsed.data.documents, useAi)
    return Response.json(
      { ...report, documents: report.documents.map(({ type, filename, detected, authority }) => ({ type, filename: filename ?? "", detected, authority })) },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return financialErrorResponse(error)
  }
}
