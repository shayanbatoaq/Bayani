import { z } from "zod"
import { readBill, type BillCheck, type BillFields } from "@/lib/bill-rules"
import { normaliseDate } from "@/lib/document-rules"
import { chargeAiCall } from "@/lib/ai-allowance"
import { FinancialError, financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"
export const maxDuration = 90

/** The document is read in the browser (text layer or OCR); its text, and a photo when it is one, come here. */
const bodySchema = z.object({
  text: z.string().max(400_000),
  images: z.array(z.string().max(3_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/)).max(3).default([]),
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
Read the figures exactly as printed. "net" is the total before VAT for the whole bill (sub total / taxable amount), "vat" the total VAT for the whole bill, "total" the bill total including VAT (before deducting any advance or payment). Ignore tax summary tables that repeat the taxable amount. Check that net + vat = total.
Return ONLY JSON: {"supplier": string, "vendorTrn": string (15 digits), "date": "YYYY-MM-DD", "number": string (bill / invoice / receipt number), "net": number (amount before VAT), "vat": number, "total": number (amount with VAT), "payment": "cash"|"card"|"bank"|"credit"|"", "currency": "AED"|"USD"|"EUR"|"GBP"|other ISO code, "description": string (what was bought, short), "expenseHead": string (choose the closest of: ${body.heads.slice(0, 120).join("; ")})}.
Use "" or omit a key when the document does not show it; never guess numbers. UAE numeric dates are day/month/year. Amounts in AED.`
  const content: unknown[] = [{ type: "text", text: body.text.slice(0, 40_000) || "(no text layer)" }]
  for (const url of body.images) content.push({ type: "image_url", image_url: { url, detail: "high" } })
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
  if (/^[A-Z]{3}$/.test(s(raw.currency))) out.currency = s(raw.currency)
  if (s(raw.description)) out.description = s(raw.description).slice(0, 500)
  const head = body.heads.find((h) => h.toLowerCase() === s(raw.expenseHead).toLowerCase())
  if (head) out.ledgerName = head
  return out
}

const adds = (f: BillFields) => f.net !== undefined && f.vat !== undefined && f.total !== undefined && Math.abs(f.net + f.vat - f.total) < 0.05
/** A reading whose figures hold together: they add up, and the VAT is 5% of the amount before it (or nil). */
const holds = (f: BillFields) => adds(f) && f.net! > 0 && (Math.abs(f.vat! - f.net! * 0.05) <= Math.max(0.06, f.net! * 0.0002) || f.vat === 0)
const same = (a: BillFields, b: BillFields) => (["net", "vat", "total"] as const).every((k) => a[k] !== undefined && b[k] !== undefined && Math.abs(a[k]! - b[k]!) < 0.02)

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const parsed = bodySchema.safeParse(await readJson(request, 8_000_000))
    if (!parsed.success) return Response.json({ error: "This document could not be read." }, { status: 400 })
    // Past the day's AI allowance the document rules still read the bill.
    const useAi = await chargeAiCall(owner, "bill").then(() => true, (error) => (error instanceof FinancialError && error.status === 429 ? false : Promise.reject(error)))
    const { check: ruleCheck, ...rules } = readBill(parsed.data.text, { ownTrn: parsed.data.ownTrn, ownName: parsed.data.ownName })
    let ai: BillFields | null = null
    let status: "used" | "unavailable" | "failed" = "unavailable"
    try {
      ai = useAi ? await readWithAi(parsed.data) : null
      if (ai) status = "used"
    } catch (error) {
      console.error("AI bill reading failed", error)
      status = "failed"
    }
    const fields: BillFields = { ...rules }
    const sources: Record<string, "document" | "AI"> = Object.fromEntries(Object.keys(rules).map((k) => [k, "document"]))
    const check: BillCheck = { amounts: ruleCheck.amounts, notes: [...ruleCheck.notes] }
    if (ai) {
      // AI is an aid: it fills what the document rules did not find and never overrides them.
      const differs: string[] = []
      for (const key of ["supplier", "vendorTrn", "date", "number", "payment", "description", "ledgerName", "currency"] as const)
        if (ai[key] === undefined) continue
        else if (fields[key] === undefined) {
          ;(fields as Record<string, unknown>)[key] = ai[key]
          sources[key] = "AI"
        } else if (String(fields[key]).toLowerCase() !== String(ai[key]).toLowerCase()) differs.push(key)
      if (sources.ledgerName === "AI") delete fields.scheduleKey
      if (differs.length) check.notes.push(`The AI reading differs from the document on: ${differs.join(", ")}. The document's reading is kept; check it.`)
      // Figures: only the document rules can prove them. AI figures are suggestions the user confirms.
      const rulesProven = ruleCheck.amounts === "proven"
      if (rulesProven && holds(ai) && !same(rules, ai)) {
        check.amounts = "partial"
        check.notes = [`Two readings of the amounts differ: the document's figures give ${rules.net} + ${rules.vat} = ${rules.total}, the AI reading ${ai.net} + ${ai.vat} = ${ai.total}. Check which is right.`]
      } else if (!rulesProven && holds(ai)) {
        for (const key of ["net", "vat", "total"] as const) {
          fields[key] = ai[key]
          sources[key] = "AI"
        }
        check.amounts = "partial"
        check.notes = ["Amounts suggested by AI from the page. They add up, but they were not found in the document's text: check them against the document."]
      } else if (rulesProven && same(rules, ai)) check.notes.push("The document's figures and the AI reading agree.")
    } else if (status === "failed") check.notes.push("The AI reading was not available this time; the document rules were used.")
    else if (!useAi) check.notes.push("Today's AI reading allowance is used up; the document rules were used.")
    for (const key of Object.keys(fields) as (keyof BillFields)[]) if (fields[key] === undefined) delete fields[key]
    return Response.json({ fields, sources, ai: status, check }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
