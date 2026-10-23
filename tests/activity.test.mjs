import { test } from "node:test"
import assert from "node:assert/strict"
import { createJiti } from "jiti"
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname } })
const { describeBooks, describeRecord, describeBankSession, describeExtras, describeCompany } = await jiti.import("../lib/activity.ts")
const { emptyBooks, applyBooksAction } = await jiti.import("../lib/books.ts")

const company = { id: "11111111-1111-1111-1111-111111111111", name: "Test Trading LLC", baseCurrency: "AED" }

test("trial balance changes list each head with before and after", () => {
  const before = { clientId: company.id, clientName: company.name, year: 2025, currency: "AED", entryMode: "closing", openingEquity: null, rows: [
    { id: "a", ledgerName: "Rent", amount: 1000, scheduleKey: "rent" },
    { id: "b", ledgerName: "Bank", amount: -1000, scheduleKey: "cash" },
    { id: "books-1", ledgerName: "Sales", amount: -5, scheduleKey: "revenue" },
  ] }
  const after = { ...before, rows: [
    { id: "a", ledgerName: "Rent", amount: 1200, scheduleKey: "rent" },
    { id: "b", ledgerName: "Bank", amount: -1200, scheduleKey: "cash" },
    { id: "c", ledgerName: "Utilities", amount: 50, scheduleKey: "utilities" },
  ] }
  const d = describeRecord(before, after)
  assert.equal(d.area, "figures")
  assert.match(d.summary, /2025 changed: 3 items/)
  assert.deepEqual(d.changes.find((c) => c.label === "Rent"), { label: "Rent", before: "AED 1,000.00", after: "AED 1,200.00" })
  assert.ok(d.changes.some((c) => c.label === "Utilities" && !c.before))
  assert.ok(!d.changes.some((c) => c.label === "Sales"), "book entries are not the user's own figures")
  assert.match(describeRecord(null, after).summary, /saved \(3 heads\)/)
  assert.equal(describeRecord({ ...after }, after), null)
})

test("books actions read as plain sentences", () => {
  let books = emptyBooks()
  const client = { id: "c1", name: "Harbour View LLC", trn: "", address: "", email: "", phone: "" }
  const act = (action) => {
    const next = applyBooksAction(books, action)
    const d = describeBooks(company, books, next, action)
    books = next
    return d
  }
  assert.match(act({ action: "party", kind: "client", party: client }).summary, /Client Harbour View LLC added/)
  const invoice = { id: "i1", number: "INV-1001", date: "2025-03-01", dueDate: "", clientId: "c1", lines: [{ id: "l1", item: "", description: "Advice", quantity: 1, rate: 1000, vat: "standard" }], notes: "", createdAt: "", rate: 1 }
  const created = act({ action: "invoice", invoice })
  assert.equal(created.summary, "Invoice INV-1001 created: Harbour View LLC, AED 1,050.00, dated 2025-03-01")
  assert.equal(created.year, 2025)
  const edited = act({ action: "invoice", invoice: { ...invoice, lines: [{ ...invoice.lines[0], rate: 2000 }] } })
  assert.deepEqual(edited.changes[0], { label: "Total", before: "AED 1,050.00", after: "AED 2,100.00" })
  assert.match(act({ action: "deleteInvoice", id: "i1" }).summary, /Invoice INV-1001 deleted \(Harbour View LLC, AED 2,100.00\)/)
  assert.match(act({ action: "vatAssign", keys: ["inv:i1"], period: "none" }).summary, /1 item moved to no VAT return/)
})

test("statement saves are logged only when files are added or removed", () => {
  const file = (id, n) => ({ id, name: `${id}.csv`, accounts: [{ transactions: Array(n).fill({}) }] })
  assert.equal(describeBankSession(company, 2025, { files: [file("a", 2)], appliedAt: null }, { files: [file("a", 2)], appliedAt: null }), null)
  const d = describeBankSession(company, 2025, { files: [file("a", 2)], appliedAt: null }, { files: [file("a", 2), file("b", 5)], appliedAt: null })
  assert.equal(d.summary, "Bank statements for 2025: 1 file uploaded")
  assert.deepEqual(d.changes, [{ label: "b.csv", after: "uploaded, 5 lines" }])
})

test("company edits and remembered bank rules", () => {
  const base = { ...company, legalForm: "LLC", authority: "DET", emirate: "Dubai", licenseNumber: "1", businessActivity: "Trading", manager: "M", partners: [], vat: { trn: "", effectiveDate: "", frequency: "quarterly" }, ct: { trn: "", yearEndMonth: 12 }, documents: [], bankRules: [] }
  const d = describeCompany(base, { ...base, vat: { ...base.vat, trn: "100000000000003" } })
  assert.deepEqual(d.changes, [{ label: "VAT TRN", before: "(blank)", after: "100000000000003" }])
  const r = describeExtras(base, { bankRules: [{ pattern: "SMART DUBAI", category: "tradeLicense" }] })
  assert.match(r.summary, /Bank mapping remembered: 1 rule/)
  assert.equal(describeExtras({ ...base, bankRules: [{ pattern: "SMART DUBAI", category: "tradeLicense" }] }, { bankRules: [{ pattern: "SMART DUBAI", category: "tradeLicense" }] }), null)
})
