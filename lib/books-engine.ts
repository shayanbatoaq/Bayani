import { billTotal, documentTotals, round2, type BankLineRef, type Books, type Invoice, type Bill } from "./books"

/**
 * The accounting behind invoices, credit notes, bills, payments and adjusting schedules.
 * Every document becomes a dated double entry; a year's trial balance rows are the entries
 * of that year (movement) or every entry up to the year end with earlier profit closed into
 * retained earnings (closing balances). Rows carry ids starting "books-" and are never saved
 * with the typed figures: they are added when the records are read.
 */

export const BOOKS_PREFIX = "books-"
export const isBookRow = (row: { id: string }) => row.id.startsWith(BOOKS_PREFIX)

type Leg = { ledgerName: string; scheduleKey: string; amount: number }
/** carryOnly: an opening balance used only when earlier years are brought into a closing balance year. */
export type Entry = { date: string; source: string; legs: Leg[]; carryOnly?: boolean }
export type BookRow = { id: string; ledgerName: string; amount: number; scheduleKey: string }

const AR = { ledgerName: "Accounts Receivable", scheduleKey: "receivables" }
const AP = { ledgerName: "Accounts Payable", scheduleKey: "payables" }
const SALES = { ledgerName: "Revenue", scheduleKey: "sales" }
const VAT = { ledgerName: "VAT Control", scheduleKey: "vat" }
const BANK = { ledgerName: "Bank", scheduleKey: "bank" }
const CASH = { ledgerName: "Cash in Hand", scheduleKey: "cash" }
const PREPAID = { ledgerName: "Prepaid Expense", scheduleKey: "prepayments" }
const ASSETS = { ledgerName: "Fixed Assets", scheduleKey: "ppe" }
const ALLOWANCE = { ledgerName: "Allowance for Depreciation", scheduleKey: "ppe" }
const DEPRECIATION = { ledgerName: "Depreciation Expense", scheduleKey: "depreciation" }
const ACCRUALS = { ledgerName: "Accrued Expenses", scheduleKey: "accruals" }
const RETAINED = { ledgerName: "Retained Earnings", scheduleKey: "retained" }

const leg = (head: { ledgerName: string; scheduleKey: string }, amount: number): Leg => ({ ...head, amount: round2(amount) })
const BALANCE_SHEET = new Set([
  "ppe", "financialAssets", "inventory", "receivables", "deposits", "supplierAdvances", "prepayments", "taxReceivable", "otherReceivables", "relatedReceivable",
  "cash", "bank", "longTermLiabilities", "directorLoan", "payables", "accruals", "customerAdvances", "taxPayable", "otherPayables", "relatedPayable", "endOfService",
  "shareholder", "capital", "retained", "dividends", "vat",
])

/* ---------------- months ---------------- */

const monthStart = (date: string, add: number) => {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + add)
  return d.toISOString().slice(0, 10)
}
const monthEnd = (date: string, add: number) => {
  const d = new Date(`${monthStart(date, add + 1)}T00:00:00Z`)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}
/** Equal monthly instalments, the last taking the rounding; each dated at its month end. */
export function instalments(amount: number, start: string, months: number) {
  const each = round2(amount / months)
  return Array.from({ length: months }, (_, i) => ({ date: monthEnd(start, i), amount: i === months - 1 ? round2(amount - each * (months - 1)) : each }))
}
export const scheduleEnd = (start: string, months: number) => monthEnd(start, months - 1)

/* ---------------- what is owed ---------------- */

export function invoiceStatus(books: Books, invoice: Invoice, asOf?: string) {
  const total = documentTotals(invoice.lines).total
  const credited = round2(books.creditNotes.filter((c) => c.invoiceId === invoice.id && (!asOf || c.date <= asOf)).reduce((t, c) => t + documentTotals(c.lines).total, 0))
  const paid = round2(books.payments.filter((p) => p.kind === "invoice" && p.docId === invoice.id && (!asOf || p.date <= asOf)).reduce((t, p) => t + p.amount, 0))
  const due = round2(total - credited - paid)
  const status: "paid" | "partial" | "unpaid" | "credited" = due <= 0.004 ? (paid > 0 ? "paid" : "credited") : paid > 0 || credited > 0 ? "partial" : "unpaid"
  return { total, credited, paid, due: Math.max(0, due), overpaid: due < -0.004 ? -due : 0, status }
}
export function billStatus(books: Books, bill: Bill, asOf?: string) {
  const total = billTotal(bill)
  const paid = round2(books.payments.filter((p) => p.kind === "bill" && p.docId === bill.id && (!asOf || p.date <= asOf)).reduce((t, p) => t + p.amount, 0))
  const due = round2(total - paid)
  return { total, paid, due: Math.max(0, due), status: (due <= 0.004 ? "paid" : paid > 0 ? "partial" : "unpaid") as "paid" | "partial" | "unpaid" }
}

