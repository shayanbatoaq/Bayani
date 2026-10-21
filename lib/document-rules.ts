import {
  emirateFromAuthority,
  type CompanyDocType,
  type CompanyDraft,
  type Partner,
} from "./company"

export type ExtractedCompany = Partial<Omit<CompanyDraft, "vat" | "ct">> & {
  vat?: Partial<CompanyDraft["vat"]>
  ct?: Partial<CompanyDraft["ct"]>
}

/* ---------------- dates and numbers ---------------- */

const monthIndex: Record<string, number> = Object.fromEntries(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map(
    (m, i) => [m, i + 1]
  )
)

export function normaliseDate(value: unknown): string {
  const text = String(value ?? "").trim()
  if (!text) return ""
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = text.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/) // UAE documents: dd/mm/yyyy
  if (m) return iso(+m[3], +m[2], +m[1])
  m = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/)
  if (m && monthIndex[m[2].slice(0, 3).toLowerCase()])
    return iso(+m[3], monthIndex[m[2].slice(0, 3).toLowerCase()], +m[1])
  m = text.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (m && monthIndex[m[1].slice(0, 3).toLowerCase()])
    return iso(+m[3], monthIndex[m[1].slice(0, 3).toLowerCase()], +m[2])
  return ""
}
function iso(y: number, mo: number, d: number) {
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCMonth() !== mo - 1 || y < 1950 || y > 2100) return ""
  return date.toISOString().slice(0, 10)
}
export const num = (value: unknown) => {
  const n = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""))
  return Number.isFinite(n) ? n : 0
}
export const trnOf = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "")
  return /^\d{15}$/.test(digits) ? digits : ""
}

/* ---------------- rule-based fallback ---------------- */

function after(text: string, ...keys: string[]) {
  for (const key of keys) {
    const m = text.match(new RegExp(`${key}\\s*[:\\-]?\\s*([^\\n]{2,200})`, "i"))
    if (m) return m[1].trim()
  }
  return ""
}

export function extractWithRules(texts: Partial<Record<CompanyDocType, string>>) {
  const fields: ExtractedCompany = {}
  const license = texts.tradeLicense ?? ""
  const moa = texts.moa ?? ""
  const general = `${license}\n${moa}`
  const name =
    after(license, "Trade Name", "Company Name", "Name of (?:the )?Company", "Legal Name") ||
    after(texts.vatCertificate ?? "", "Legal Name of (?:the )?Entity", "Legal Name") ||
    after(texts.ctCertificate ?? "", "Legal Name")
  if (name) fields.name = name.replace(/\s{2,}.*$/, "")
  const authorityLine = general
    .split("\n")
    .find((line) => /(department|authority|economic|free zone|dmcc|chamber)/i.test(line))
  if (authorityLine) {
    fields.authority = authorityLine.trim()
    fields.emirate = emirateFromAuthority(authorityLine)
  }
  const licenseNumber = after(license, "License No\\.?", "Licence No\\.?", "License Number")
  if (licenseNumber) fields.licenseNumber = licenseNumber.split(/\s+/)[0]
  const issue = normaliseDate(after(license, "Issue Date", "Date of Issue", "Issued on"))
  if (issue) fields.licenseIssueDate = issue
  const legal = after(license, "Legal (?:Type|Form|Status)")
  if (legal) fields.legalForm = legal
  const activity = after(license, "Activities", "Business Activit(?:y|ies)", "Activity")
  if (activity) fields.businessActivity = activity
  const manager = after(general, "Manager(?: Name)?", "General Manager")
  if (manager) fields.manager = manager.replace(/\s{2,}.*$/, "")

  const partners: Partner[] = []
  for (const line of general.split("\n")) {
    const m = line.match(/^(?:partners?|shareholders?|owners?)?\s*:?\s*([A-Za-z][A-Za-z .'-]{3,80}?)\s+([A-Za-z]{3,30})?\s+(\d{1,3}(?:\.\d+)?)\s*%/i)
    if (m) partners.push({ name: m[1].trim(), nationality: m[2] ?? "", sharePercent: +m[3], shareValue: 0 })
  }
  if (partners.length) fields.partners = partners

  const vat = texts.vatCertificate ?? ""
  if (vat) {
    fields.vat = {}
    const trn = trnOf(vat.match(/\b(\d{15})\b/)?.[1])
    if (trn) fields.vat.trn = trn
    const effective = normaliseDate(after(vat, "Effective (?:Registration )?Date", "Effective Date of Registration"))
    if (effective) fields.vat.effectiveDate = effective
    if (/monthly/i.test(vat)) fields.vat.frequency = "monthly"
    else if (/quarter/i.test(vat)) fields.vat.frequency = "quarterly"
    const first = after(vat, "First (?:VAT )?(?:Return|Tax) Period")
    const firstStart = normaliseDate(first)
    if (firstStart) fields.vat.cycleStartMonth = cycleMonthFromFirstPeriod(first)
  }
  const ct = texts.ctCertificate ?? ""
  if (ct) {
    fields.ct = {}
    const trn = trnOf(ct.match(/\b(\d{15})\b/)?.[1])
    if (trn) fields.ct.trn = trn
    const period = after(ct, "First (?:Corporate )?Tax Period", "Tax Period")
    const dates = [...period.matchAll(/\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}/g)].map((d) => normaliseDate(d[0]))
    if (dates[0]) fields.ct.firstPeriodStart = dates[0]
    if (dates[1]) fields.ct.yearEndMonth = +dates[1].slice(5, 7)
  }
  return fields
}

function cycleMonthFromFirstPeriod(text: string) {
  const dates = [...text.matchAll(/\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}/g)].map((d) => normaliseDate(d[0]))
  // The first period ends at the end of a regular cycle period.
  const end = dates[1] || dates[0]
  const endMonth = end ? +end.slice(5, 7) : 3
  return (((endMonth - 3) % 12) + 12) % 12 + 1
}

