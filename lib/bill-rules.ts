import { categorise, categoryByKey } from "./bank-categories"
import { normaliseDate } from "./document-rules"

/**
 * Reads a supplier bill, receipt or purchase invoice from its text (PDF text or OCR).
 * Every field is optional: what cannot be read is left blank for the user.
 */
export type BillFields = {
  supplier?: string
  vendorTrn?: string
  date?: string
  number?: string
  net?: number
  vat?: number
  total?: number
  payment?: "cash" | "card" | "bank" | "credit"
  description?: string
  ledgerName?: string
  scheduleKey?: string
}

const AMOUNT = /(?:AED|DHS?|د\.إ)?\s*(-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})|-?\d+(?:\.\d{1,2})?)\b/
const toNumber = (s: string) => Number(s.replace(/[,\s]/g, ""))
const round2 = (n: number) => Math.round(n * 100) / 100

function lines(text: string) {
  return text
    .replace(/\[\[page\]\]|\[OCR\]/g, "\n")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

/** The last amount on the line (or the next line) that carries the label. */
function amountAfter(all: string[], label: RegExp, exclude?: RegExp): number | undefined {
  for (let i = all.length - 1; i >= 0; i--) {
    const line = all[i]
    if (!label.test(line) || (exclude && exclude.test(line))) continue
    const tail = line.replace(label, " ")
    const found = [...tail.matchAll(new RegExp(AMOUNT.source, "g"))].map((m) => toNumber(m[1])).filter((n) => Number.isFinite(n) && !(n > 0 && n <= 100 && /%/.test(tail) && tail.includes(`${n}%`)))
    if (found.length) return found[found.length - 1]
    const next = all[i + 1]?.match(new RegExp(`^${AMOUNT.source}$`))
    if (next) return toNumber(next[1])
  }
  return undefined
}

export function readBill(text: string, options: { ownTrn?: string; ownName?: string } = {}): BillFields {
  const all = lines(text)
  const joined = all.join("\n")
  const out: BillFields = {}

  // Supplier TRN: a 15-digit number starting 100, which is not the company's own.
  const trns = [...joined.matchAll(/\b(1\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/g)].map((m) => m[1].replace(/\D/g, "")).filter((t) => t.length === 15 && t !== options.ownTrn)
  if (trns[0]) out.vendorTrn = trns[0]

  // Supplier: the first line that looks like a business name, before the bill details.
  const own = (options.ownName ?? "").toLowerCase().replace(/[^a-z]/g, "")
  const skip = /^(tax invoice|invoice|receipt|bill|purchase|cash memo|quotation|page|date|trn|tel|phone|fax|email|p\.?o\.? box|www\.|http|to:|bill to|ship to|customer|[\d\W]+$)/i
  const businessy = /\b(l\.?l\.?c|fze|fzco|fz-llc|trading|est\.?|establishment|company|co\.|services|group|ltd|limited|restaurant|cafe|supermarket|hypermarket|pharmacy|electronics|contracting|technical|enterprises|international|stores?)\b/i
  const head = all.slice(0, 14).filter((l) => !skip.test(l) && /[a-z]{3}/i.test(l) && l.length <= 80 && (!own || !l.toLowerCase().replace(/[^a-z]/g, "").includes(own.slice(0, 12))))
  out.supplier = (head.find((l) => businessy.test(l)) ?? head[0])?.replace(/\s*(tax invoice|invoice)\s*$/i, "").trim()
  const labelled = joined.match(/(?:supplier|vendor|seller|from)\s*(?:name)?\s*[:\-]\s*([^\n]{3,80})/i)
  if (labelled) out.supplier = labelled[1].trim()

  // Bill number and date
  const number = joined.match(/(?:invoice|inv|bill|receipt|document|tax invoice)\s*(?:no\.?|number|#|num)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i)
  if (number && !/^(date|trn)$/i.test(number[1])) out.number = number[1]
  const dated = joined.match(/(?:invoice|bill|receipt|document|tax invoice|issue)?\s*date\s*[:\-]?\s*([0-9]{1,2}[/.\-][0-9]{1,2}[/.\-][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\s\-][A-Za-z]{3,9}[\s\-,]+[0-9]{4}|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4})/i)
  const anyDate = dated?.[1] ?? joined.match(/\b([0-9]{1,2}[/.\-][0-9]{1,2}[/.\-][0-9]{4})\b/)?.[1]
  if (anyDate && normaliseDate(anyDate)) out.date = normaliseDate(anyDate)

  // Amounts: total with VAT, VAT, and the amount before VAT.
  const total = amountAfter(all, /(grand total|total amount (?:due|payable|incl\.?(?:uding)? vat)|total (?:incl\.?(?:uding)?|inclusive of|with) vat|amount due|net payable|total payable|balance due|total \(aed\)|total aed|^total\b)/i, /sub ?total|before vat|excl/i)
  const vat = amountAfter(all, /(vat\s*(?:amount|@|5\s*%|\(5%\)|total)?|value added tax|tax amount|total vat)/i, /trn|registration|incl|before|excl|exclusive|number|no\./i)
  const net = amountAfter(all, /(sub ?total|total (?:before|excl\.?(?:uding)?|exclusive of|without) vat|taxable amount|net amount|amount before vat|total excl)/i)
  if (total !== undefined) out.total = round2(total)
  if (vat !== undefined && (!total || vat < total)) out.vat = round2(vat)
  if (net !== undefined && (!total || net <= total)) out.net = round2(net)
  // Fill the third from the other two; check they add up.
  if (out.total !== undefined && out.vat !== undefined && out.net === undefined) out.net = round2(out.total - out.vat)
  if (out.total !== undefined && out.net !== undefined && out.vat === undefined) out.vat = round2(out.total - out.net)
  if (out.net !== undefined && out.vat !== undefined && out.total === undefined) out.total = round2(out.net + out.vat)
  if (out.net !== undefined && out.vat !== undefined && out.total !== undefined && Math.abs(out.net + out.vat - out.total) > 0.05) {
    // Trust the total and 5% VAT where the figures do not agree.
    out.net = round2(out.total / 1.05)
    out.vat = round2(out.total - out.net)
  }
  if (out.total !== undefined && out.vat === undefined && out.net === undefined) {
    out.net = out.total
    out.vat = 0
  }

  // How it was paid
  if (/\b(paid (in|by) cash|cash (sale|payment|received|memo)|payment mode\s*:?\s*cash|cash\s*:?\s*\d)/i.test(joined)) out.payment = "cash"
  else if (/\b(visa|mastercard|master card|amex|credit card|debit card|card no|card payment|paid by card|\*{4}\s?\d{4}|xxxx\s?\d{4})\b/i.test(joined)) out.payment = "card"
  else if (/\b(bank transfer|wire transfer|iban|swift|cheque|payment terms|due date|net \d+ days)\b/i.test(joined)) out.payment = "bank"

  // What it is for
  const items = all.filter((l) => /[a-z]{4}/i.test(l) && /\d/.test(l) && !/total|vat|trn|date|invoice|tel|phone|box|email|iban|account/i.test(l)).slice(0, 3)
  if (items.length) out.description = items.map((l) => l.replace(new RegExp(`${AMOUNT.source}`, "g"), "").replace(/\s+/g, " ").trim()).filter(Boolean).join("; ").slice(0, 300)
  const guess = categorise({ id: "", date: "", description: `${out.supplier ?? ""} ${joined.slice(0, 3000)}`, amount: -1 } as never)
  const category = categoryByKey.get(guess.category !== "review" ? guess.category : "")
  if (category?.ledgerName && category.group !== "Balance sheet" && category.group !== "Not counted") {
    out.ledgerName = category.ledgerName
    out.scheduleKey = category.scheduleKey
  }
  if (/\b(laptop|computer|furniture|vehicle|machinery|equipment|printer|server|fit[- ]?out)\b/i.test(joined) && (out.net ?? 0) >= 2000) {
    out.ledgerName = "Fixed Assets"
    out.scheduleKey = "ppe"
  }
  for (const key of Object.keys(out) as (keyof BillFields)[]) if (out[key] === undefined || out[key] === "") delete out[key]
  return out
}