/* ---------------- entries ---------------- */

export function bookEntries(books: Books): Entry[] {
  const entries: Entry[] = []
  const settle = (method: string) => (method === "cash" ? CASH : BANK)

  for (const invoice of books.invoices) {
    const t = documentTotals(invoice.lines)
    entries.push({ date: invoice.date, source: `Invoice ${invoice.number}`, legs: [leg(AR, t.total), leg(SALES, -t.net), leg(VAT, -t.vat)] })
  }
  for (const note of books.creditNotes) {
    const t = documentTotals(note.lines)
    entries.push({ date: note.date, source: `Credit note ${note.number}`, legs: [leg(AR, -t.total), leg(SALES, t.net), leg(VAT, t.vat)] })
  }
  for (const bill of books.bills) {
    const target = bill.treatment === "prepaid" && bill.months ? PREPAID : bill.treatment === "asset" ? ASSETS : { ledgerName: bill.ledgerName, scheduleKey: bill.scheduleKey }
    // Reverse charge: the supplier charges no VAT and the output and input VAT cancel out.
    const vat = bill.vatTreatment === "reverseCharge" ? 0 : bill.vat
    entries.push({ date: bill.date, source: `Bill ${bill.number || bill.id}`, legs: [leg(target, bill.net), leg(VAT, vat), leg(AP, -round2(bill.net + vat))] })
  }
  for (const p of books.payments) {
    // Statement lines are already in the bank figures, sorted to the receivable or payable.
    if (p.method === "bankLine") continue
    if (p.kind === "invoice") entries.push({ date: p.date, source: "Customer payment", legs: [leg(settle(p.method), p.amount), leg(AR, -p.amount)] })
    else entries.push({ date: p.date, source: "Supplier payment", legs: [leg(AP, p.amount), leg(settle(p.method), -p.amount)] })
  }
  for (const s of books.schedules) {
    // A statement line paid for it: in a closing balance year the earlier statements are not in the
    // figures (their bank balance is already in the opening funds), so the payment is carried in.
    if (s.source.type === "bankLine")
      entries.push({ date: s.source.line.date, source: s.label, carryOnly: true, legs: [leg(s.kind === "depreciation" ? ASSETS : PREPAID, s.amount), leg(RETAINED, -s.amount)] })
    const expense = s.kind === "depreciation" ? DEPRECIATION : { ledgerName: s.ledgerName, scheduleKey: s.scheduleKey }
    const against = s.kind === "depreciation" ? ALLOWANCE : PREPAID
    for (const part of instalments(s.amount, s.start, s.months))
      entries.push({ date: part.date, source: s.label, legs: [leg(expense, part.amount), leg(against, -part.amount)] })
  }
  for (const a of books.accruals) {
    const expense = { ledgerName: a.ledgerName, scheduleKey: a.scheduleKey }
    entries.push({ date: a.date, source: a.label, legs: [leg(expense, a.amount), leg(ACCRUALS, -a.amount)] })
    // Reversed on the first day after the accrual's month, when the actual cost is booked.
    if (a.reverse) entries.push({ date: monthStart(a.date, 1), source: `${a.label} (reversed)`, legs: [leg(ACCRUALS, a.amount), leg(expense, -a.amount)] })
  }
  return entries
}

/**
 * Trial balance rows from the books for one financial year.
 * flows: only the year's entries (a movement year built on the previous year's balances);
 * otherwise everything up to the year end, with earlier years' profit in retained earnings.
 */
