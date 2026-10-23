import { readAttachment, removeAttachment, saveAttachment } from "@/lib/books-store"
import { getCompany } from "@/lib/company-store"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin } from "@/lib/request-guard"

export const runtime = "nodejs"

// Hosted functions accept requests of about 4.5 MB; photos are reduced in the browser before upload.
const LIMIT = 4 * 1024 * 1024
const TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"])

async function target(companyId: string | null) {
  if (!companyId || !/^[a-f0-9-]{36}$/.test(companyId)) throw new FinancialError("Choose a company.")
  const owner = await financialOwner()
  if (!(await getCompany(owner, companyId))) throw new FinancialError("Company not found.", 404)
  return { owner, companyId }
}

/** Keeps a bill's document with the company. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const form = await request.formData()
    const { owner, companyId } = await target(String(form.get("companyId") ?? ""))
    const file = form.get("file")
    if (!(file instanceof File)) throw new FinancialError("Choose a file.")
    if (file.size > LIMIT) throw new FinancialError("Documents can be up to 4 MB. Save a smaller PDF, or take a photo instead.", 413)
    if (!TYPES.has(file.type)) throw new FinancialError("Attach a PDF or a photo (PNG, JPG, WEBP).")
    const id = await saveAttachment(owner, companyId, Buffer.from(await file.arrayBuffer()), file.type)
    return Response.json({ attachment: { id, name: file.name.slice(0, 200), type: file.type, size: file.size } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    const { owner, companyId } = await target(query.get("companyId"))
    const { bytes, type } = await readAttachment(owner, companyId, query.get("id") ?? "")
    const name = (query.get("name") ?? "document").replace(/[^\w. -]/g, "_")
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": type, "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ error: "Attachment not found." }, { status: 404 })
    return financialErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const query = new URL(request.url).searchParams
    const { owner, companyId } = await target(query.get("companyId"))
    await removeAttachment(owner, companyId, query.get("id") ?? "")
    return Response.json({ removed: true })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
