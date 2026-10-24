import { z } from "zod"
import { chargeAiCall } from "@/lib/ai-allowance"
import { financialErrorResponse, financialOwner } from "@/lib/financial-store"
import { assertSameOrigin, readJson } from "@/lib/request-guard"

export const runtime = "nodejs"
export const maxDuration = 90

/**
 * Reads bank statement pages the document rules could not (scanned statements, unusual layouts)
 * with an AI model that sees the page images. It returns the table rows only; Bayani then checks
 * every line against the running balance exactly as for any other statement.
 */
const bodySchema = z.object({ images: z.array(z.string().max(3_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/)).min(1).max(4), first: z.boolean().default(false) })

export type AiStatementPage = {
  currency?: string
  account?: string
  bank?: string
  opening?: number | null
  rows: { date: string; description: string; debit: number | null; credit: number | null; balance: number | null }[]
}

function provider() {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const openAiKey = process.env.OPENAI_API_KEY
  if (!openRouterKey && !openAiKey) return null
  return openRouterKey
    ? {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        key: openRouterKey,
        model: process.env.OPENROUTER_STATEMENT_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-4.1",
        extra: { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000", "X-Title": "Bayani" } as Record<string, string>,
      }
    : { endpoint: "https://api.openai.com/v1/chat/completions", key: openAiKey!, model: process.env.OPENAI_STATEMENT_MODEL || "gpt-4.1", extra: {} }
}

const instructions = `You transcribe UAE bank statement pages into JSON. Copy every transaction line exactly as printed, in the order printed; never invent, merge, skip or reorder lines.
Return ONLY JSON: {"bank": string, "currency": "AED"|"USD"|..., "account": string (account number or IBAN, or ""), "opening": number|null (opening / brought forward balance on these pages, if printed), "rows": [{"date": "YYYY-MM-DD", "description": string, "debit": number|null, "credit": number|null, "balance": number|null}]}.
Dates on UAE statements are day/month/year. Debits are money out, credits money in, both positive numbers. Use the running balance printed on the line (negative if overdrawn, e.g. marked Dr). Skip headings, page totals and "balance carried forward" lines.`

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const owner = await financialOwner()
    const ai = provider()
    if (!ai) return Response.json({ error: "AI reading is not set up (an OpenAI or OpenRouter key is needed on the server)." }, { status: 501 })
    const parsed = bodySchema.safeParse(await readJson(request, 8_000_000))
    if (!parsed.success) return Response.json({ error: "These pages could not be read." }, { status: 400 })
    await chargeAiCall(owner, "statement")
    const response = await fetch(ai.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json", ...ai.extra },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: parsed.data.images.map((url) => ({ type: "image_url", image_url: { url, detail: "high" } })) },
        ],
      }),
      signal: AbortSignal.timeout(80_000),
    })
    if (!response.ok) return Response.json({ error: `AI reading failed (${response.status}).` }, { status: 502 })
    const raw = JSON.parse((await response.json())?.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[^0-9.\-]/g, ""))) ? Number(v.replace(/[^0-9.\-]/g, "")) : null)
    const rows = (Array.isArray(raw.rows) ? raw.rows : [])
      .map((r: Record<string, unknown>) => ({
        date: typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : "",
        description: typeof r.description === "string" ? r.description.slice(0, 500) : "",
        debit: num(r.debit),
        credit: num(r.credit),
        balance: num(r.balance),
      }))
      .filter((r) => r.date && (r.debit || r.credit))
      .slice(0, 2000)
    const page: AiStatementPage = {
      bank: typeof raw.bank === "string" ? raw.bank.slice(0, 80) : undefined,
      currency: typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : undefined,
      account: typeof raw.account === "string" ? raw.account.slice(0, 40) : undefined,
      opening: num(raw.opening),
      rows,
    }
    return Response.json({ page }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return financialErrorResponse(error)
  }
}
