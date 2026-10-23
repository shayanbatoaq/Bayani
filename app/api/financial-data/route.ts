import { financialInputSchema } from "@/lib/financial-validation"
import {
  financialOwner,
  listFinancialRecords,
  saveFinancialRecord,
  financialErrorResponse,
  FinancialError,
} from "@/lib/financial-store"
import { assertSameOrigin } from "@/lib/request-guard"

export const runtime = "nodejs"

export async function GET() {
  try {
    const owner = await financialOwner()
    return Response.json(
      {
        records: await listFinancialRecords(owner),
        storage: "server",
        localWorkspace: owner.startsWith("local:"),
      },
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
    const text = await request.text()
    if (text.length > 4_000_000)
      throw new FinancialError("The financial record is too large.", 413)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new FinancialError("Invalid financial data.")
    }
    // Rows from invoices, bills and adjustments are rebuilt from the books, never saved here.
    if (body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows))
      (body as { rows: { id?: unknown }[] }).rows = (body as { rows: { id?: unknown }[] }).rows.filter(
        (row) => !(typeof row?.id === "string" && row.id.startsWith("books-"))
      )
    const parsed = financialInputSchema.safeParse(body)
    if (!parsed.success)
      return Response.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    const { revision, ...input } = parsed.data
    return Response.json(
      { record: await saveFinancialRecord(owner, input, revision) },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return financialErrorResponse(error)
  }
}
