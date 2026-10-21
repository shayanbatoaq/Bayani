import { renderToBuffer } from "@react-pdf/renderer"
import { StatementsPdf, type PageMarks } from "@/components/statements-pdf"
import { financialErrorResponse } from "@/lib/financial-store"
import { reportFromRequest } from "@/lib/report-request"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { model, filename, query } = await reportFromRequest(request, { forDownload: true })
    // First pass lays the document out to learn section page numbers for the index.
    const marks: PageMarks = {}
    await renderToBuffer(StatementsPdf({ model, onPage: (name, page) => (marks[name] = page) }))
    const buffer = await renderToBuffer(StatementsPdf({ model, pages: marks }))
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${query.get("inline") ? "inline" : "attachment"}; filename="${filename}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
