import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

// Invented clients, suppliers and figures only.
const jiti = createJiti(import.meta.url)
const { applyBooksAction, emptyBooks, documentTotals, nextInvoiceNumber } = await jiti.import("../lib/books.ts")
const { bookRows, bookYears, invoiceStatus, billStatus, linkedLine, matchCandidates, instalments } = await jiti.import("../lib/books-engine.ts")
const { readBill } = await jiti.import("../lib/bill-rules.ts")
const { resolveRecords } = await jiti.import("../lib/movement.ts")

const FY = (y) => ({ start: `${y}-01-01`, end: `${y}-12-31` })
const sum = (rows) => Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100
const get = (rows, name) => Math.round(rows.filter((r) => r.ledgerName === name).reduce((t, r) => t + r.amount, 0) * 100) / 100
const run = (books, ...actions) => actions.reduce((b, a) => applyBooksAction(b, a), books)

const client = { id: "c1", name: "Palm Grove Trading LLC", trn: "", address: "", email: "", phone: "" }
const vendor = { id: "v1", name: "Desert Lights Electrical", trn: "100000000000003", address: "", email: "", phone: "" }
const line = (rate, vat = "standard", quantity = 1) => ({ id: `l${rate}`, item: "Consulting", description: "Advisory", quantity, rate, vat })

function sample() {
  return run(
    emptyBooks(),
    { action: "party", kind: "client", party: client },
    { action: "party", kind: "vendor", party: vendor },
    { action: "invoice", invoice: { id: "i1", number: "INV-1001", date: "2025-03-10", dueDate: "", clientId: "c1", lines: [line(10000)], notes: "" } },
    { action: "invoice", invoice: { id: "i2", number: "INV-1002", date: "2025-11-20", dueDate: "", clientId: "c1", lines: [line(4000, "zero")], notes: "" } },
  )
}

test("invoices post sales, VAT and receivables and number themselves from 1001", () => {
  const books = sample()
  assert.equal(nextInvoiceNumber(books), "INV-1003")
  assert.deepEqual(documentTotals([line(10000)]), { net: 10000, vat: 500, total: 10500 })
  const rows = bookRows(books, FY(2025), true)
  assert.equal(get(rows, "Revenue"), -14000)
  assert.equal(get(rows, "VAT Control"), -500)
  assert.equal(rows.find((r) => r.ledgerName === "VAT Control").scheduleKey, "taxPayable")
  assert.equal(get(rows, "Accounts Receivable"), 14500)
  assert.equal(sum(rows), 0)
  assert.throws(() => applyBooksAction(books, { action: "invoice", invoice: { id: "i3", number: "INV-1001", date: "2025-12-01", clientId: "c1", lines: [line(1)], notes: "", dueDate: "" } }), /already used/)
})

test("a payment from a statement line clears the invoice; a cash receipt posts to cash", () => {
  let books = sample()
  const statementLine = { id: "f:12", date: "2025-04-02", amount: 10500, description: "INWARD TT PALM GROVE TRADING L L C" }
  const found = matchCandidates(books, statementLine)
  assert.equal(found[0].id, "i1")
  assert.equal(found[0].reason, "both")
  books = run(books, { action: "payment", payment: { id: "p1", kind: "invoice", docId: "i1", date: statementLine.date, amount: 10500, method: "bankLine", bankLine: statementLine, note: "" } })
  assert.equal(invoiceStatus(books, books.invoices[0]).status, "paid")
  assert.equal(linkedLine(books, { ...statementLine, id: "other-upload:7" }).category, "receivable")
  // The bank side comes from the statement, so the books post nothing for it.
  assert.equal(get(bookRows(books, FY(2025), true), "Accounts Receivable"), 14500)
  books = run(books, { action: "payment", payment: { id: "p2", kind: "invoice", docId: "i2", date: "2025-12-01", amount: 1000, method: "cash", bankLine: null, note: "" } })
  const rows = bookRows(books, FY(2025), true)
  assert.equal(get(rows, "Cash in Hand"), 1000)
  assert.equal(get(rows, "Accounts Receivable"), 13500)
  assert.equal(invoiceStatus(books, books.invoices[1]).status, "partial")
  assert.throws(() => run(books, { action: "payment", payment: { id: "p3", kind: "invoice", docId: "i2", date: "2025-12-02", amount: 1, method: "bankLine", bankLine: statementLine, note: "" } }), /already linked/)
})

