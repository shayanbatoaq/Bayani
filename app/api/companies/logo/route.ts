import { deleteCompanyLogo, getCompany, readCompanyLogo, saveCompanyLogo } from "@/lib/company-store"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin } from "@/lib/request-guard"

export const runtime = "nodejs"

const idOf = (value: unknown) => {
  const id = typeof value === "string" ? value : ""
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new FinancialError("Choose a company.")
  return id
}

export async function GET(request: Request) {
  try {
    const owner = await financialOwner()
    const company = await getCompany(owner, idOf(new URL(request.url).searchParams.get("id")))
    if (!company) throw new FinancialError("Company not found.", 404)
    const logo = await readCompanyLogo(owner, company)
    if (!logo) throw new FinancialError("No logo.", 404)
    return new Response(new Uint8Array(logo.bytes), {
      headers: { "Content-Type": `image/${logo.type}`, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) throw new FinancialError("Choose an image file.")
    if (file.size > 1024 * 1024) throw new FinancialError("The logo must be 1 MB or smaller.", 413)
    const company = await saveCompanyLogo(owner, idOf(form.get("id")), Buffer.from(await file.arrayBuffer()))
    return Response.json({ company }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const company = await deleteCompanyLogo(owner, idOf(new URL(request.url).searchParams.get("id")))
    return Response.json({ company }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
