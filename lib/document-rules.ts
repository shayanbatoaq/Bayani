/**
 * Reads company details from UAE trade licences, MOAs / Articles and FTA
 * VAT and corporate tax certificates (English text only).
 *
 * Input is the text of each document (text layer or OCR). Output is the
 * company draft plus, for every field, the document it came from, and a list
 * of issues: conflicts between documents, totals that do not add up, and
 * fields the documents do not contain.
 */
import { countries } from "./countries"
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
export type Issue = { level: "error" | "warning" | "info"; message: string }
export type DocKind = CompanyDocType | "incorporation" | "unknown"
export type DocInput = { type: CompanyDocType; filename?: string; text: string }
export type ExtractionReport = {
  fields: ExtractedCompany
  /** Field path → document the value was read from, e.g. "Trade License". */
  sources: Record<string, string>
  issues: Issue[]
  documents: { type: CompanyDocType; filename?: string; detected: DocKind; authority?: string }[]
}

const docLabel: Record<DocKind, string> = {
  tradeLicense: "Trade License",
  moa: "MOA / Articles",
  vatCertificate: "VAT certificate",
  ctCertificate: "Corporate tax certificate",
  incorporation: "Certificate of incorporation",
  unknown: "Document",
}

/* ================= text preparation ================= */

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿​-‏‪-‮⁦-⁩]+/g

/** English-only, non-empty lines; Arabic and leftover punctuation removed. Wide gaps (3+ spaces) are kept as column breaks. */
export function prepareLines(text: string) {
  let ocr = false
  const out: string[] = []
  for (const raw of text.replace(/\r/g, "").replace(/\f/g, "\n\u0000\n").split("\n")) {
    if (raw === "\u0000") {
      ocr = false
      out.push(PAGE)
      continue
    }
    if (raw.trim() === "[OCR]") {
      ocr = true
      continue
    }
    const cells = raw
      .replace(ARABIC, " ")
      .replace(/\t/g, "   ")
      .split(/\s{3,}/)
      .map((cell) =>
        cell
          .replace(/^[\s/|\\:;.,\-–]+(?=[A-Za-z0-9[(])/, "")
          .replace(/(?<=[A-Za-z0-9)\].%])[\s/|\\]+$/, "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter((cell) => /[A-Za-z0-9]/.test(cell))
      // OCR reads Arabic as short Latin fragments; keep only cells that look like real values.
      .filter((cell, i) => !ocr || (i === 0 ? realText(cell) : /[A-Za-z]{4,}|\d{2,}/.test(cell)))
    let line = cells.join("   ").trim()
    // OCR splits a word before its last letter: "Spar e Parts" → "Spare Parts".
    if (ocr) line = line.replace(/\b([A-Za-z]{2,}) ([b-hj-z])\b(?= [A-Z])/g, "$1$2")
    if (line) out.push(line)
  }
  return out
}

export const PAGE = "[[page]]"
/** OCR line start that is real text, not Arabic read as Latin fragments. */
function realText(cell: string) {
  const tokens = cell.split(/\s+/)
  return tokens.length > 3 || tokens.some((t) => /^[A-Z][a-z]{3,}|^[A-Z]{3,}|\d{2,}|^[a-z]{5,}/.test(t.replace(/^[^A-Za-z0-9]+/, "")))
}
/** A document counts as scanned when most of its pages had to be read by OCR. */
export function isScanned(text: string) {
  const pages = text.split("\f")
  return pages.filter((p) => p.includes("[OCR]")).length * 2 > pages.length
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/* ================= values ================= */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
function iso(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1 || y < 1950 || y > 2100) return ""
  return date.toISOString().slice(0, 10)
}
const monthOf = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1

/** UAE documents write numeric dates day first. */
export function normaliseDate(value: unknown): string {
  const text = String(value ?? "").replace(/(\d)[°º]/g, "$1").trim()
  if (!text) return ""
  let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = text.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/)
  if (m) return iso(+m[3], +m[2], +m[1])
  m = text.match(/(\d{1,2})(?:st|nd|rd|th)?(?:\s+day\s+of)?[\s\-]+([A-Za-z]{3,})\.?[,\s\-]+(\d{4})/i)
  if (m && monthOf(m[2])) return iso(+m[3], monthOf(m[2]), +m[1])
  m = text.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/)
  if (m && monthOf(m[1])) return iso(+m[3], monthOf(m[1]), +m[2])
  return ""
}
export const num = (value: unknown) => {
  const n = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""))
  return Number.isFinite(n) ? n : 0
}
export const trnOf = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "")
  return /^\d{15}$/.test(digits) ? digits : ""
}
const round2 = (n: number) => Math.round(n * 100) / 100

/** Matches OCR'd or misspelt nationalities to a country name ("/ndia" → "India"). */
export function normaliseNationality(raw: string) {
  let value = raw.replace(/[[\]()]/g, "").trim().replace(/\s+national(ity)?$/i, "")
  if (!value) return ""
  value = value.replace(/^[/|l1!]/, "I")
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "")
  const target = plain(value)
  const aliases: Record<string, string> = {
    turkiye: "Turkey",
    uae: "United Arab Emirates",
    emirati: "United Arab Emirates",
    indian: "India",
    pakistani: "Pakistan",
    egyptian: "Egypt",
    british: "United Kingdom",
    uk: "United Kingdom",
    usa: "United States",
    american: "United States",
    iranian: "Iran",
    danish: "Denmark",
    turkish: "Turkey",
    filipino: "Philippines",
    lebanese: "Lebanon",
    jordanian: "Jordan",
    syrian: "Syria",
    saudi: "Saudi Arabia",
    russian: "Russia",
    chinese: "China",
    bangladeshi: "Bangladesh",
    srilankan: "Sri Lanka",
    nigerian: "Nigeria",
    canadian: "Canada",
  }
  if (aliases[target]) return aliases[target]
  const exact = countries.find((c) => plain(c) === target)
  if (exact) return exact
  const close = countries.find((c) => distance(plain(c), target) <= 1 && target.length >= 4)
  return close ?? value.replace(/\b\w/g, (c) => c.toUpperCase())
}
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/* ================= authorities ================= */

