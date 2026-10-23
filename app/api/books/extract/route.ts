import { z } from "zod"
import { readBill, type BillFields } from "@/lib/bill-rules"
import { normaliseDate } from "@/lib/document-rules"
import { financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"
export const maxDuration = 90

/** The document is read in the browser (text layer or OCR); its text, and a photo when it is one, come here. */
const bodySchema = z.object({
  text: z.string().max(400_000),
  image: z.string().max(6_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/).optional(),
  ownTrn: z.string().max(20).optional(),
  ownName: z.string().max(200).optional(),
  heads: z.array(z.string().max(120)).max(400).default([]),
})

function provider() {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const openAiKey = process.env.OPENAI_API_KEY
  if (!openRouterKey && !openAiKey) return null
  return openRouterKey
    ? {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        key: openRouterKey,
        model: process.env.OPENROUTER_EXTRACT_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        extra: { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000", "X-Title": "Bayani" } as Record<string, string>,
      }
    : { endpoint: "https://api.openai.com/v1/chat/completions", key: openAiKey!, model: process.env.OPENAI_EXTRACT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini", extra: {} }
}

async function readWithAi(body: z.infer<typeof bodySchema>): Promise<BillFields | null> {
  const ai = provider()
  if (!ai) return null
  const instructions = `You read supplier bills, purchase invoices and receipts for a UAE business${body.ownName ? ` called "${body.ownName}"` : ""} (the buyer; never return the buyer as the supplier${body.ownTrn ? ` and never return TRN ${body.ownTrn}` : ""}).
Return ONLY JSON: {"supplier": string, "vendorTrn": string (15 digits), "date": "YYYY-MM-DD", "number": string (bill / invoice / receipt number), "net": number (amount before VAT), "vat": number, "total": number (amount with VAT), "payment": "cash"|"card"|"bank"|"credit"|"", "description": string (what was bought, short), "expenseHead": string (choose the closest of: ${body.heads.slice(0, 120).join("; ")})}.
Use "" or omit a key when the document does not show it; never guess numbers. UAE numeric dates are day/month/year. Amounts in AED.`
  const content: unknown[] = [{ type: "text", text: body.text.slice(0, 40_000) || "(no text layer)" }]
  if (body.image) content.push({ type: "image_url", image_url: { url: body.image } })
  const response = await fetch(ai.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json", ...ai.extra },
    body: JSON.stringify({ model: ai.model, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: instructions }, { role: "user", content }] }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`AI reading failed (${response.status})`)
  const raw = JSON.parse((await response.json())?.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[^0-9.\-]/g, ""))) ? Number(v.replace(/[^0-9.\-]/g, "")) : undefined)
  const out: BillFields = {}
  if (s(raw.supplier)) out.supplier = s(raw.supplier)
  const trn = s(raw.vendorTrn).replace(/\D/g, "")
  if (/^\d{15}$/.test(trn) && trn !== body.ownTrn) out.vendorTrn = trn
  if (normaliseDate(raw.date)) out.date = normaliseDate(raw.date)
  if (s(raw.number)) out.number = s(raw.number).slice(0, 60)
  for (const key of ["net", "vat", "total"] as const) if (n(raw[key]) !== undefined) out[key] = n(raw[key])
  if (["cash", "card", "bank", "credit"].includes(s(raw.payment))) out.payment = s(raw.payment) as BillFields["payment"]
  if (s(raw.description)) out.description = s(raw.description).slice(0, 500)
  const head = body.heads.find((h) => h.toLowerCase() === s(raw.expenseHead).toLowerCase())
  if (head) out.ledgerName = head
  return out
}

const adds = (f: BillFields) => f.net !== undefined && f.vat !== undefined && f.total !== undefined && Math.abs(f.net + f.vat - f.total) < 0.05

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    await financialOwner()
    const parsed = bodySchema.safeParse(await readJson(request, 8_000_000))
    if (!parsed.success) return Response.json({ error: "This document could not be read." }, { status: 400 })
    const rules = readBill(parsed.data.text, { ownTrn: parsed.data.ownTrn, ownName: parsed.data.ownName })
    let ai: BillFields | null = null
    let status: "used" | "unavailable" | "failed" = "unavailable"
    try {
      ai = await readWithAi(parsed.data)
      if (ai) status = "used"
    } catch (error) {
      console.error("AI bill reading failed", error)
      status = "failed"
    }
    const fields: BillFields = { ...rules }
    const sources: Record<string, "document" | "AI"> = Object.fromEntries(Object.keys(rules).map((k) => [k, "document"]))
    if (ai) {
      // The AI reading is preferred for words; figures are taken from it unless the document's own figures add up.
      for (const key of ["supplier", "vendorTrn", "date", "number", "payment", "description", "ledgerName"] as const)
        if (ai[key] !== undefined) {
          ;(fields as Record<string, unknown>)[key] = ai[key]
          sources[key] = "AI"
        }
      if (!adds(rules) && (adds(ai) || ai.total !== undefined))
        for (const key of ["net", "vat", "total"] as const)
          if (ai[key] !== undefined) {
            fields[key] = ai[key]
            sources[key] = "AI"
          }
      if (ai.ledgerName) fields.scheduleKey = undefined
    }
    return Response.json({ fields, sources, ai: status }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
