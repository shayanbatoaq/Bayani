import "server-only"
import { FinancialError } from "./financial-store"

export const aiConfigured = () => Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY)

export type AiKind = "bill" | "statement" | "document"

/** Calls a day per owner and kind, counted per server instance. */
const ALLOWANCE: Record<AiKind, number> = { bill: 300, statement: 300, document: 60 }
const used = new Map<string, number>()

/** Refuses the call (429) once the owner's AI allowance for today is used. */
export async function chargeAiCall(owner: string, kind: AiKind) {
  if (!aiConfigured()) return
  const key = `${owner}:${kind}:${new Date().toISOString().slice(0, 10)}`
  const count = used.get(key) ?? 0
  if (count >= ALLOWANCE[kind])
    throw new FinancialError("Today's AI reading allowance is used up. Enter the details by hand, or try again tomorrow.", 429)
  if (used.size > 10_000) used.clear()
  used.set(key, count + 1)
}
