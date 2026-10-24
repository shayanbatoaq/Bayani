import "server-only"
import { FinancialError } from "./financial-store"
import { chargeStoredAiCall, SupabaseDataError } from "./supabase/data-store"

export const aiConfigured = () => Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY)

export type AiKind = "bill" | "statement" | "document"

/** Calls a day per kind; the signed-in allowance is kept in the database (use_finscope_ai_call). */
const LOCAL_ALLOWANCE: Record<AiKind, number> = { bill: 300, statement: 300, document: 60 }
const local = new Map<string, number>()

/** Refuses the call (429) once the owner's AI allowance for today is used. */
export async function chargeAiCall(owner: string, kind: AiKind) {
  if (!aiConfigured()) return
  const stored = await chargeStoredAiCall(owner, kind).catch((error) => {
    // Until the allowance migration is applied the call is let through, loudly.
    if (error instanceof SupabaseDataError && error.code === "PGRST202") {
      console.error("AI allowance is not enforced: apply supabase/migrations/20261024090000_lock_billing_audit_trail_ai_quota.sql")
      return true
    }
    throw error
  })
  if (stored === null) {
    // Local workspaces: counted per server instance.
    const key = `${owner}:${kind}:${new Date().toISOString().slice(0, 10)}`
    const used = local.get(key) ?? 0
    if (local.size > 10_000) local.clear()
    if (used < LOCAL_ALLOWANCE[kind]) {
      local.set(key, used + 1)
      return
    }
  } else if (stored) return
  throw new FinancialError("Today's AI reading allowance is used up. Enter the details by hand, or try again tomorrow.", 429)
}
