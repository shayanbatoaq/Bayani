import { renderToBuffer } from "@react-pdf/renderer"
import { InvoicePdf } from "@/components/invoice-pdf"
import { readBooks } from "@/lib/books-store"
import { getCompany, logoDataUri } from "@/lib/company-store"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"

export const runtime = "nodejs"

/** An invoice or credit note as a PDF. */
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    const companyId = query.get("companyId") ?? ""
    if (!/^[a-f0-9-]{36}$/.test(companyId)) throw new FinancialError("Choose a company.")
    const owner = await financialOwner()
    const company = await getCompany(owner, companyId)
    if (!company) throw new FinancialError("Company not found.", 404)
    const books = await readBooks(owner, companyId)
    const id = query.get("id") ?? ""
    const note = query.get("kind") === "credit" ? books.creditNotes.find((c) => c.id === id) : undefined
    const invoice = books.invoices.find((i) => i.id === (note ? note.invoiceId : id))
    if (!invoice || (query.get("kind") === "credit" && !note)) throw new FinancialError("Document not found.", 404)
    const buffer = await renderToBuffer(InvoicePdf({ company, books, invoice, note, logo: await logoDataUri(owner, company) }))
    const number = (note ?? invoice).number.replace(/[^A-Za-z0-9-]+/g, "-")
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${query.get("inline") ? "inline" : "attachment"}; filename="${note ? "Credit-Note" : "Invoice"}-${number}.pdf"`, "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
