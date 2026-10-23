import { categorise, categoryByKey } from "./bank-categories"
import { normaliseDate } from "./document-rules"
import { currencyIn } from "./fx"

/**
 * Reads a supplier bill, receipt or purchase invoice from its text (PDF text layer or OCR).
 *
 * Amounts are not taken from whichever line happens to say "Total": every amount on the
 * document is collected and the reading is the combination that is arithmetically true:
 * amount before VAT + VAT = total, with the VAT 5% of the amount before it (or a zero-rated
 * total when the document says so). The labels beside the figures only break ties. When no
 * combination proves out, the amounts are left for the user and flagged, never guessed.
 */
export type BillFields = {
  /** Currency the bill is in, when the document shows one. */
  currency?: string
  supplier?: string
  address?: string
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
export type BillCheck = {
  /** proven: net + VAT = total and VAT is 5% of net (or zero-rated stated); partial: some amounts found; none: no amounts. */
  amounts: "proven" | "partial" | "none"
  notes: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol

function lines(text: string) {
  return text
    .replace(/\[\[page\]\]|\[OCR\]/g, "\n")
    .split(/\r?\n|\f/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

/* ---------------- amounts ---------------- */

type Label = "total" | "vat" | "net" | "none"
type Money = { value: number; line: number; label: Label; text: string }

const TOTAL = /\b(grand total|total amount|amount due|balance due|net payable|total payable|amount payable|invoice total|total due|total \(?aed\)?|total (incl\.?(uding)?|inclusive of|with) (vat|tax)|total|net amount payable|you pay|amount to pay)\b|^(sale |purchase |txn |transaction )?amount\b|الإجمالي|المجموع/i
const VAT = /\b(vat|tax|value added tax|standard rate|output tax|input tax)\b|ضريبة/i
const NET = /\b(sub ?-?total|taxable (amount|value|supplies)|amount (before|excl\.?(uding)?|exclusive of|without) (vat|tax)|total (before|excl\.?(uding)?|exclusive of|without) (vat|tax)|net amount|net value|total excl|excl\.? vat|value of supply)\b/i
const ZERO_RATED = /\b(zero[- ]rated|0 ?% (vat|tax)|(vat|tax) ?(@|at)? ?0(\.0+)? ?%|exempt|out of scope|not subject to vat|reverse charge)\b/i

function labelOf(line: string): Label {
  const words = line.replace(/[\d,.]+/g, " ")
  if (NET.test(words)) return "net"
  // "Total VAT", "Tax amount" and "Incl. VAT 5%" are the VAT; "Total incl. VAT" is the total.
  const totalWith = /\btotal\b/i.test(words) && /\b(incl|inclusive|including|with)\b/i.test(words)
  if (VAT.test(words) && !totalWith && !/taxable/i.test(words)) return "vat"
  if (TOTAL.test(words)) return "total"
  return "none"
}

/** Every money amount on the bill with the label of its line. Dates, TRNs, phone numbers and rates are skipped. */
function amounts(all: string[]): Money[] {
  const out: Money[] = []
  all.forEach((line, i) => {
    const clean = line
      .replace(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/g, " ") // dates
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
      .replace(/(\+?\d[\d\s-]{8,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 9 && !/\s{2,}/.test(m) ? " " : m)) // TRNs, phones, account numbers
      .replace(/\b\d+(\.\d+)?\s?%/g, " ") // rates
    const label = labelOf(line)
    for (const m of clean.matchAll(/(?:AED|DHS?|Dhs\.?|د\.إ)?\s?(-?\(?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\)?|-?\(?\d+\.\d{1,2}\)?|\b\d+\b)/gi)) {
      const raw = m[1]
      const value = Number(raw.replace(/[(),]/g, ""))
      if (!Number.isFinite(value) || value <= 0 || value > 1e10) continue
      // Whole numbers without decimals are only money on labelled lines (quantities, item numbers otherwise).
      if (!/[.,]/.test(raw) && label === "none") continue
      out.push({ value, line: i, label, text: line })
    }
  })
  return out
}

type Solution = { net: number; vat: number; total: number; proven: boolean; score: number; note?: string }

/** The combination of the bill's own amounts that adds up. */
export function solveAmounts(all: string[]): Solution | null {
  const money = amounts(all)
  if (!money.length) return null
  const joined = all.join("\n")
  const values = [...new Set(money.map((m) => m.value))]
  const labelled = (v: number, label: Label) => money.some((m) => m.value === v && m.label === label)
  // Later lines are usually the summary; the last occurrence counts.
  const lastLine = (v: number) => Math.max(...money.filter((m) => m.value === v).map((m) => m.line))
  const best: Solution[] = []

  // 1. Before VAT + 5% VAT = total, all three printed.
  for (const n of values)
    for (const v of values) {
      if (v >= n) continue
      const tol = Math.max(0.06, n * 0.0002)
      if (Math.abs(v - n * 0.05) > tol) continue
      const total = values.find((c) => near(c, n + v))
      if (total === undefined) continue
      const score =
        (labelled(total, "total") ? 4 : 0) + (labelled(v, "vat") ? 3 : 0) + (labelled(n, "net") ? 2 : 0) + (lastLine(total) >= lastLine(n) ? 1 : 0)
      best.push({ net: n, vat: v, total, proven: true, score: score * 1e12 + total })
    }
  // 2. A VAT-inclusive receipt: total and the VAT in it (5/105), the amount before VAT not printed.
  if (!best.length)
    for (const c of values)
      for (const v of values) {
        if (v >= c || !labelled(v, "vat") || !labelled(c, "total")) continue
        if (Math.abs(v - (c * 5) / 105) > Math.max(0.06, c * 0.0002)) continue
        best.push({ net: round2(c - v), vat: v, total: c, proven: true, score: 1e12 + c, note: "VAT included in the total" })
      }
  if (best.length) return best.sort((a, b) => b.score - a.score)[0]

  // 3. No VAT on the bill: a total that the document states is zero-rated, exempt or without VAT.
  const totals = money.filter((m) => m.label === "total").map((m) => m.value)
  const zeroVat = money.some((m) => m.label === "vat" && /\b0(\.0+)?\b/.test(m.text.replace(/[\d,]+\.\d{2}/g, (x) => (Number(x.replace(/,/g, "")) === 0 ? "0" : "x"))))
  if (totals.length && (ZERO_RATED.test(joined) || zeroVat || !VAT.test(joined.replace(/\bTRN\b|tax invoice|tax registration/gi, "")))) {
    const total = Math.max(...totals)
    const net = money.find((m) => m.label === "net" && near(m.value, total))
    return { net: total, vat: 0, total, proven: Boolean(net) || ZERO_RATED.test(joined) || zeroVat, score: 0, note: "No VAT charged on this bill" }
  }
  // 4. Nothing adds up: report the largest labelled total only.
  if (totals.length) return { net: NaN, vat: NaN, total: Math.max(...totals), proven: false, score: 0 }
  return null
}

/* ---------------- the rest of the bill ---------------- */

const BUSINESS = /\b(l\.?l\.?c|fze|fzco|fz-llc|fz llc|trading|est\.?|establishment|company|co\.|services|group|ltd|limited|restaurant|cafe|supermarket|hypermarket|pharmacy|electronics|contracting|technical|enterprises|international|stores?|solutions|consultants?|industries|motors|travels?|hotel|clinic|hospital|telecommunications?|authority|electricity|water)\b/i
const NOT_NAME = /^(tax invoice|invoice|receipt|bill|purchase|cash memo|quotation|page|date|trn|tel|phone|fax|email|e-mail|p\.?o\.? ?box|www\.|http|to:|bill to|ship to|sold to|customer|client|from|original|copy|[\d\W]+$)/i

function supplierOf(all: string[], ownName: string) {
  const own = ownName.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14)
  const isOwn = (l: string) => Boolean(own) && l.toLowerCase().replace(/[^a-z]/g, "").includes(own)
  const labelled = all.join("\n").match(/(?:supplier|vendor|seller|merchant|sold by|issued by|from)\s*(?:name)?\s*[:\-]\s*([^\n]{3,80})/i)
  if (labelled && !isOwn(labelled[1])) return labelled[1].trim()
  // The block before "Bill to" / "Customer" is the issuer.
  const stop = all.findIndex((l) => /^(bill(ed)? to|invoice to|sold to|customer|client|ship to|buyer)\b/i.test(l))
  const head = all.slice(0, stop > 0 ? Math.min(stop, 16) : 16).filter((l) => !NOT_NAME.test(l) && /[a-z]{3}/i.test(l) && l.length <= 90 && !isOwn(l))
  const legal = /\b(l\.?\s?l\.?\s?c\.?|fze|fzco|fz-?llc|llc|ltd|limited|est\.?|establishment|company|corporation|inc\.?|plc|p\.?j\.?s\.?c|w\.?l\.?l)\b/i
  return (head.find((l) => legal.test(l)) ?? head.find((l) => BUSINESS.test(l)) ?? head[0])?.replace(/\s*(tax invoice|invoice)\s*$/i, "").trim()
}

/** What was bought: the item lines of the table (description column), not addresses. */
function itemsOf(all: string[]) {
  const start = all.findIndex((l) => /\b(description|particulars|item|details|service)\b/i.test(l) && /\b(qty|quantity|amount|rate|price|total)\b/i.test(l))
  if (start < 0) return ""
  const end = all.findIndex((l, i) => i > start && /^(sub ?total|total|taxable|amount in words|tax summary|vat summary)\b/i.test(l))
  const rows = all.slice(start + 1, end > start ? end : start + 25)
  const items = rows
    .filter((l) => /^\d{1,3}\s/.test(l) || /\d[\d,]*\.\d{2}/.test(l))
    .map((l) =>
      l
        .replace(/^\d{1,3}\s+/, "")
        .replace(/(\s+-?[\d,]+(\.\d+)?%?)+\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter((l) => /[a-z]{3}/i.test(l))
  return items.slice(0, 6).join("; ").slice(0, 400)
}

export function readBill(text: string, options: { ownTrn?: string; ownName?: string } = {}): BillFields & { check: BillCheck } {
  const all = lines(text)
  const joined = all.join("\n")
  const out: BillFields = {}
  const notes: string[] = []

  // Supplier TRN: 15 digits starting with 1, not the company's own (the first one printed is usually the issuer's).
  const trns = [...joined.matchAll(/\b(1\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/g)].map((m) => m[1].replace(/\D/g, "")).filter((t) => t.length === 15 && t !== options.ownTrn)
  if (trns[0]) out.vendorTrn = trns[0]

  out.supplier = supplierOf(all, options.ownName ?? "")
  // The supplier's address: the lines under its name, up to its TRN or the customer block.
  const at = out.supplier ? all.indexOf(out.supplier) : -1
  if (at >= 0) {
    const block: string[] = []
    for (const l of all.slice(at + 1, at + 6)) {
      if (/^(trn|tax registration|vat reg|bill(ed)? to|invoice to|customer|sold to|tax invoice|invoice|tel|phone|email|e-mail|www)/i.test(l) || /\d[\d,]*\.\d{2}/.test(l)) break
      block.push(l)
    }
    if (block.length) out.address = block.join(", ").slice(0, 300)
  }

  const number = joined.match(/(?:invoice|inv|bill|receipt|document|tax invoice|doc)\s*(?:no\.?|number|num|#)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i) ?? joined.match(/^#\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})$/im)
  if (number && !/^(date|trn)$/i.test(number[1])) out.number = number[1]

  const dated = joined.match(
    /(?:invoice|inv|bill|receipt|document|tax invoice|issue|txn|transaction)?\.?\s*date\s*[:\-]?\s*([0-9]{1,2}[/.\-][0-9]{1,2}[/.\-][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[\s\-][A-Za-z]{3,9}[\s\-,]+[0-9]{4}|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4})/i,
  )
  const anyDate = dated?.[1] ?? joined.match(/\b([0-9]{1,2}[/.\-][0-9]{1,2}[/.\-][0-9]{4}|[0-9]{1,2}[\s\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-,]+[0-9]{4})\b/i)?.[1]
  if (anyDate && normaliseDate(anyDate)) out.date = normaliseDate(anyDate)

  const currency = currencyIn(joined)
  if (currency) out.currency = currency
  const solved = solveAmounts(all)
  let amountsState: BillCheck["amounts"] = "none"
  if (solved) {
    out.total = solved.total
    if (Number.isFinite(solved.net)) {
      out.net = solved.net
      out.vat = solved.vat
    }
    amountsState = solved.proven ? "proven" : "partial"
    if (solved.note) notes.push(solved.note)
    if (!solved.proven) notes.push("The amounts on this document do not add up to a total Bayani can prove. Check the amount before VAT and the VAT.")
  } else notes.push("No amounts were found on this document.")

  if (/\b(paid (in|by) cash|cash (sale|payment|received|memo|bill)|payment (mode|method|type)\s*:?\s*cash|tender(ed)?\s*:?\s*cash)\b/i.test(joined)) out.payment = "cash"
  else if (/\b(visa|mastercard|master card|amex|credit card|debit card|card no|card payment|paid by card|apple pay|google pay|\*{4}\s?\d{4}|x{4}\s?\d{4})\b/i.test(joined)) out.payment = "card"
  else if (/\b(bank transfer|wire transfer|iban|swift|cheque|payment terms|due date|net \d+ days|credit terms)\b/i.test(joined)) out.payment = "bank"

  const items = itemsOf(all)
  if (items) out.description = items

  // Expense head only from who the supplier is and what was bought; left blank when unclear.
  const basis = `${out.supplier ?? ""} ${items}`
  const guess = categorise({ id: "", date: "", description: basis, amount: -1 } as never)
  const category = categoryByKey.get(guess.category)
  const bankish = /\bbank\b/i.test(out.supplier ?? "")
  if (category?.ledgerName && guess.category !== "review" && !["Balance sheet", "Not counted"].includes(category.group) && (!["bankCharges", "interest"].includes(guess.category) || bankish)) {
    out.ledgerName = category.ledgerName
    out.scheduleKey = category.scheduleKey
  }
  if (/\b(laptop|computer|desktop|furniture|vehicle|car purchase|machinery|equipment|printer|server|fit[- ]?out|air ?condition(er|ing) unit)\b/i.test(items) && (out.net ?? 0) >= 2000) {
    out.ledgerName = "Fixed Assets"
    out.scheduleKey = "ppe"
  }
  for (const key of Object.keys(out) as (keyof BillFields)[]) if (out[key] === undefined || out[key] === "") delete out[key]
  return { ...out, check: { amounts: amountsState, notes } }
}