const AUTHORITIES: { name: string; emirate: string; pattern: RegExp; acronym?: RegExp }[] = [
  { name: "Jebel Ali Free Zone Authority (JAFZA)", emirate: "Dubai", pattern: /jebel ali free zone/i, acronym: /\bJAFZA\b/ },
  { name: "Dubai Integrated Economic Zones Authority (Dubai Silicon Oasis)", emirate: "Dubai", pattern: /dubai integrated economic zones|dubai silicon oasis/i, acronym: /\b(DIEZA|IFZA)\b/ },
  { name: "Dubai Multi Commodities Centre Authority (DMCC)", emirate: "Dubai", pattern: /dubai multi commodities centre/i, acronym: /\bDMCC\b/ },
  { name: "Meydan Free Zone", emirate: "Dubai", pattern: /meydan/i },
  { name: "Dubai Airport Free Zone Authority (DAFZA)", emirate: "Dubai", pattern: /dubai airport free ?zone/i, acronym: /\bDAFZA?\b/ },
  { name: "Dubai World Trade Centre Authority", emirate: "Dubai", pattern: /dubai world trade cent/i },
  { name: "Dubai International Financial Centre (DIFC)", emirate: "Dubai", pattern: /dubai international financial cent/i, acronym: /\bDIFC\b/ },
  { name: "Dubai South Free Zone", emirate: "Dubai", pattern: /dubai south|dubai world central/i },
  { name: "Dubai Development Authority", emirate: "Dubai", pattern: /dubai development authority|dubai (media|internet|knowledge|production|studio|science|design|outsource) (city|park|district|zone)/i },
  { name: "Dubai CommerCity", emirate: "Dubai", pattern: /commercity/i },
  { name: "Ras Al Khaimah Economic Zone Authority (RAKEZ)", emirate: "Ras Al Khaimah", pattern: /ras al khaimah economic zone/i, acronym: /\bRAKEZ\b/ },
  { name: "RAK International Corporate Centre (RAK ICC)", emirate: "Ras Al Khaimah", pattern: /international corporate centre/i, acronym: /\bRAK ICC\b/ },
  { name: "Ras Al Khaimah Department of Economic Development", emirate: "Ras Al Khaimah", pattern: /ras al khaimah.{0,20}economic development/i, acronym: /\bRAK DED\b/ },
  { name: "Hamriyah Free Zone Authority", emirate: "Sharjah", pattern: /hamriyah free zone/i },
  { name: "Sharjah Airport International Free Zone (SAIF Zone)", emirate: "Sharjah", pattern: /sharjah airport international free zone|saif ?zone/i },
  { name: "Sharjah Media City (Shams)", emirate: "Sharjah", pattern: /sharjah media city/i, acronym: /\bSHAMS\b/ },
  { name: "Sharjah Publishing City Free Zone", emirate: "Sharjah", pattern: /sharjah publishing city/i },
  { name: "Sharjah Research Technology and Innovation Park", emirate: "Sharjah", pattern: /sharjah research technology/i },
  { name: "Sharjah Economic Development Department", emirate: "Sharjah", pattern: /sharjah economic development/i, acronym: /\bSEDD\b/ },
  { name: "Abu Dhabi Global Market (ADGM)", emirate: "Abu Dhabi", pattern: /abu dhabi global market/i, acronym: /\bADGM\b/ },
  { name: "Khalifa Economic Zones Abu Dhabi (KEZAD)", emirate: "Abu Dhabi", pattern: /khalifa (industrial|economic) zone/i, acronym: /\b(KEZAD|KIZAD)\b/ },
  { name: "Masdar City Free Zone", emirate: "Abu Dhabi", pattern: /masdar/i },
  { name: "twofour54", emirate: "Abu Dhabi", pattern: /twofour54/i },
  { name: "Abu Dhabi Department of Economic Development (ADDED)", emirate: "Abu Dhabi", pattern: /abu dhabi.{0,30}(economic development|registration and licensing)/i, acronym: /\bADDED\b/ },
  { name: "Ajman Free Zone Authority", emirate: "Ajman", pattern: /ajman free zone/i },
  { name: "Ajman Department of Economic Development", emirate: "Ajman", pattern: /ajman.{0,30}economic development/i },
  { name: "Umm Al Quwain Free Trade Zone", emirate: "Umm Al Quwain", pattern: /umm al quwain free trade zone/i, acronym: /\bUAQ ?FTZ\b/ },
  { name: "Umm Al Quwain Department of Economic Development", emirate: "Umm Al Quwain", pattern: /umm al quwain.{0,30}economic development/i },
  { name: "Fujairah Free Zone Authority", emirate: "Fujairah", pattern: /fujairah free zone/i },
  { name: "Fujairah Creative City", emirate: "Fujairah", pattern: /creative city/i },
  { name: "Fujairah Municipality / Department of Industry and Economy", emirate: "Fujairah", pattern: /fujairah.{0,30}(industry and economy|economic development)/i },
  // Dubai mainland last: other Dubai authorities also print "Government of Dubai".
  { name: "Dubai Department of Economy and Tourism (DET)", emirate: "Dubai", pattern: /department of economy and tourism|department of economic development|dubai economy/i },
]

export function detectAuthority(text: string) {
  return (
    AUTHORITIES.find((authority) => authority.pattern.test(text)) ??
    AUTHORITIES.find((authority) => authority.acronym?.test(text)) ??
    null
  )
}

/* ================= document type ================= */

export function detectKind(text: string): DocKind {
  const head = prepareLines(text).slice(0, 40).join(" ")
  const all = prepareLines(text).join(" ")
  if (/registration for value added tax|first vat return period/i.test(all)) return "vatCertificate"
  if (/registration for corporate tax|first corporate tax period/i.test(all)) return "ctCertificate"
  if (/memorandum|articles of association/i.test(head)) return "moa"
  if (/certificate of (suffix change|incorporation|formation|registration|change of name|name change)/i.test(head)) return "incorporation"
  if (/licen[cs]e/i.test(head)) return "tradeLicense"
  return "unknown"
}

/* ================= label lookup ================= */

const STOP = /^(\[\[page\]\]|address|remarks|license remarks|licence remarks|company manager|relevant authorities|print date|premises|registrar|this (document|certificate|license|licence)|issued|approved|for verification|government of|page \d|po box|p\.o\. box|phone|mobile|fax|email|parcel|register no|d&b|uae|united arab emirates|expiry|issue date|licen[cs]e (no|number)|legal (type|status)|manager|owner|partners|activities|type of licen|operating name|trade name|company type|ucode|verification|scan|kindly|dubai$|sharjah$)/i

type Found = { value: string; index: number; rest: string; label: string }

/** Value after the first of `labels` found (priority order). Empty values take the next line. */
function find(lines: string[], labels: string[], options: { wholeRest?: boolean; from?: number; digits?: boolean; letters?: boolean } = {}): Found | null {
  for (const label of labels) {
    const pattern = new RegExp(`(?:^|\\s{3,})${label}(?![A-Za-z])\\s*(?:[:\\-–]\\s*)?(.*)$`, "i")
    for (let i = options.from ?? 0; i < lines.length; i++) {
      const m = lines[i].match(pattern)
      if (!m) continue
      const rest = m[1].trim()
      const cells = rest.split(/\s{3,}/)
      // Text fields skip stray OCR marks ("Name of Manager 9") and take the first cell with words.
      let value = options.wholeRest ? rest : options.letters ? (cells.find((c) => /[A-Za-z]{2}/.test(c)) ?? "") : cells[0]
      value = value.replace(/^[:\-–\s]+/, "").replace(/[\[\]]/g, "").trim()
      if (options.letters) value = value.replace(/^[^A-Za-z]+/, "")
      if (!value && i + 1 < lines.length && !STOP.test(lines[i + 1])) value = lines[i + 1].split(/\s{3,}/)[0].trim()
      if (!value || (options.digits && !/^[A-Z]{0,8}[-/]?\d[\w.\-/]*$/i.test(value.split(/\s+/)[0]))) continue
      return { value, index: value === rest.split(/\s{3,}/)[0].replace(/^[:\-–\s]+/, "").replace(/[\[\]]/g, "").trim() ? i : i + 1, rest, label }
    }
  }
  return null
}

const LEGAL_SUFFIX = /\b(l\.?l\.?c|llc|fze|fzco|fz-?llc|fz llc|l\.l\.c-fz|dmcc|plc|pjsc|psc|ltd|limited|co\.?|establishment|est\.?|fz)\.?$/i

