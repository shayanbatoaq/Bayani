import "server-only"
import {
  emirateFromAuthority,
  type CompanyDocType,
} from "./company"
import { extractWithRules, normaliseDate, num, trnOf } from "./document-rules"

export type UploadedDocument = {
  type: CompanyDocType
  filename: string
  mime: string
  bytes: Uint8Array
}

export type { ExtractedCompany } from "./document-rules"
import type { ExtractedCompany } from "./document-rules"

export type ExtractionResult = {
  fields: ExtractedCompany
  source: "ai" | "rules"
  warnings: string[]
}

const labels: Record<CompanyDocType, string> = {
  tradeLicense: "Trade License",
  moa: "Memorandum / Articles of Association",
  vatCertificate: "VAT Registration Certificate",
  ctCertificate: "Corporate Tax Registration Certificate",
}

export async function pdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
  })
  try {
    const pdf = await task.promise
    let text = ""
    for (let n = 1; n <= Math.min(pdf.numPages, 30); n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      for (const item of content.items)
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ")
      text += "\n"
      page.cleanup()
    }
    return text.replace(/[ \t]+/g, " ").trim()
  } finally {
    await task.destroy()
  }
}

/* ---------------- AI extraction ---------------- */

const instructions = `You extract company data from UAE corporate documents (trade license, MOA/articles, VAT and corporate tax registration certificates).
Return ONLY a JSON object with these keys (use "" or [] when not found, never invent values):
{
 "name": string, "legalForm": string, "authority": string (issuing licensing authority, e.g. "Dubai Economy and Tourism"), "emirate": string,
 "licenseNumber": string, "licenseIssueDate": "YYYY-MM-DD" (first issue / registration date if shown, else issue date),
 "businessActivity": string (all licensed activities, comma separated),
 "partners": [{"name": string, "nationality": string, "sharePercent": number, "shareValue": number (AED value of shares, 0 if unknown)}],
 "manager": string,
 "vat": {"trn": string (15 digits), "effectiveDate": "YYYY-MM-DD", "frequency": "quarterly"|"monthly", "firstPeriodStart": "YYYY-MM-DD", "firstPeriodEnd": "YYYY-MM-DD"},
 "ct": {"trn": string (15 digits), "firstPeriodStart": "YYYY-MM-DD", "firstPeriodEnd": "YYYY-MM-DD"}
}
Dates on UAE documents are day/month/year. Prefer the MOA for partners, shares and manager; prefer the trade license for activities and authority.`

function provider(): { endpoint: string; key: string; model: string; extra: Record<string, string> } | null {
  const openRouterKey = process.env.OPENROUTER_API_KEY
  const openAiKey = process.env.OPENAI_API_KEY
  if (!openRouterKey && !openAiKey) return null
  return openRouterKey
    ? {
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        key: openRouterKey,
        model: process.env.OPENROUTER_EXTRACT_MODEL || process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
        extra: {
          "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
          "X-Title": "FinScope AI",
        },
      }
    : {
        endpoint: "https://api.openai.com/v1/chat/completions",
        key: openAiKey!,
        model: process.env.OPENAI_EXTRACT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        extra: {},
      }
}

async function extractWithAi(
  documents: UploadedDocument[],
  texts: Partial<Record<CompanyDocType, string>>
): Promise<ExtractedCompany | null> {
  const ai = provider()
  if (!ai) return null
  const content: unknown[] = [{ type: "text", text: "Extract the company details from these documents." }]
  for (const doc of documents) {
    const text = texts[doc.type] ?? ""
    const b64 = Buffer.from(doc.bytes).toString("base64")
    if (text.length > 150) {
      content.push({ type: "text", text: `--- ${labels[doc.type]} (${doc.filename}) ---\n${text.slice(0, 40_000)}` })
    } else if (doc.mime === "application/pdf") {
      content.push({ type: "text", text: `--- ${labels[doc.type]} (scanned PDF attached) ---` })
      content.push({ type: "file", file: { filename: doc.filename, file_data: `data:application/pdf;base64,${b64}` } })
    } else {
      content.push({ type: "text", text: `--- ${labels[doc.type]} (image attached) ---` })
      content.push({ type: "image_url", image_url: { url: `data:${doc.mime};base64,${b64}` } })
    }
  }
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
  const json = await response.json()
  const raw = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}")
  return normaliseAi(raw)
}

function normaliseAi(raw: Record<string, unknown>): ExtractedCompany {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const out: ExtractedCompany = {}
  for (const key of ["name", "legalForm", "authority", "emirate", "licenseNumber", "businessActivity", "manager"] as const) {
    const value = s(raw[key])
    if (value) out[key] = value
  }
  const issue = normaliseDate(raw.licenseIssueDate)
  if (issue) out.licenseIssueDate = issue
  if (!out.emirate && out.authority) out.emirate = emirateFromAuthority(out.authority)
  if (Array.isArray(raw.partners)) {
    const partners = raw.partners
      .map((p: Record<string, unknown>) => ({
        name: s(p?.name),
        nationality: s(p?.nationality),
        sharePercent: num(p?.sharePercent),
        shareValue: num(p?.shareValue),
      }))
      .filter((p) => p.name)
    if (partners.length) out.partners = partners
  }
  const vat = (raw.vat ?? {}) as Record<string, unknown>
  out.vat = {}
  if (trnOf(vat.trn)) out.vat.trn = trnOf(vat.trn)
  const eff = normaliseDate(vat.effectiveDate) || normaliseDate(vat.firstPeriodStart)
  if (eff) out.vat.effectiveDate = eff
  if (vat.frequency === "monthly" || vat.frequency === "quarterly") out.vat.frequency = vat.frequency
  const firstEnd = normaliseDate(vat.firstPeriodEnd)
  if (firstEnd) {
    const length = out.vat.frequency === "monthly" ? 1 : 3
    const endMonth = +firstEnd.slice(5, 7)
    out.vat.cycleStartMonth = ((((endMonth - length) % 12) + 12) % 12) + 1
  }
  const ct = (raw.ct ?? {}) as Record<string, unknown>
  out.ct = {}
  if (trnOf(ct.trn)) out.ct.trn = trnOf(ct.trn)
  const ctStart = normaliseDate(ct.firstPeriodStart)
  if (ctStart) out.ct.firstPeriodStart = ctStart
  const ctEnd = normaliseDate(ct.firstPeriodEnd)
  if (ctEnd) out.ct.yearEndMonth = +ctEnd.slice(5, 7)
  return out
}

export async function extractCompany(documents: UploadedDocument[]): Promise<ExtractionResult> {
  const warnings: string[] = []
  const texts: Partial<Record<CompanyDocType, string>> = {}
  for (const doc of documents) {
    if (doc.mime !== "application/pdf") continue
    try {
      texts[doc.type] = await pdfText(doc.bytes)
    } catch {
      warnings.push(`${labels[doc.type]}: the PDF could not be read.`)
    }
  }
  try {
    const ai = await extractWithAi(documents, texts)
    if (ai) return { fields: ai, source: "ai", warnings }
  } catch (error) {
    console.error("AI document extraction failed", error)
    warnings.push("Automatic AI extraction was unavailable; text rules were used instead.")
  }
  const unreadable = documents.filter((doc) => (texts[doc.type] ?? "").length < 40)
  for (const doc of unreadable)
    warnings.push(
      `${labels[doc.type]}: no readable text (scanned or image). Configure an AI key for scanned documents, or enter these details manually.`
    )
  return { fields: extractWithRules(texts), source: "rules", warnings }
}
