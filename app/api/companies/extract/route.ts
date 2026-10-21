import { companyDocTypes, type CompanyDocType } from "@/lib/company"
import { extractCompany, type UploadedDocument } from "@/lib/document-extract"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin } from "@/lib/request-guard"

export const runtime = "nodejs"
export const maxDuration = 120

const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"]

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await financialOwner()
    const form = await request.formData()
    const documents: UploadedDocument[] = []
    for (const { key } of companyDocTypes) {
      const file = form.get(key)
      if (!(file instanceof File) || !file.size) continue
      if (file.size > 15 * 1024 * 1024)
        throw new FinancialError(`${file.name} is larger than 15 MB.`, 413)
      const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "")
      if (!allowed.includes(mime))
        throw new FinancialError(`${file.name}: upload a PDF, PNG, JPG or WEBP file.`)
      documents.push({
        type: key as CompanyDocType,
        filename: file.name,
        mime,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })
    }
    if (!documents.length) throw new FinancialError("Upload at least one document.")
    const result = await extractCompany(documents)
    return Response.json(
      {
        ...result,
        documents: documents.map(({ type, filename }) => ({ type, filename })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return financialErrorResponse(error)
  }
}
