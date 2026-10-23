import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { getCompany } from "@/lib/company-store"
import { aspRequestSchema, type AspRequest } from "@/lib/e-invoicing"
import { FinancialError, financialErrorResponse, financialOwner, ownerDirectory } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"

const file = (owner: string) => path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "asp-requests.json")
async function list(owner: string): Promise<AspRequest[]> {
  try {
    const parsed = JSON.parse(await readFile(file(owner), "utf8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function GET() {
  try {
    return Response.json({ requests: await list(await financialOwner()) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}

/** A request for quotes from accredited e-invoicing service providers. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const parsed = aspRequestSchema.safeParse(await readJson(request, 20_000))
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
    const company = await getCompany(owner, parsed.data.companyId)
    if (!company) throw new FinancialError("Company not found.", 404)
    const saved: AspRequest = { ...parsed.data, id: randomUUID(), companyName: company.name, createdAt: new Date().toISOString(), status: "Received" }
    const all = [saved, ...(await list(owner))].slice(0, 100)
    await mkdir(ownerDirectory(owner), { recursive: true, mode: 0o700 })
    const temporary = `${file(owner)}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(all), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, file(owner))
    const hook = process.env.FINSCOPE_ASP_WEBHOOK || process.env.FINSCOPE_AUDIT_WEBHOOK
    if (hook)
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `E-invoicing ASP quote request: ${company.name}, ${saved.invoicesPerYear} invoices and ${saved.billsPerYear} bills a year, ${saved.integration} integration, contact ${saved.contact} ${saved.email}`, request: saved }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})
    return Response.json({ request: saved }, { status: 201 })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