export function bookRows(books: Books, period: { start: string; end: string }, flows: boolean): BookRow[] {
  const totals = new Map<string, Leg>()
  const add = (l: Leg) => {
    const key = `${l.ledgerName}|${l.scheduleKey}`
    const t = totals.get(key) ?? { ...l, amount: 0 }
    t.amount = round2(t.amount + l.amount)
    totals.set(key, t)
  }
  for (const entry of bookEntries(books)) {
    if (entry.date > period.end) continue
    if (entry.date >= period.start) {
      if (!entry.carryOnly) entry.legs.forEach(add)
    }
    else if (!flows) for (const l of entry.legs) add(BALANCE_SHEET.has(l.scheduleKey) ? l : { ...RETAINED, amount: l.amount })
  }
  return [...totals.values()]
    .filter((l) => Math.abs(l.amount) >= 0.005)
    .map((l, i) => ({
      id: `${BOOKS_PREFIX}${i}-${l.ledgerName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      ledgerName: l.ledgerName,
      amount: l.amount,
      scheduleKey: l.scheduleKey === "vat" ? (l.amount >= 0 ? "taxReceivable" : "taxPayable") : l.scheduleKey,
    }))
}

/** Years (by financial period) in which the books have entries. */
export function bookYears(books: Books, periodOf: (year: number) => { start: string; end: string }) {
  const years = new Set<number>()
  for (const entry of bookEntries(books)) {
    if (entry.carryOnly) continue
    let year = Number(entry.date.slice(0, 4))
    if (entry.date > periodOf(year).end) year++
    else if (entry.date < periodOf(year).start) year--
    years.add(year)
  }
  return [...years].sort()
}

/* ---------------- statement lines ---------------- */

export type LineLink = { category: string; label: string; href: string }

/** Same line, also when the statements were uploaded again (new ids). */
export const sameLine = (ref: BankLineRef, line: { id: string; date: string; amount: number; description: string }) =>
  ref.id === line.id || (ref.date === line.date && Math.abs(ref.amount - line.amount) < 0.005 && ref.description.trim() === line.description.trim())

/** The category a statement line must have because a payment or schedule is linked to it. */
export function linkedLine(books: Books, line: { id: string; date: string; amount: number; description: string }): LineLink | null {
  const payment = books.payments.find((p) => p.bankLine && sameLine(p.bankLine, line))
  if (payment) {
    if (payment.kind === "invoice") {
      const inv = books.invoices.find((i) => i.id === payment.docId)
      return { category: "receivable", label: `Payment for invoice ${inv?.number ?? ""}`.trim(), href: "/invoices" }
    }
    const bill = books.bills.find((b) => b.id === payment.docId)
    return { category: "payable", label: `Payment of bill ${bill?.number || bill?.description || ""}`.trim(), href: "/bills" }
  }
  const schedule = books.schedules.find((s) => s.source.type === "bankLine" && sameLine(s.source.line, line))
  if (schedule) return { category: schedule.kind === "depreciation" ? "assets" : "prepaid", label: `${schedule.kind === "depreciation" ? "Depreciated" : "Spread"} over ${schedule.months} months`, href: "/adjustments" }
  return null
}

export type MatchCandidate = { kind: "invoice" | "bill"; id: string; number: string; party: string; due: number; date: string; reason: "amount" | "name" | "both" }

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(l\.?l\.?c|fze|fzco|fz|dmcc|co|company|trading|est|establishment|limited|ltd|the|and|for|of|general|services?)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)

type Open = { kind: "invoice" | "bill"; id: string; number: string; party: string; partyWords: string[]; due: number; total: number; date: string }
const openCache = new WeakMap<Books, Open[]>()
/** Invoices and bills not yet fully paid, worked out once per version of the books. */
function openDocuments(books: Books): Open[] {
  const cached = openCache.get(books)
  if (cached) return cached
  const out: Open[] = []
  for (const inv of books.invoices) {
    const st = invoiceStatus(books, inv)
    if (st.due <= 0) continue
    const party = books.clients.find((c) => c.id === inv.clientId)?.name ?? ""
    out.push({ kind: "invoice", id: inv.id, number: inv.number, party, partyWords: words(party), due: st.due, total: st.total, date: inv.date })
  }
  for (const bill of books.bills) {
    const st = billStatus(books, bill)
    if (st.due <= 0) continue
    const party = books.vendors.find((v) => v.id === bill.vendorId)?.name ?? ""
    out.push({ kind: "bill", id: bill.id, number: bill.number, party, partyWords: words(party), due: st.due, total: st.total, date: bill.date })
  }
  openCache.set(books, out)
  return out
}

/** Open invoices (money in) or bills (money out) a statement line could be paying. */
export function matchCandidates(books: Books, line: { amount: number; description: string; date: string }): MatchCandidate[] {
  const text = ` ${words(line.description).join(" ")} `
  const lower = line.description.toLowerCase()
  const kind = line.amount > 0 ? "invoice" : "bill"
  const paid = Math.abs(line.amount)
  const out: MatchCandidate[] = []
  for (const doc of openDocuments(books)) {
    if (doc.kind !== kind || doc.date > line.date) continue
    const amount = Math.abs(doc.due - paid) < 0.01 || Math.abs(doc.total - paid) < 0.01
    const name = (doc.partyWords.length > 0 && doc.partyWords.slice(0, 2).every((x) => text.includes(` ${x} `))) || (doc.number.length > 3 && lower.includes(doc.number.toLowerCase()))
    if (amount || name) out.push({ kind, id: doc.id, number: doc.number || "(no number)", party: doc.party, due: doc.due, date: doc.date, reason: amount && name ? "both" : amount ? "amount" : "name" })
  }
  const rank = { both: 0, amount: 1, name: 2 }
  return out.sort((a, b) => rank[a.reason] - rank[b.reason] || b.date.localeCompare(a.date)).slice(0, 5)
}
