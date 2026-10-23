import { quote, series } from "@/lib/fx-server"

export const runtime = "nodejs"

/** /api/fx?from=USD&to=AED&date=2025-12-31 (or &start=2025-01-01 for the average over a period) */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const from = (q.get("from") ?? "").toUpperCase().slice(0, 3)
  const to = (q.get("to") ?? "").toUpperCase().slice(0, 3)
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return Response.json({ error: "Unsupported currency." }, { status: 400 })
  const date = q.get("date") ?? new Date().toISOString().slice(0, 10)
  const start = q.get("start")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (start && !/^\d{4}-\d{2}-\d{2}$/.test(start))) return Response.json({ error: "Invalid date." }, { status: 400 })
  try {
    if (q.get("series") && start) return Response.json({ series: await series(from, to, start, date) }, { headers: { "Cache-Control": "private, max-age=3600" } })
    return Response.json({ quote: await quote(from, to, date, start ? { start } : undefined) }, { headers: { "Cache-Control": "private, max-age=3600" } })
  } catch {
    return Response.json({ error: "Unsupported currency." }, { status: 400 })
  }
}
