import "server-only"
import { emirateFromAuthority, type CompanyDocType } from "./company"
import {
  extractCompanyDetails,
  normaliseDate,
  normaliseNationality,
  num,
  personCase,
  prepareLines,
  trnOf,
  type DocInput,
  type ExtractedCompany,
  type ExtractionReport,
} from "./document-rules"

export type { ExtractedCompany, ExtractionReport } from "./document-rules"

const labels: Record<CompanyDocType, string> = {
  tradeLicense: "Trade License",
  moa: "Memorandum / Articles of Association",
  vatCertificate: "VAT Registration Certificate",
  ctCertificate: "Corporate Tax Registration Certificate",
}

const instructions = `You extract company data from UAE corporate documents (trade licence, MOA / articles, FTA VAT and corporate tax certificates). The text was read from the documents; scanned pages were read by OCR and may contain errors.
Return ONLY a JSON object with these keys (use "" or [] when a value is not in the documents; never guess):
{"name": string, "legalForm": string, "authority": string (issuing licensing authority), "licenseNumber": string, "licenseIssueDate": "YYYY-MM-DD",
 "businessActivity": string (licensed activities, comma separated), "manager": string,
 "partners": [{"name": string, "nationality": string, "sharePercent": number, "shareValue": number}],
 "vat": {"trn": string, "effectiveDate": "YYYY-MM-DD", "frequency": "quarterly"|"monthly", "firstPeriodEnd": "YYYY-MM-DD"},
 "ct": {"trn": string, "firstPeriodStart": "YYYY-MM-DD", "firstPeriodEnd": "YYYY-MM-DD"}}
Dates in UAE documents are day/month/year. Prefer the MOA for shareholders and share values, and the licence for activities and manager.`

function provider(): { endpoint: string; key: string; model: string; extra: Record<string, string> } | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const openAiKey = process.env.OPENAI_API_KEY
  if (!openRouterKey && !openAiKey) return null
  return openRouterKey
    ? {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        key: openRouterKey,
        model: process.env.OPENROUTER_EXTRACT_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        extra: { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000", "X-Title": "FinScope AI" },
      }
    : {
        endpoint: "https://api.openai.com/v1/chat/completions",
        key: openAiKey!,
        model: process.env.OPENAI_EXTRACT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        extra: {},
      }
}

async function readWithAi(docs: DocInput[]): Promise<ExtractedCompany | null> {
  const ai = provider()
  if (!ai) return null
  const content = docs
    .map((doc) => `--- ${labels[doc.type]}${doc.filename ? ` (${doc.filename})` : ""} ---\n${prepareLines(doc.text).join("\n").slice(0, 30_000)}`)
    .join("\n\n")
  const response = await fetch(ai.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json", ...ai.extra },
    body: JSON.stringify({
      model: ai.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: instructions },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) throw new Error(`AI extraction failed (${response.status})`)
  const raw = JSON.parse((await response.json())?.choices?.[0]?.message?.content ?? "{}")
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const out: ExtractedCompany = {}
  for (const key of ["name", "legalForm", "authority", "licenseNumber", "businessActivity", "manager"] as const) if (s(raw[key])) out[key] = s(raw[key])
  if (normaliseDate(raw.licenseIssueDate)) out.licenseIssueDate = normaliseDate(raw.licenseIssueDate)
  if (out.authority) out.emirate = emirateFromAuthority(out.authority)
  if (Array.isArray(raw.partners))
    out.partners = raw.partners
      .map((p: Record<string, unknown>) => ({
        name: personCase(s(p?.name)),
        nationality: s(p?.nationality) ? normaliseNationality(s(p.nationality)) : "",
        sharePercent: num(p?.sharePercent),
        shareValue: num(p?.shareValue),
      }))
      .filter((p: { name: string }) => p.name)
  const vat = (raw.vat ?? {}) as Record<string, unknown>
  out.vat = {}
  if (trnOf(vat.trn)) out.vat.trn = trnOf(vat.trn)
  if (normaliseDate(vat.effectiveDate)) out.vat.effectiveDate = normaliseDate(vat.effectiveDate)
  if (vat.frequency === "monthly" || vat.frequency === "quarterly") out.vat.frequency = vat.frequency
  const ct = (raw.ct ?? {}) as Record<string, unknown>
  out.ct = {}
  if (trnOf(ct.trn)) out.ct.trn = trnOf(ct.trn)
  if (normaliseDate(ct.firstPeriodStart)) out.ct.firstPeriodStart = normaliseDate(ct.firstPeriodStart)
  if (normaliseDate(ct.firstPeriodEnd)) out.ct.yearEndMonth = +normaliseDate(ct.firstPeriodEnd).slice(5, 7)
  return out
}

const same = (a: unknown, b: unknown) =>
  String(a ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === String(b ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")

/**
 * Document rules first. With an AI key configured, a second reading fills
 * fields the rules did not find and reports any field where the two disagree;
 * it never silently overwrites a value read by the rules.
 */
export async function extractCompany(docs: DocInput[], useAi = true): Promise<ExtractionReport & { ai: "used" | "unavailable" | "failed" }> {
  const report = extractCompanyDetails(docs)
  let ai: ExtractedCompany | null = null
  let status: "used" | "unavailable" | "failed" = "unavailable"
  try {
    ai = useAi ? await readWithAi(docs) : null
    if (ai) status = "used"
  } catch (error) {
    console.error("AI document reading failed", error)
    status = "failed"
  }
  if (!ai) return { ...report, ai: status }
  const f = report.fields
  for (const key of ["name", "legalForm", "authority", "emirate", "licenseNumber", "licenseIssueDate", "businessActivity", "manager"] as const) {
    if (!ai[key]) continue
    if (!f[key]) {
      f[key] = ai[key]
      report.sources[key] = "AI reading"
    } else if (!same(f[key], ai[key]) && key !== "businessActivity")
      report.issues.push({ level: "warning", message: `${key === "licenseIssueDate" ? "License issue date" : key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}: the documents read as “${f[key]}”, the AI reading gives “${ai[key]}”. Check which is right.` })
  }
  if (!f.partners?.length && ai.partners?.length) {
    f.partners = ai.partners
    report.sources.partners = "AI reading"
  }
  for (const group of ["vat", "ct"] as const) {
    const extra = ai[group] as Record<string, unknown> | undefined
    if (!extra) continue
    const mine = (f[group] ??= {}) as Record<string, unknown>
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === "") continue
      if (mine[key] === undefined) {
        mine[key] = value
        report.sources[`${group}.${key}`] = "AI reading"
      } else if (!same(mine[key], value))
        report.issues.push({ level: "warning", message: `${group.toUpperCase()} ${key}: documents read “${mine[key]}”, AI reading “${value}”.` })
    }
  }
  return { ...report, ai: status }
}
