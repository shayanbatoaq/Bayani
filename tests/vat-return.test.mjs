import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

// Invented clients, suppliers and figures.
const jiti = createJiti(import.meta.url)
const { applyBooksAction, emptyBooks } = await jiti.import("../lib/books.ts")
const { vatItems, periodOf, filingFrom } = await jiti.import("../lib/vat-return.ts")
const { translateRecords } = await jiti.import("../lib/translate.ts")
const { resolveRecords } = await jiti.import("../lib/movement.ts")
const { lawVat, chargesWithVatLine, splitVat } = await jiti.import("../lib/vat-rules.ts")
const { readBill } = await jiti.import("../lib/bill-rules.ts")
const { currencyIn, crossRate } = await jiti.import("../lib/fx.ts")

const run = (books, ...actions) => actions.reduce((b, a) => applyBooksAction(b, a), books)
const Q1 = { id: "2025-01-01_2025-03-31", start: "2025-01-01", end: "2025-03-31", dueDate: "2025-04-28", label: "Q1", registered: true }
const Q2 = { id: "2025-04-01_2025-06-30", start: "2025-04-01", end: "2025-06-30", dueDate: "2025-07-28", label: "Q2", registered: true }
const line = (rate, vat = "standard") => ({ id: `l${rate}${vat}`, item: "", description: "Work", quantity: 1, rate, vat })

function sample() {
  return run(
    emptyBooks(),
    { action: "party", kind: "client", party: { id: "c", name: "Northwind Retail LLC", trn: "", address: "", email: "", phone: "" } },
    { action: "party", kind: "vendor", party: { id: "v", name: "Overseas Software Inc", trn: "", address: "", email: "", phone: "" } },
    { action: "invoice", invoice: { id: "i1", number: "INV-1", date: "2025-02-10", dueDate: "", clientId: "c", lines: [line(1000), line(500, "zero")], notes: "" } },
    { action: "invoice", invoice: { id: "i2", number: "INV-2", date: "2025-03-20", dueDate: "", clientId: "c", lines: [line(2000)], notes: "", currency: "USD", rate: 3.6725, aedRate: 3.6725 } },
    { action: "creditNote", creditNote: { id: "n1", number: "CN-1", date: "2025-03-25", invoiceId: "i1", lines: [line(100)], reason: "" } },
    { action: "bill", bill: { id: "b1", number: "SW-9", date: "2025-02-15", dueDate: "", vendorId: "v", ledgerName: "Fee & Subscription", scheduleKey: "subscriptions", net: 400, vat: 20, vatTreatment: "reverseCharge", payment: "card", description: "", attachment: null, treatment: "expense", months: null, createdAt: "" } },
  )
}

test("the VAT return is prepared from invoices, credit notes, bills and bank lines", () => {
  const bank = [{ id: "f:1", date: "2025-03-02", description: "RECEIPT CASH SALE", kind: "output", net: 200, vat: 10, netAed: 200, vatAed: 10 }]
  const items = vatItems(sample(), bank, "AED", "Dubai")
  const q1 = items.filter((i) => periodOf(i, {}, [Q1, Q2]) === Q1.id)
  const filing = filingFrom(q1, Q1)
  // Dubai standard-rated: 1,000 + USD 2,000 at 3.6725 - 100 credit + 200 bank = 8,445
  assert.equal(filing.boxes["1b"].amount, 8445)
  assert.equal(filing.boxes["1b"].vat, 422.25)
  assert.equal(filing.boxes["4"].amount, 500)
  assert.equal(filing.boxes["3"].vat, 20)
  assert.equal(filing.boxes["10"].vat, 20)
})

test("an item left out of a return waits until it is added to a later one", () => {
  let books = sample()
  books = run(books, { action: "vatAssign", keys: ["inv:i2"], period: "none" })
  let items = vatItems(books, [], "AED", "Dubai")
  assert.equal(items.filter((i) => periodOf(i, books.vatAssignments, [Q1, Q2]) === "none").length, 1)
  books = run(books, { action: "vatAssign", keys: ["inv:i2"], period: Q2.id })
  items = vatItems(books, [], "AED", "Dubai")
  const q2 = items.filter((i) => periodOf(i, books.vatAssignments, [Q1, Q2]) === Q2.id)
  assert.equal(q2[0].key, "inv:i2")
})

test("bank lines: the law settles salaries and transfers; a VAT line makes its charge VAT-free", () => {
  assert.equal(lawVat("payroll", "payroll"), "none")
  assert.equal(lawVat("transfer", "bank"), "none")
  assert.equal(lawVat("professional", "legal"), null)
  assert.equal(lawVat("head:Share Capital", "capital"), "none")
  const lines = [
    { id: "a", date: "2025-01-05", amount: -200, accountKey: "k" },
    { id: "b", date: "2025-01-05", amount: -10, accountKey: "k" },
    { id: "c", date: "2025-01-05", amount: -210, accountKey: "k" },
  ]
  assert.deepEqual([...chargesWithVatLine(lines, (t) => t.id === "b")], ["a"])
  assert.deepEqual(splitVat(-210), { net: -200, vat: -10 })
})

test("statements in another currency: balance sheet at closing, profit at average, difference in equity", () => {
  const rows = [
    { id: "1", ledgerName: "Bank", amount: 1000, scheduleKey: "bank" },
    { id: "2", ledgerName: "Share Capital", amount: -300, scheduleKey: "capital" },
    { id: "3", ledgerName: "Revenue", amount: -900, scheduleKey: "sales" },
    { id: "4", ledgerName: "Rent Expense", amount: 200, scheduleKey: "rent" },
  ]
  const [rec] = resolveRecords([{ clientId: "00000000-0000-0000-0000-000000000001", clientName: "X", year: 2025, currency: "AED", openingEquity: null, rows, entryMode: "closing", id: "x", revision: 1, updatedAt: "" }])
  const [usd] = translateRecords([rec], "USD", [{ year: 2025, closing: 0.27, average: 0.28, opening: 0.26, closingDate: "2025-12-31", source: "peg" }])
  assert.equal(usd.currency, "USD")
  assert.ok(Math.abs(usd.statements.balanceDifference) < 0.01)
  assert.ok(usd.rows.some((r) => r.ledgerName === "Foreign currency translation difference"))
})

test("currencies on documents and cross rates", () => {
  assert.equal(currencyIn("Total USD 1,200.00"), "USD")
  assert.equal(currencyIn("Grand Total € 300,00"), "EUR")
  assert.equal(currencyIn("Total AED 105.00"), "AED")
  assert.equal(currencyIn("Total 105.00"), null)
  assert.equal(readBill("Cloudhost Inc.\nInvoice # 1\nTotal USD 1,200.00").currency, "USD")
  assert.equal(crossRate("USD", "AED", { USD: 3.6725 }), 3.6725)
  assert.equal(crossRate("AED", "USD", { USD: 3.6725 }), 0.272294)
})
