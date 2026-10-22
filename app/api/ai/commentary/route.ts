import { buildAiCommentaryPayload } from "@/lib/calculations"

export const runtime = "nodejs"

const fallbackCommentary =
  "Indicative CFO commentary: the calculated outputs show a strong operating base, with tax, VAT, audit, and related-party documentation requiring professional review. This is not professional advice."

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const payload = body?.calculatedOutputs ? body : buildAiCommentaryPayload()
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const openAiKey = process.env.OPENAI_API_KEY
  const apiKey = openRouterKey || openAiKey

  if (!apiKey) {
    return Response.json({
      commentary: fallbackCommentary,
      source: "demo",
      guardrail: "AI did not calculate financial, tax, VAT, audit, or valuation outputs.",
    })
  }

  const endpoint = openRouterKey
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions"
  const model = openRouterKey
    ? process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini"
    : process.env.OPENAI_MODEL || "gpt-4.1-mini"

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(openRouterKey
        ? {
            "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
            "X-Title": "Bayani",
          }
        : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You write CFO commentary only. Do not calculate financial, tax, VAT, audit, or valuation outputs. Explain the supplied JSON and include the phrases indicative, requires professional review, and not professional advice where relevant.",
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      temperature: 0.3,
    }),
  })

  if (!response.ok) {
    return Response.json(
      {
        commentary: fallbackCommentary,
        source: "fallback",
        guardrail: "AI provider call failed; no calculations were delegated to AI.",
      },
      { status: 200 }
    )
  }

  const json = await response.json()
  const commentary = json?.choices?.[0]?.message?.content || fallbackCommentary

  return Response.json({
    commentary,
    source: openRouterKey ? "openrouter" : "openai",
    guardrail: "AI received calculated structured JSON only.",
  })
}