test("credit notes reverse sales, VAT and the receivable, never above the invoice", () => {
  let books = sample()
  books = run(books, { action: "creditNote", creditNote: { id: "cn1", number: "CN-1001", date: "2025-03-15", invoiceId: "i1", lines: [line(2000)], reason: "Discount" } })
  const rows = bookRows(books, FY(2025), true)
  assert.equal(get(rows, "Revenue"), -12000)
  assert.equal(get(rows, "VAT Control"), -400)
  assert.equal(invoiceStatus(books, books.invoices[0]).due, 8400)
  assert.throws(() => run(books, { action: "creditNote", creditNote: { id: "cn2", number: "CN-1002", date: "2025-03-16", invoiceId: "i1", lines: [line(9000)], reason: "" } }), /exceed/)
})

test("bills post the expense, input VAT and payables; cash bills are paid at once", () => {
  let books = sample()
  const bill = { id: "b1", number: "DL-77", date: "2025-05-05", dueDate: "", vendorId: "v1", ledgerName: "Office Expense", scheduleKey: "office", net: 800, vat: 40, vatTreatment: "standard", payment: "cash", description: "Lamps", attachment: null, treatment: "expense", months: null, createdAt: "" }
  books = run(books, { action: "bill", bill })
  const rows = bookRows(books, FY(2025), true)
  assert.equal(get(rows, "Office Expense"), 800)
  assert.equal(get(rows, "Cash in Hand"), -840)
  assert.equal(get(rows, "Accounts Payable"), 0)
  assert.equal(billStatus(books, books.bills[0]).status, "paid")
  assert.equal(sum(rows), 0)
})

test("a prepaid bill is spread monthly and the balance is carried in closing years", () => {
  const bill = { id: "b2", number: "LIC-1", date: "2025-07-01", dueDate: "", vendorId: "v1", ledgerName: "Trade License Expense", scheduleKey: "otherExpenses", net: 12000, vat: 0, vatTreatment: "outOfScope", payment: "bank", description: "Trade licence", attachment: null, treatment: "prepaid", months: 12, createdAt: "" }
  const books = run(sample(), { action: "bill", bill })
  assert.equal(books.schedules.length, 1)
  const y1 = bookRows(books, FY(2025), true)
  assert.equal(get(y1, "Trade License Expense"), 6000)
  assert.equal(get(y1, "Prepaid Expense"), 6000)
  assert.equal(get(y1, "Accounts Payable"), -12000)
  const closing26 = bookRows(books, FY(2026), false)
  assert.equal(get(closing26, "Prepaid Expense"), 0)
  assert.equal(get(closing26, "Trade License Expense"), 6000)
  // 2025's licence cost and sales are in retained earnings.
  assert.equal(get(closing26, "Retained Earnings"), -(14000 - 6000))
  assert.equal(sum(closing26), 0)
  assert.equal(instalments(100, "2025-01-15", 3).map((p) => p.amount).join(), "33.33,33.33,33.34")
})

test("depreciation and accruals, with the accrual reversed the next month", () => {
  let books = sample()
  books = run(
    books,
    { action: "schedule", schedule: { id: "s1", kind: "depreciation", label: "Laptops", ledgerName: "Depreciation Expense", scheduleKey: "depreciation", amount: 3600, start: "2025-10-01", months: 36, source: { type: "manual" } } },
    { action: "accrual", accrual: { id: "a1", label: "December salaries", ledgerName: "Payroll Expense", scheduleKey: "payroll", amount: 5000, date: "2025-12-31", reverse: true } },
  )
  const y = bookRows(books, FY(2025), true)
  assert.equal(get(y, "Depreciation Expense"), 300)
  assert.equal(get(y, "Allowance for Depreciation"), -300)
  assert.equal(get(y, "Accrued Expenses"), -5000)
  const next = bookRows(books, FY(2026), true)
  // The reversal clears the liability carried from 2025 and offsets January's actual salaries.
  assert.equal(get(next, "Accrued Expenses"), 5000)
  assert.equal(get(next, "Payroll Expense"), -5000)
  assert.equal(get(bookRows(books, FY(2026), false), "Accrued Expenses"), 0)
})

test("a statement line spread over months is carried into later closing balance years", () => {
  const line = { id: "f:3", date: "2026-02-20", amount: -24000, description: "EJARI OFFICE RENT" }
  const books = run(emptyBooks(), { action: "schedule", schedule: { id: "s9", kind: "prepaid", label: "Rent", ledgerName: "Rent Expense", scheduleKey: "rent", amount: 24000, start: line.date, months: 12, source: { type: "bankLine", line } } })
  assert.equal(linkedLine(books, line).category, "prepaid")
  // The year of payment: the statement posts the prepayment, the books release 11 months.
  const y = bookRows(books, FY(2026), false)
  assert.equal(get(y, "Prepaid Expense"), -22000)
  assert.equal(get(y, "Rent Expense"), 22000)
  const next = bookRows(books, FY(2027), false)
  assert.equal(get(next, "Prepaid Expense"), 0)
  assert.equal(get(next, "Rent Expense"), 2000)
  assert.equal(get(next, "Retained Earnings"), -2000)
  assert.deepEqual(bookYears(books, FY), [2026, 2027])
})