function continueName(lines: string[], found: Found, person = false) {
  let value = found.value
  // A wrapped name can share a row with the next section header: "Licence Primary Address   DHARAMCHAND DOSHI".
  const nextCells = (lines[found.index + 1] ?? "").split(/\s{3,}/)
  if (
    person &&
    value === value.toUpperCase() &&
    nextCells.length >= 2 &&
    /(address|details|activities|information)$/i.test(nextCells[0]) &&
    /^[A-Z][A-Z .']+$/.test(nextCells[1]) &&
    nextCells[1].split(" ").length <= 3
  )
    return `${value} ${nextCells[1]}`.replace(/\s+/g, " ").trim()
  for (let i = found.index + 1; i <= found.index + 2 && i < lines.length; i++) {
    const next = lines[i].replace(/^[^A-Za-z]+/, "").trim()
    const words = next.split(/\s+/).length
    if (!next || STOP.test(next) || /[:\d]/.test(next) || words > 4) break
    const upper = next === next.toUpperCase()
    if (person ? upper && words <= 3 : !LEGAL_SUFFIX.test(value) && words <= 3) value = `${value} ${next}`
    else break
  }
  return value.replace(/\s+/g, " ").trim()
}

function cleanName(value: string) {
  return value
    .replace(/["“”‘’']/g, "")
    .replace(/\s*\(\s*the\s+company\s*\)\.?/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;]$/, (m) => (/l\.l\.c|co\.$/i.test(value) ? m : ""))
    .trim()
}

const PARTICLES = new Set(["al", "el", "bin", "bint", "abu", "de", "da", "di", "du", "la", "le", "van", "von", "ul", "ur", "ud"])
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())

/* ================= trade licence ================= */

const SMALL_WORDS = new Set(["of", "and", "in", "for", "the", "to", "on", "or", "by", "via", "non", "with", "from", "at", "as", "e"])
/** Activity text: real words only, not OCR fragments such as "yl)" or "cod". */
function looksLikeActivity(text: string) {
  return text.split(/\s+/).every((token) => {
    const word = token.replace(/[,.;:]$/, "")
    if (/^[&/\-–]$/.test(word)) return true // joiners: "Watches & Clocks"
    if (!/^\(?[A-Za-z][A-Za-z'’\-/]*\)?$/.test(word)) return false // digits or symbols inside a word
    if (word.includes(")") && !word.includes("(")) return false // "yl)"
    if (/^[a-z]{1,3}$/.test(word)) return SMALL_WORDS.has(word) // "of", "and"; not "cod"
    return true
  })
}

type LicenceData = {
  name?: string
  legalForm?: string
  licenseNumber?: string
  issueDate?: string
  expiryDate?: string
  activities: string[]
  managers: string[]
  partners: Partner[]
  capital?: number
  authority?: { name: string; emirate: string } | null
}

export function parseLicence(text: string): LicenceData {
  const lines = prepareLines(text)
  const flat = lines.filter((l) => l !== PAGE).join(" ")
  const out: LicenceData = { activities: [], managers: [], partners: [], authority: detectAuthority(flat) }

  const name = find(lines, ["Licensee", "Company Name", "Legal Name", "Name of (?:the )?Company", "Trade Name", "Operating Name", "Name of Establishment"], { letters: true })
  if (name) out.name = cleanName(continueName(lines, name))

  const legal = find(lines, ["Legal Status", "Legal Type", "Legal Form", "Company Type", "Type of Company", "Legal Entity"], { letters: true })
  if (legal)
    out.legalForm = legal.value.replace(/\s*\(\s*\)\s*/g, "").replace(/([a-z])\(/i, "$1 (").replace(/\s+/g, " ").trim()

  const licence = find(lines, ["License Number", "Licence Number", "License No\\.?", "Licence No\\.?", "Commercial License No\\.?", "Trade License No\\.?"], { digits: true })
  if (licence) out.licenseNumber = licence.value.match(/[A-Z0-9][A-Z0-9.\-/]*/i)?.[0]

  const issue = find(lines, ["Original Date Issue", "Original Issue Date", "Date of Incorporation", "Incorporation Date", "Formation Date", "Establishment Date", "Registration Date", "Issue Date", "Date of Issue", "Issued On"])
  if (issue) out.issueDate = normaliseDate(issue.value) || normaliseDate(issue.rest)
  const expiry = find(lines, ["Expiry Date", "Date of Expiry", "Valid Until", "Expiry"])
  if (expiry) out.expiryDate = normaliseDate(expiry.value) || normaliseDate(expiry.rest)

  // DMCC and other certificates of incorporation / name change.
  const changed = flat.match(/name from such date is changed to:?\s*(.+?)\s+This Certificate/i)
  const certify = flat.match(/This is to certify that\s+(.+?)\s+(?:Duly formed|was (?:duly )?incorporated|is (?:duly )?(?:incorporated|registered))/i)
  if (changed || certify) {
    out.name ??= cleanName((changed ?? certify)![1])
    const reg = flat.match(/Registration (?:No\.?|Number)\s*:?\s*([A-Z0-9\-/]+)/i)
    if (reg) out.licenseNumber ??= reg[1]
    const formed = flat.match(/(?:Registration (?:No\.?|Number)\s*\S+\s+on|incorporated on|formed on)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i)
    if (formed) out.issueDate ??= normaliseDate(formed[1])
    if (/limited liability/i.test(flat)) out.legalForm ??= "Limited Liability Company"
  }

  // Activities: every block (multi-licence documents repeat the block).
  const activityLabels = ["License Activities", "Licence Activities", "Register Activities", "Business Activities", "Activities", "ACTIVITY\\(S\\)", "Activity", "Business Activity"]
  const labelPattern = new RegExp(`^(?:${activityLabels.join("|")})(?![A-Za-z])\\s*(?:[:\\-–]\\s*)?(.*)$`, "i")
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelPattern)
    if (!m) continue
    const inline = m[1].replace(/^\s*code\s*$/i, "").split(/\s{3,}/)[0].trim()
    if (lines[i].match(/^Register Activities/i) && out.activities.length) continue
    const block: string[] = []
    let j = i + 1
    const wrapped = Boolean(inline)
    if (inline) block.push(inline)
    for (; j < lines.length && j < i + 25; j++) {
      const line = lines[j]
      if (STOP.test(line) || labelPattern.test(line) || /^(name of manager|company manager|managers?\b|owner|relevant|remarks|address|member since)/i.test(line) || /\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}/.test(line) || /^[A-Za-z ]{3,30}:\s/.test(line)) break
      const cell = line.split(/\s{3,}/)[0].replace(/\s+\d{4}\.\d{1,3}$/, "").replace(/^[•\-\d.)\s]+(?=[A-Za-z])/, "").trim()
      if (!/[A-Za-z]{3}/.test(cell) || /^code$/i.test(cell)) continue
      // A lone short capitalised word, or OCR fragments, after the list is a logo or stamp, not an activity.
      if (!wrapped && block.length && (/^[A-Z]{2,6}$/.test(cell) || !looksLikeActivity(cell))) break
      // Wrapped text continues an activity unless the previous one already ends like a complete activity.
      const previous = block[block.length - 1] ?? ""
      const complete = /(trading|services?|consultanc(y|ies)|manufacturing|fabrication|activities|repairing|maintenance|contracting|brokerage|e-?commerce|management)$/i.test(previous)
      if (wrapped && previous && !(complete && /^[A-Z]/.test(cell))) block[block.length - 1] = `${previous} ${cell}`
      else if (!wrapped && previous && /^[a-z]/.test(cell))
        // OCR sometimes splits one item: "Watches & Clocks & Spar" + "e Parts Trading".
        block[block.length - 1] = /^[a-z]{1,2}\b/.test(cell) && /[a-z]$/i.test(previous) ? `${previous}${cell}` : `${previous} ${cell}`
      else block.push(cell)
    }
    for (const activity of block) {
      const clean = activity.replace(/\s+/g, " ").replace(/\s+\d{4}\.\d{1,3}$/, "").trim()
      const tidy = clean === clean.toUpperCase() ? titleCase(clean) : clean
      if (tidy && !out.activities.some((a) => a.toLowerCase() === tidy.toLowerCase())) out.activities.push(tidy)
    }
  }

  // No activities heading read (e.g. white text on a dark bar in a scan): use a numbered list instead.
  if (!out.activities.length) {
    const start = lines.findIndex((l) => /^1\.\s+[A-Z][A-Za-z]/.test(l))
    for (let i = start, n = 1; start >= 0 && i < lines.length; i++) {
      const m = lines[i].match(new RegExp(`^${n}\\.\\s+(.+)$`))
      if (!m) break
      const cell = m[1].split(/\s{3,}/)[0].trim()
      if (!looksLikeActivity(cell)) break
      out.activities.push(cell)
      n++
    }
  }

  // Managers. Dubai DET licences list members as "Manager / Nationality / No." with the name below.
  const members = lines.findIndex((l) => /^License Members/i.test(l))
  if (members >= 0) {
    for (let i = members + 1; i < lines.length && !/License Activities/i.test(lines[i]); i++) {
      const role = lines[i].match(/^(Manager|Partner|Owner|Director|Local Service Agent|Shareholder)\b/i)
      if (!role || !/\d{5,}/.test(lines[i])) continue
      const parts: string[] = []
      for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
        if (/\d{5,}|License Activities/i.test(lines[j])) break
        parts.push(lines[j])
      }
      if (/manager/i.test(role[1]) && parts.length) out.managers.push(parts.join(" "))
    }
  }
  if (!out.managers.length) {
    const manager = find(lines, ["Name of Manager", "Manager Name", "MANAGER\\(S\\)", "Managers", "General Manager", "Manager"], { letters: true })
    if (manager) {
      const value = continueName(lines, manager, true).replace(/^[^A-Za-z]+/, "")
      out.managers.push(...value.split(/\s*[,;]\s*|\s+&\s+/).filter((v) => v.length > 2))
    }
  }

  // Partners on the licence: DET partner table, or an owner line.
  for (const line of lines) {
    const m = line.match(/^(\d{1,3}(?:\.\d+)?)%\s+\d+\s+(?:\/\s*)?([A-Za-z][A-Za-z ]+?)\s+(?:\/\s*)?([A-Za-z][A-Za-z .'-]+?)\s*\/?$/)
    if (m && !out.partners.some((p) => p.name.toLowerCase() === m[3].toLowerCase()))
      out.partners.push({ name: m[3].trim(), nationality: normaliseNationality(m[2]), sharePercent: round2(+m[1]), shareValue: 0 })
  }
  if (!out.partners.length) {
    const owner = find(lines, ["OWNER\\(S\\)", "Owners", "Owner", "Shareholder\\(s\\)", "Shareholders"], { letters: true })
    if (owner) {
      const names = continueName(lines, owner, true).split(/\s*[,;]\s*|\s+&\s+/).filter((v) => v.length > 2)
      out.partners = names.map((n) => ({ name: n, nationality: "", sharePercent: names.length === 1 ? 100 : 0, shareValue: 0 }))
    }
  }
  const nominated = flat.match(/(?:Nominated|Paid)\s+([\d,]+(?:\.\d+)?)/i)
  if (nominated) out.capital = num(nominated[1])
  return out
}

/* ================= MOA / Articles ================= */

type MoaData = {
  name?: string
  incorporationDate?: string
  capital?: number
  shareCount?: number
  shareValue?: number
  holders: { name: string; nationality: string; shares?: number; percent?: number; value?: number }[]
  managers: string[]
  activities: string[]
  authority?: { name: string; emirate: string } | null
}

export function parseMoa(text: string): MoaData {
  const lines = prepareLines(text)
  // Bilingual layouts interleave Arabic-column numbers; sentences read better without number-only lines.
  const prose = lines.filter((l) => l !== PAGE && /[A-Za-z]{2}/.test(l)).join(" ").replace(/\s+/g, " ")
  const out: MoaData = { holders: [], managers: [], activities: [], authority: detectAuthority(prose) }

  const names = [
    /The name of the (?:free zone )?company (?:shall be|is)\s*:?\s*['"“‘]?(.+?)['"”’]?\s*(?:\(the|\.|,|$)/i,
    /The name is\s+(.+?)\s*\(the/i,
    /ARTICLES OF ASSOCIATION OF\s+(.+?)\s*\(THE/i,
    /MEMORANDUM OF ASSOCIATION\s+OF\s+(.+?)\s+MEMORANDUM/i,
    /MEMORANDUM (?:&|AND) ARTICLES OF ASSOCIATION\s+['"“]?(.+?)['"”]?\s+(?:Part|Incorporated|IN THE)/i,
    /LIMITED LIABILITY COMPANY \(LLC\)\s*\(?\(?(.+?)\)/i,
  ]
  for (const pattern of names) {
    const m = prose.match(pattern)
    if (m && m[1].length < 120) {
      // Prose runs on into the next heading; a company name ends at its legal suffix.
      const suffix = m[1].match(/^(.*?\b(?:L\.?L\.?C(?:-FZ)?|FZ-?LLC|FZCO|FZE|DMCC|LLC|LTD|LIMITED|PJSC|PLC)\b\.?)/i)
      out.name = cleanName(suffix ? suffix[1] : m[1])
      break
    }
  }

  const inc =
    prose.match(/Incorporated on\s+(.+?\d{4})/i) ??
    prose.match(/Execution Date\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i) ??
    prose.match(/(?:is|was) executed on\s+(\S+)/i) ??
    prose.match(/entered into on .{0,30}?(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i)
  if (inc) out.incorporationDate = normaliseDate(inc[1])

  // Capital, shares and share value.
  let m = prose.match(/capital of the Company is\s*\[?\s*(\d+)\s*\]?\s*Shares with a value of AED\s*[[{(]?\s*([\d,]+(?:\.\d+)?)\s*[\]})]?\s*each/i)
  if (m) {
    out.shareCount = +m[1]
    out.shareValue = num(m[2])
    out.capital = out.shareCount * out.shareValue
  }
  m = prose.match(/Share Capital of the Company is AED\s*([\d,]+(?:\.\d+)?)\s*divided into\s*([\d,]+)\s*Shares of AED\s*([\d,]+(?:\.\d+)?)/i)
  if (m && !out.capital) [out.capital, out.shareCount, out.shareValue] = [num(m[1]), num(m[2]), num(m[3])]
  m = prose.match(/capital of the Company amounts to[^(]{0,20}\(\s*(?:DHS|AED)\s*([\d,]+(?:\.\d+)?)\s*\)/i)
  if (m && !out.capital) out.capital = num(m[1])
  m = prose.match(/capital of the (?:Company|FZCO) is (?:AED|Dhs\.?|Dirhams)\s*([\d,]+(?:\.\d+)?)/i)
  if (m && !out.capital) out.capital = num(m[1])
  m = prose.match(/Share Capital\s+AED\s*([\d,]+(?:\.\d+)?)/i)
  if (m && !out.capital) out.capital = num(m[1])
  m = prose.match(/Capital\s*[“"]?Total Value of\s*(?:Shares[”"]?)?\s*AED\s*([\d,]+(?:\.\d+)?)/i)
  if (m && !out.capital) out.capital = num(m[1])
  m = prose.match(/divided into\s*\(?\s*([\d,]+)\s*\)?\s*shares/i) ?? prose.match(/Total Number of Shares\s+([\d,]+)/i)
  if (m && !out.shareCount) out.shareCount = num(m[1])
  m =
    prose.match(/value of each share[^\d]{0,40}?([\d,]+(?:\.\d+)?)/i) ??
    prose.match(/Value of Each Share\s+AED\s*([\d,]+(?:\.\d+)?)/i) ??
    prose.match(/Amount per share:?\s*(?:\(AED\)|AED)?\s*([\d,]+(?:\.\d+)?)/i)
  if (m && !out.shareValue) out.shareValue = num(m[1])

  // Shareholders, format 1: labelled blocks (JAFZA, DMCC, RAKEZ).
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^(?:\(\w\)\s*)?(?:Name of Shareholder|Shareholder Name|Name)\s*:?\s*\[?\s*([A-Za-z][A-Za-z .'-]{3,}?)\s*\]?\s*$/i)
    if (!head || /^(of the company|and address)/i.test(head[1])) continue
    const holder: MoaData["holders"][number] = { name: head[1].trim(), nationality: "" }
    for (let j = i + 1; j < lines.length && j <= i + 16; j++) {
      const line = lines[j]
      if (j > i + 1 && /^(?:\(\w\)\s*)?(?:Name of Shareholder|Shareholder Name|Name)\s*:?\s*[A-Za-z[]/i.test(line)) break
      let v
      if ((v = line.match(/^Nationality\s*:?\s*\[?\s*([^\]]*?)\s*\]?\s*$/i)))
        holder.nationality = normaliseNationality(v[1] || (/^\[?[A-Za-z/|]{3,}\]?$/.test(lines[j + 1] ?? "") ? lines[j + 1] : ""))
      if ((v = line.match(/(?:Number|No\.?) of Shares\s*:?\s*\[?\s*([\d,.]+)/i))) holder.shares = num(v[1])
      if ((v = line.match(/Percentage\s*:?\s*\[?\s*(\d{1,3}(?:\.\d+)?)\s*(?:[\]|l]|\s1)?\s*%/i))) {
        // OCR reads the closing bracket as "1": "[ 251%" is 25%.
        let pct = +v[1]
        if (pct > 100 && /1$/.test(v[1])) pct = +v[1].slice(0, -1)
        holder.percent = pct
      }
    }
    if (holder.nationality || holder.shares)
      if (!out.holders.some((h) => h.name.toLowerCase() === holder.name.toLowerCase())) out.holders.push(holder)
  }

  // Format 2: DET mainland sentences "Mr. (NAME), (150) shares, amounting to (150000), which represent (50%)".
  for (const s of prose.matchAll(/(?:Mr\.?|Mrs\.?|Ms\.?|M\/s\.?)\s*\(([^()]+?)\)\s*,?\s*\(\s*([\d,]+)\s*\)\s*shares\s*,?\s*amounting to\s*\(\s*([\d,]+)\s*\)\s*,?\s*which represent\s*\(\s*([\d.]+)\s*%\s*\)/gi)) {
    const holderName = s[1].replace(/\s+/g, " ").trim()
    if (out.holders.some((h) => h.name.toLowerCase() === holderName.toLowerCase())) continue
    const nat = prose.match(new RegExp(`${escape(holderName)}\\)?,?\\s*([A-Za-z]+)\\s+national`, "i"))
    out.holders.push({ name: holderName, nationality: nat ? normaliseNationality(nat[1]) : "", shares: num(s[2]), value: num(s[3]), percent: +s[4] })
  }

  // Format 3: share table "Member Name  No of Shares  Share Value  Share Capital" (DIEZA / IFZA).
  const table = lines.findIndex((l) => /Member Name\s+No\.? of Shares\s+Share Value/i.test(l))
  if (table >= 0 && !out.holders.length) {
    for (let i = table + 1; i < lines.length && !/^Share Capital/i.test(lines[i]); i++) {
      const row = lines[i].match(/^([A-Za-z][A-Za-z .'-]+?)\s+([\d,]+)\s+([\d,.]+)\s+([\d,.]+)$/)
      if (row) out.holders.push({ name: row[1].trim(), nationality: "", shares: num(row[2]), value: num(row[4]) })
      else if (out.holders.length && /^[A-Za-z .'-]+$/.test(lines[i])) {
        const last = out.holders[out.holders.length - 1]
        const piece = lines[i].trim()
        // A one- or two-letter piece is the end of a word broken across lines.
        last.name = /^[A-Za-z]{1,2}$/.test(piece) && !PARTICLES.has(piece.toLowerCase()) ? `${last.name}${piece}` : `${last.name} ${piece}`
      }
    }
    if (!out.shareValue) {
      const v = lines[table + 1]?.match(/\s([\d,.]+)\s+[\d,.]+$/)
      if (v) out.shareValue = num(v[1])
    }
  }
  // Board table gives nationality and positions.
  const board = lines.findIndex((l) => /Member Name\s+Nationality\s+Passport/i.test(l))
  if (board >= 0) {
    for (let i = board + 1; i < lines.length && i < board + 12; i++) {
      const row = lines[i].match(/^([A-Za-z][A-Za-z .'-]+?)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+([A-Z0-9]{6,})\s*(.*)$/)
      if (!row) continue
      const holder = out.holders.find((h) => h.name.toLowerCase().startsWith(row[1].toLowerCase().trim()))
      if (holder && !holder.nationality) holder.nationality = normaliseNationality(row[2])
      const position = lines.slice(i, i + 3).join(" ")
      if (/manager/i.test(position)) {
        const fullName = holder?.name ?? row[1].trim()
        if (!out.managers.includes(fullName)) out.managers.push(fullName)
      }
    }
  }

  // Format 4: numbered table "SN Name Nationality ... Number of Shares" (Meydan).
  if (!out.holders.length)
    for (const line of lines) {
      const row = line.match(/^\d{1,2}\s+([A-Za-z][A-Za-z .'-]+?)\s{2,}([A-Za-z][A-Za-z ]+?)\s{2,}([A-Z0-9]{6,})\s+([\d,]+)\s*$/)
      if (row) out.holders.push({ name: row[1].trim(), nationality: normaliseNationality(row[2]), shares: num(row[4]) })
    }

  // Manager appointments in prose.
  const appointed = prose.match(/appointed\s+(?:Mr\.?|Ms\.?|Mrs\.?)?\s*([A-Z][A-Za-z .'-]+?)\s+as (?:the )?(?:General )?Manager/i)
  if (appointed && !out.managers.length) out.managers.push(appointed[1].trim())
  const entrusted = prose.match(/management of the company shall be\s+entrusted to:?\s*(?:Mr\.?|Ms\.?|Mrs\.?)?\s*([A-Z][A-Z .'-]+?),/i)
  if (entrusted && !out.managers.length) out.managers.push(entrusted[1].trim())

  // Objects listed in the MOA (used only when there is no licence).
  const objects = prose.match(/business objectives for which the Company is established are:?\s*\(a\)\s*(.+?)\s*\(b\)/i)
  if (objects) out.activities = objects[1].split(/\s*,\s*/).map((a) => a.replace(/\.$/, "").trim()).filter(Boolean)
  return out
}

/* ================= FTA certificates ================= */

type VatData = { trn?: string; name?: string; effectiveDate?: string; frequency?: "quarterly" | "monthly"; cycleStartMonth?: number; firstPeriod?: [string, string] }
type CtData = { trn?: string; name?: string; effectiveDate?: string; firstPeriodStart?: string; firstPeriodEnd?: string; yearEndMonth?: number; dueDate?: string; licensingAuthority?: string; licenseNumber?: string }

export function parseVat(text: string): VatData {
  const lines = prepareLines(text)
  const flat = lines.join(" ")
  const out: VatData = {}
  out.trn = trnOf(flat.match(/Tax Registration Number\s*(?:\(TRN\))?\s*:?\s*(\d[\d ]{13,}\d)/i)?.[1])
  const name = find(lines, ["Legal Name of (?:the )?Entity \\(English\\)", "Legal Name of Person/Entity \\(English\\)", "Legal Name \\(English\\)", "Legal Name of Entity", "Legal Name"])
  if (name) out.name = cleanName(name.value)
  out.effectiveDate = normaliseDate(flat.match(/Effective (?:Registration )?Date(?: of Registration)?\s*:?\s*(\S+)/i)?.[1])
  const first = flat.match(/First VAT Return Period\s*:?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})\s*[-–to]+\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i)
  if (first) out.firstPeriod = [normaliseDate(first[1]), normaliseDate(first[2])]
  const periods = flat.match(/Start and end dates of Tax periods\s*(.+?)(?:List of|Please check|Date of Issue|$)/i)?.[1] ?? ""
  const starts = [...periods.matchAll(/\d{1,2}(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\s+to/gi)].map((p) => monthOf(p[1])).filter(Boolean)
  if (starts.length) {
    out.frequency = starts.length >= 12 ? "monthly" : "quarterly"
    out.cycleStartMonth = Math.min(...starts.map((s) => ((s - 1) % 3) + 1))
  } else if (/monthly/i.test(flat)) out.frequency = "monthly"
  else if (/quarter/i.test(flat)) out.frequency = "quarterly"
  if (!out.cycleStartMonth && out.firstPeriod?.[1]) {
    const length = out.frequency === "monthly" ? 1 : 3
    const endMonth = +out.firstPeriod[1].slice(5, 7)
    out.cycleStartMonth = ((((endMonth - length) % 12) + 12) % 12) + 1
    out.frequency ??= "quarterly"
  }
  return out
}

export function parseCt(text: string): CtData {
  const lines = prepareLines(text)
  const flat = lines.join(" ")
  const out: CtData = {}
  out.trn = trnOf(flat.match(/Tax Registration Number\s*:?\s*(\d[\d ]{13,}\d)/i)?.[1])
  const name = find(lines, ["Legal Name of Person/Entity \\(English\\)", "Legal Name of (?:the )?Entity \\(English\\)", "Legal Name \\(English\\)"])
  if (name) out.name = cleanName(name.value)
  out.effectiveDate = normaliseDate(flat.match(/Effective Registration Date\s*:?\s*(\S+)/i)?.[1])
  const period = flat.match(/([A-Za-z]{3,})\s*-\s*([A-Za-z]{3,})\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})(?:\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}))?/)
  if (period && monthOf(period[2])) {
    out.yearEndMonth = monthOf(period[2])
    out.firstPeriodStart = normaliseDate(period[3])
    out.firstPeriodEnd = normaliseDate(period[4])
    if (period[5]) out.dueDate = normaliseDate(period[5])
  } else {
    const start = flat.match(/First Corporate Tax Period Start Date\s*:?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i)
    const end = flat.match(/First Corporate Tax Period End Date\s*:?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i)
    if (start) out.firstPeriodStart = normaliseDate(start[1])
    if (end) {
      out.firstPeriodEnd = normaliseDate(end[1])
      out.yearEndMonth = +out.firstPeriodEnd.slice(5, 7)
    }
  }
  const branch = lines.find((l) => /^1\s+/.test(l) && /\d{5,}/.test(l))
  if (branch) out.licenseNumber = branch.match(/(\d{5,})/)?.[1]
  const authority = detectAuthority(flat)
  if (authority) out.licensingAuthority = authority.name
  return out
}

/* ================= combine ================= */

/** Digits OCR commonly confuses in scanned, italic or bracketed text. */
const CONFUSED: Record<string, string[]> = { "1": ["7", "4"], "7": ["1"], "5": ["9", "6", "3", "8"], "9": ["5", "8"], "6": ["5", "8"], "8": ["3", "0", "6", "9"], "0": ["8"], "3": ["8", "5"] }

/**
 * If the values do not add up to `target` and exactly one single-digit OCR
 * swap makes them add up, return that fix. Anything less certain is left for
 * the user, with the totals flagged.
 */
function repairOneDigit(values: number[], target: number) {
  const sum = values.reduce((s, v) => s + v, 0)
  if (Math.abs(sum - target) < 0.01) return null
  const fixes: { index: number; value: number }[] = []
  values.forEach((value, index) => {
    const text = String(value)
    for (let pos = 0; pos < text.length; pos++)
      for (const swap of CONFUSED[text[pos]] ?? []) {
        const next = Number(text.slice(0, pos) + swap + text.slice(pos + 1))
        if (Number.isFinite(next) && Math.abs(sum - value + next - target) < 0.01) fixes.push({ index, value: next })
      }
  })
  return fixes.length === 1 ? fixes[0] : null
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
function sameEntity(a: string, b: string) {
  const strip = (s: string) =>
    compact(s.replace(/\b(l\.?l\.?c\.?(-fz)?|fz-?llc|fzco|fze|dmcc|co|company|limited|ltd|trading|est|establishment|fz)\b/gi, ""))
  return strip(a) === strip(b)
}
/** Same person written differently: case, spacing, broken lines or a one- or two-letter OCR slip. */
function samePerson(a: string, b: string) {
  const x = compact(a)
  const y = compact(b)
  return x === y || (Math.min(x.length, y.length) >= 10 && distance(x, y) <= 2)
}
type NameCandidate = { name: string; ocr: boolean }
function bestName(candidates: NameCandidate[]) {
  const fragments = (n: string) => n.split(/\s+/).filter((w) => w.length <= 2 && !PARTICLES.has(w.toLowerCase())).length
  const pick = [...candidates].sort(
    (a, b) =>
      Number(a.ocr) - Number(b.ocr) || // exact text layer over OCR
      fragments(a.name) - fragments(b.name) || // no broken words
      b.name.split(" ").length - a.name.split(" ").length // fullest spacing
  )[0].name
  return personCase(pick)
}
/** People are shown in Title Case when the document prints them in capitals. */
export function personCase(name: string) {
  const clean = name.replace(/\s+/g, " ").trim()
  return clean === clean.toUpperCase() ? titleCase(clean) : clean
}

export function extractCompanyDetails(docs: DocInput[], today = new Date().toISOString().slice(0, 10)): ExtractionReport {
  const issues: Issue[] = []
  const sources: Record<string, string> = {}
  const fields: ExtractedCompany = {}
  const detected = docs.map((doc) => ({ ...doc, detected: detectKind(doc.text) }))
  for (const doc of detected) {
    const expected = doc.type === "tradeLicense" ? ["tradeLicense", "incorporation"] : [doc.type]
    if (doc.detected === "unknown")
      issues.push({ level: "warning", message: `${doc.filename ?? docLabel[doc.type]}: the document type could not be recognised; it was read as a ${docLabel[doc.type]}.` })
    else if (!expected.includes(doc.detected))
      issues.push({ level: "warning", message: `${doc.filename ?? "A file"} was uploaded as ${docLabel[doc.type]} but looks like a ${docLabel[doc.detected]}. It was read as a ${docLabel[doc.detected]}.` })
    if (doc.text.replace(/[^A-Za-z]/g, "").length < 40)
      issues.push({ level: "error", message: `${doc.filename ?? docLabel[doc.type]}: no readable text. Upload a clearer copy or enter the details manually.` })
  }
  const kindOf = (doc: (typeof detected)[number]): DocKind => (doc.detected === "unknown" ? doc.type : doc.detected)
  const licences = detected.filter((d) => ["tradeLicense", "incorporation"].includes(kindOf(d)))
  const moas = detected.filter((d) => kindOf(d) === "moa")
  const vats = detected.filter((d) => kindOf(d) === "vatCertificate")
  const cts = detected.filter((d) => kindOf(d) === "ctCertificate")

  const lic = licences.map((d) => ({ doc: d, data: parseLicence(d.text) }))
  const moa = moas.map((d) => ({ doc: d, data: parseMoa(d.text) }))
  const vat = vats.map((d) => ({ doc: d, data: parseVat(d.text) }))[0]
  const ct = cts.map((d) => ({ doc: d, data: parseCt(d.text) }))[0]
  const set = <K extends keyof ExtractedCompany>(key: K, value: ExtractedCompany[K] | undefined, source: string) => {
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) return false
    if (fields[key] !== undefined) return false
    fields[key] = value
    sources[key] = source
    return true
  }
  const licLabel = (d: (typeof detected)[number]) => docLabel[kindOf(d)]

  // Company name, with cross-document check.
  const names: { value: string; source: string }[] = []
  for (const l of lic) if (l.data.name) names.push({ value: l.data.name, source: licLabel(l.doc) })
  for (const m of moa) if (m.data.name) names.push({ value: m.data.name, source: docLabel.moa })
  if (ct?.data.name) names.push({ value: ct.data.name, source: docLabel.ctCertificate })
  if (vat?.data.name) names.push({ value: vat.data.name, source: docLabel.vatCertificate })
  if (names[0]) {
    set("name", names[0].value, names[0].source)
    for (const other of names.slice(1))
      if (!sameEntity(names[0].value, other.value))
        issues.push({ level: other.source.includes("certificate") ? "error" : "warning", message: `Company name differs: ${names[0].source} shows “${names[0].value}”, ${other.source} shows “${other.value}”. Check that all documents belong to the same company.` })
  }

  const primary = lic[0]?.data
  const authority = primary?.authority ?? moa.find((m) => m.data.authority)?.data.authority ?? (ct?.data.licensingAuthority ? detectAuthority(ct.data.licensingAuthority) : null)
  if (authority) {
    set("authority", authority.name, lic[0]?.data.authority ? licLabel(lic[0].doc) : moa.length ? docLabel.moa : docLabel.ctCertificate)
    set("emirate", authority.emirate, sources.authority)
  }
  for (const l of lic) {
    set("legalForm", l.data.legalForm, licLabel(l.doc))
    set("licenseNumber", l.data.licenseNumber, licLabel(l.doc))
    set("licenseIssueDate", l.data.issueDate, licLabel(l.doc))
    if (l.data.expiryDate && l.data.expiryDate < today)
      issues.push({ level: "warning", message: `The ${licLabel(l.doc)} expired on ${l.data.expiryDate}. Upload the current licence if it has been renewed.` })
  }
  if (!fields.legalForm && fields.name) {
    const suffix = fields.name.match(/\b(FZ-?LLC|FZCO|FZE|L\.?L\.?C(?:-FZ)?|LLC|DMCC)\b/i)?.[1]?.toUpperCase().replace(/\./g, "")
    const forms: Record<string, string> = { "FZ-LLC": "Free Zone Limited Liability Company", FZLLC: "Free Zone Limited Liability Company", FZCO: "Free Zone Company", FZE: "Free Zone Establishment", LLC: "Limited Liability Company", "LLC-FZ": "Limited Liability Company", DMCC: "Limited Liability Company" }
    if (suffix && forms[suffix]) set("legalForm", forms[suffix], "Company name")
  }
  for (const m of moa) set("licenseIssueDate", m.data.incorporationDate, docLabel.moa)
  if (!fields.licenseNumber && ct?.data.licenseNumber) set("licenseNumber", ct.data.licenseNumber, docLabel.ctCertificate)

  const activities = lic.flatMap((l) => l.data.activities)
  if (!set("businessActivity", activities.join(", ") || undefined, lic[0] ? licLabel(lic[0].doc) : ""))
    for (const m of moa) set("businessActivity", m.data.activities.join(", ") || undefined, docLabel.moa)

  // Partners: MOA first (shares and values), licence otherwise.
  const holders = moa.flatMap((m) => m.data.holders)
  const statedShares = moa.find((m) => m.data.shareCount)?.data.shareCount
  const moaFromOcr = moa.some((m) => isScanned(m.doc.text))
  if (moaFromOcr && statedShares && holders.every((h) => h.shares !== undefined)) {
    const fix = repairOneDigit(holders.map((h) => h.shares!), statedShares)
    if (fix) {
      issues.push({ level: "warning", message: `Scanned MOA: ${personCase(holders[fix.index].name)}'s share count was read as ${holders[fix.index].shares} and corrected to ${fix.value} so the holdings match the ${statedShares} shares stated. Check this against the document.` })
      holders[fix.index].shares = fix.value
    }
  }
  if (moaFromOcr && holders.length > 1 && holders.every((h) => h.percent !== undefined)) {
    const fix = repairOneDigit(holders.map((h) => h.percent!), 100)
    if (fix) {
      issues.push({ level: "warning", message: `Scanned MOA: ${personCase(holders[fix.index].name)}'s percentage was read as ${holders[fix.index].percent}% and corrected to ${fix.value}% so the shares total 100%. Check this against the document.` })
      holders[fix.index].percent = fix.value
    }
  }
  if (moaFromOcr && holders.length)
    issues.push({ level: "info", message: "The MOA is a scanned copy and was read by OCR. Check the share capital, share counts and names against the document." })
  const capital = moa.find((m) => m.data.capital)?.data.capital ?? lic.find((l) => l.data.capital)?.data.capital
  const shareValue = moa.find((m) => m.data.shareValue)?.data.shareValue
  const isOcr = (d: { text: string }) => isScanned(d.text)
  const known: NameCandidate[] = [
    ...lic.flatMap((l) => [...l.data.managers, ...l.data.partners.map((p) => p.name)].map((name) => ({ name, ocr: isOcr(l.doc) }))),
    ...moa.flatMap((m) => [...m.data.managers, ...m.data.holders.map((h) => h.name)].map((name) => ({ name, ocr: isOcr(m.doc) }))),
  ]
  const fullName = (name: string, ownOcr = true) => {
    const matches = known.filter((n) => samePerson(n.name, name))
    const fragments = (n: string) => n.split(/\s+/).some((w) => w.length <= 2 && !PARTICLES.has(w.toLowerCase()))
    // Same letters, different spacing: keep the document's own spelling unless it has broken words.
    if (!fragments(name) && matches.every((n) => compact(n.name) === compact(name))) return personCase(name)
    return bestName([{ name, ocr: ownOcr }, ...matches])
  }
  // Manager: licence is the current record; the MOA is used when the licence has none.
  const licManagers = lic.flatMap((l) => l.data.managers)
  const moaManagers = moa.flatMap((m) => m.data.managers)
  const managers = licManagers.length ? licManagers : moaManagers
  if (managers.length) {
    const unique = managers.filter((name, i) => managers.findIndex((n) => samePerson(n, name)) === i).map((n) => fullName(n))
    set("manager", unique.join(", "), licManagers.length ? licLabel(lic[0].doc) : docLabel.moa)
    if (licManagers.length && moaManagers.length) {
      const missing = moaManagers.filter((n) => !licManagers.some((l) => samePerson(l, n)))
      const extra = licManagers.filter((n) => !moaManagers.some((l) => samePerson(l, n)))
      if (missing.length || extra.length)
        issues.push({ level: "info", message: `Manager per the licence: ${licManagers.map((n) => fullName(n)).join(", ")}. The MOA appoints ${moaManagers.map((n) => fullName(n)).join(", ")}. The licence was used as the current record.` })
    }
  }

  let partners: Partner[] = []
  if (holders.length) {
    const totalShares = holders.reduce((s, h) => s + (h.shares ?? 0), 0)
    partners = holders.map((h) => {
      const fromShares = totalShares ? round2(((h.shares ?? 0) / totalShares) * 100) : 0
      const percent = h.percent ?? fromShares
      const value = h.value ?? (h.shares && shareValue ? round2(h.shares * shareValue) : capital ? round2((capital * percent) / 100) : 0)
      return { name: fullName(h.name), nationality: h.nationality, sharePercent: percent, shareValue: value }
    })
    // Internal consistency of the MOA itself.
    const stated = holders.filter((h) => h.percent !== undefined && h.shares !== undefined && totalShares)
    const mismatched = stated.filter((h) => Math.abs((h.shares! / totalShares) * 100 - h.percent!) > 0.5)
    if (mismatched.length)
      issues.push({
        level: "error",
        message: `The MOA is inconsistent: share counts (${holders.map((h) => `${personCase(h.name)} ${h.shares}`).join(", ")} of ${totalShares}) do not match the stated percentages (${holders.map((h) => `${h.percent}%`).join(", ")}). The stated percentages were used and values were calculated from share counts; confirm with the company.`,
      })
    const shareCount = moa.find((m) => m.data.shareCount)?.data.shareCount
    if (shareCount && totalShares && shareCount !== totalShares)
      issues.push({ level: "warning", message: `The MOA states ${shareCount} shares in total, but the shareholders listed hold ${totalShares}.` })
    sources.partners = docLabel.moa
    // Licence partners cross-check.
    const licPartners = lic.flatMap((l) => l.data.partners)
    for (const p of licPartners) {
      const match = partners.find((x) => samePerson(x.name, p.name))
      if (!match) issues.push({ level: "warning", message: `${p.name} appears on the licence but not in the MOA.` })
      else if (p.sharePercent && Math.abs(p.sharePercent - match.sharePercent) > 0.01)
        issues.push({ level: "warning", message: `${p.name}: ${p.sharePercent}% per licence, ${match.sharePercent}% per MOA.` })
      else if (!match.nationality && p.nationality) match.nationality = p.nationality
    }
  } else {
    const licPartners = lic.flatMap((l) => l.data.partners)
    if (licPartners.length) {
      partners = licPartners.map((p) => ({ ...p, name: fullName(p.name), shareValue: capital ? round2((capital * p.sharePercent) / 100) : 0 }))
      sources.partners = licLabel(lic[0].doc)
    }
  }
  if (partners.length) {
    fields.partners = partners
    const total = round2(partners.reduce((s, p) => s + p.sharePercent, 0))
    if (Math.abs(total - 100) > 0.01)
      issues.push({ level: "error", message: `Partner shares add up to ${total}%, not 100%.` })
    const valueTotal = round2(partners.reduce((s, p) => s + p.shareValue, 0))
    if (capital && valueTotal && Math.abs(valueTotal - capital) > 0.5)
      issues.push({ level: "warning", message: `Partner share values total AED ${valueTotal.toLocaleString("en-AE")}, but the capital is AED ${capital.toLocaleString("en-AE")}.` })
    if (partners.some((p) => !p.shareValue))
      issues.push({ level: "info", message: "Share values are not stated in the documents provided. Upload the MOA or enter the values." })
    if (partners.some((p) => !p.nationality))
      issues.push({ level: "info", message: "Partner nationality is not stated in the documents provided." })
  }

  // VAT certificate.
  if (vat) {
    fields.vat = {}
    const v = vat.data
    const label = docLabel.vatCertificate
    if (v.trn) {
      fields.vat.trn = v.trn
      sources["vat.trn"] = label
    }
    if (v.effectiveDate) {
      fields.vat.effectiveDate = v.effectiveDate
      sources["vat.effectiveDate"] = label
    }
    if (v.frequency) {
      fields.vat.frequency = v.frequency
      sources["vat.frequency"] = label
    }
    if (v.cycleStartMonth) {
      fields.vat.cycleStartMonth = v.cycleStartMonth
      sources["vat.cycleStartMonth"] = label
    }
    if (!v.trn) issues.push({ level: "error", message: "VAT certificate: the Tax Registration Number could not be read." })
  }
  if (ct) {
    fields.ct = {}
    const c = ct.data
    const label = docLabel.ctCertificate
    if (c.trn) {
      fields.ct.trn = c.trn
      sources["ct.trn"] = label
    }
    if (c.firstPeriodStart) {
      fields.ct.firstPeriodStart = c.firstPeriodStart
      sources["ct.firstPeriodStart"] = label
    }
    if (c.yearEndMonth) {
      fields.ct.yearEndMonth = c.yearEndMonth
      sources["ct.yearEndMonth"] = label
    }
    if (!c.trn) issues.push({ level: "error", message: "Corporate tax certificate: the Tax Registration Number could not be read." })
    if (c.licenseNumber && fields.licenseNumber && c.licenseNumber !== fields.licenseNumber && !lic.some((l) => l.data.licenseNumber === c.licenseNumber))
      issues.push({ level: "warning", message: `The corporate tax certificate lists licence ${c.licenseNumber}; the licence uploaded is ${fields.licenseNumber}.` })
  }

  // Fields the documents did not contain.
  const missing: [string, unknown][] = [
    ["Company name", fields.name],
    ["Licensing authority", fields.authority],
    ["License issue date", fields.licenseIssueDate],
    ["Business activity", fields.businessActivity],
    ["Manager", fields.manager],
    ["Partners / owners", fields.partners],
  ]
  const absent = missing.filter(([, v]) => !v).map(([k]) => k)
  if (absent.length) issues.push({ level: "warning", message: `Not found in the documents: ${absent.join(", ")}. Enter these manually.` })

  return {
    fields,
    sources,
    issues,
    documents: detected.map((d) => ({
      type: d.type,
      filename: d.filename,
      detected: d.detected,
      authority: detectAuthority(prepareLines(d.text).join(" "))?.name,
    })),
  }
}

/** Kept for older callers: rule extraction from text keyed by document type. */
export function extractWithRules(texts: Partial<Record<CompanyDocType, string>>) {
  return extractCompanyDetails(
    Object.entries(texts)
      .filter(([, text]) => text)
      .map(([type, text]) => ({ type: type as CompanyDocType, text: text! }))
  ).fields
}

export { emirateFromAuthority }
