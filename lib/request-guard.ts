import { FinancialError } from "./financial-store"

/** Reject cross-site writes: the Origin header, when present, must match the host. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    throw new FinancialError("Invalid request origin.", 403)
  }
  const host = request.headers.get("host") ?? new URL(request.url).host
  if (!["http:", "https:"].includes(originUrl.protocol) || originUrl.host !== host)
    throw new FinancialError("Invalid request origin.", 403)
}

export async function readJson(request: Request, limit = 1_000_000) {
  const text = await request.text()
  if (text.length > limit) throw new FinancialError("The request is too large.", 413)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new FinancialError("Invalid request data.")
  }
}