test("books years merge into the trial balance and movement years carry them forward", () => {
  const books = sample()
  assert.deepEqual(bookYears(books, FY), [2025])
  const record = (year, mode, rows) => ({ clientId: "00000000-0000-0000-0000-000000000001", clientName: "X", year, currency: "AED", openingEquity: null, rows, entryMode: mode, id: `x-${year}`, revision: 1, updatedAt: "" })
  const typed = [
    { id: "r1", ledgerName: "Bank", amount: 5000, scheduleKey: "bank" },
    { id: "r2", ledgerName: "Share Capital", amount: -5000, scheduleKey: "capital" },
  ]
  const r2025 = record(2025, "closing", [...typed, ...bookRows(books, FY(2025), false)])
  const r2026 = record(2026, "movement", [{ id: "r3", ledgerName: "Rent Expense", amount: 100, scheduleKey: "rent" }, { id: "r4", ledgerName: "Bank", amount: -100, scheduleKey: "bank" }, ...bookRows(books, FY(2026), true)])
  const [a, b] = resolveRecords([r2025, r2026])
  assert.equal(Math.abs(a.statements.balanceDifference) < 0.01, true)
  assert.equal(get(b.closingRows, "Accounts Receivable"), 14500)
  assert.equal(Math.abs(b.statements.balanceDifference) < 0.01, true)
})

test("bills are read from their text", () => {
  const text = `DESERT LIGHTS ELECTRICAL TRADING LLC
TRN: 100123456700003
TAX INVOICE
Invoice No: DL-2291
Date: 14/08/2025
Bill To: Example Co LLC TRN 100999999900003
LED panel lights 4 x 200.00 800.00
Sub Total 800.00
VAT 5% 40.00
Grand Total AED 840.00
Paid by VISA ****1234`
  const f = readBill(text, { ownTrn: "100999999900003", ownName: "Example Co LLC" })
  assert.equal(f.supplier, "DESERT LIGHTS ELECTRICAL TRADING LLC")
  assert.equal(f.vendorTrn, "100123456700003")
  assert.equal(f.number, "DL-2291")
  assert.equal(f.date, "2025-08-14")
  assert.deepEqual([f.net, f.vat, f.total], [800, 40, 840])
  assert.equal(f.payment, "card")
})

test("an invoice in another currency is booked in the base currency, with the exchange difference on payment", () => {
  let books = run(emptyBooks(), { action: "party", kind: "client", party: client })
  books = run(books, { action: "invoice", invoice: { id: "u1", number: "INV-2001", date: "2025-03-01", dueDate: "", clientId: "c1", lines: [line(1000)], notes: "", currency: "EUR", rate: 4.0, aedRate: 4.0 } })
  const y = bookRows(books, FY(2025), true)
  assert.equal(get(y, "Revenue"), -4000)
  assert.equal(get(y, "VAT Control"), -200)
  assert.equal(get(y, "Accounts Receivable"), 4200)
  // Paid EUR 1,050 later, received as AED 4,305 on the statement (rate 4.1).
  const statementLine = { id: "s:1", date: "2025-04-01", amount: 1050, description: "PALM GROVE TRADING EUR" }
  const found = matchCandidates(books, { ...statementLine, amount: 4305, original: { amount: 1050, currency: "EUR" }, base: "AED" })
  assert.equal(found[0]?.reason, "both")
  books = run(books, { action: "payment", payment: { id: "p9", kind: "invoice", docId: "u1", date: "2025-04-01", amount: 1050, baseAmount: 4305, method: "bankLine", bankLine: statementLine, note: "" } })
  assert.equal(invoiceStatus(books, books.invoices[0]).status, "paid")
  const z = bookRows(books, FY(2025), true)
  // The statement credits the receivable 4,305; the books add back 105 and book it as an exchange gain.
  assert.equal(get(z, "Accounts Receivable"), 4305)
  assert.equal(get(z, "Exchange Gain / (Loss)"), -105)
  assert.equal(sum(z), 0)
})

test("a client already on the list is found from a bank line or a typed name", async () => {
  const { findParty } = await jiti.import("../lib/books-engine.ts")
  const clients = [{ id: "a", name: "Harbour View Trading LLC" }, { id: "b", name: "Atlas Imports Ltd" }]
  assert.equal(findParty(clients, "INWARD TT FROM HARBOUR VIEW TRADING L L C REF 778")?.id, "a")
  assert.equal(findParty(clients, "harbour view trading llc")?.id, "a")
  assert.equal(findParty(clients, "ATLAS IMPORTS")?.id, "b")
  assert.equal(findParty(clients, "Blue Sea LLC"), undefined)
})
