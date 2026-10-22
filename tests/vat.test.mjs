import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)
const { resolveSchedule } = await jiti.import("../lib/ledger-heads.ts")
const { emptyCompanyDraft } = await jiti.import("../lib/company.ts")
const { resolveRecords } = await jiti.import("../lib/movement.ts")
const { vatReturns, classify, registrationCheck, readVatAnswers, staggerLabel, vatLines } = await jiti.import("../lib/vat-return.ts")

const company = {
  ...emptyCompanyDraft(),
  id: "00000000-0000-4000-8000-000000000003",
  name: "Sample Services",
  legalForm: "Sole Establishment",
  authority: "Department of Economy and Tourism",
  emirate: "Dubai",
  businessActivity: "Management consultancy services",
  vat: { trn: "100000000000003", effectiveDate: "2025-03-01", frequency: "quarterly", cycleStartMonth: 3 },
  ct: { trn: "", firstPeriodStart: "", yearEndMonth: 12 },
  customHeads: [], vatOverrides: {}, ctAnswers: {}, vatAnswers: {}, documents: [], revision: 1, createdAt: "", updatedAt: "",
}
const year = (y, entries) => {
  const pl = entries.reduce((t, [, a]) => t + a, 0)
  const rows = [...entries, ["Share Capital", -10000], ["Bank", 10000 - pl]]
  return {
    clientId: company.id, clientName: company.name, year: y, currency: "AED", openingEquity: null, entryMode: "closing",
    id: `r-${y}`, revision: 1, updatedAt: "",
    rows: rows.map(([ledgerName, amount], i) => ({ id: `${y}-${i}`, ledgerName, amount, scheduleKey: resolveSchedule(ledgerName, amount) })),
  }
}
const recs = resolveRecords([
  year(2026, [["Revenue", -800000], ["Rent Expense", 60000], ["Office Expense", 12000], ["Payroll Expense", 300000], ["Meal & Entertainment", 8000]]),
])

test("filed VAT 201: actual totals reproduce boxes 1b, 9 and 14", () => {
  const id = "2026-06-01_2026-08-31"
  const answers = readVatAnswers({ profile: { heads: { "meal & entertainment": { splits: [{ rule: "IN-01", percent: 100 }] } } }, periods: { [id]: { actualSales: 196302.8, actualExpenses: 18144.8 } } })
  const ret = vatReturns(company, recs, answers).find((r) => r.period.id === id)
  assert.equal(ret.stagger, "Stagger 2 – Quarterly (Mar to Feb)")
  assert.equal(ret.period.dueDate, "2026-09-28")
  assert.equal(ret.taxYearEnd, "2027-02-28")
  const box = (n) => ret.boxes.find((b) => b.box === n)
  assert.equal(box("1b").amount, 196302.8)
  assert.equal(box("1b").vat, 9815.14)
  assert.equal(box("9").amount, 18144.8)
  assert.equal(box("9").vat, 907.24)
  assert.equal(box("14").vat, 8907.9)
})

test("defaults follow the rulebook", () => {
  const line = (name, scheduleKey, side = "expense") => ({ id: name.toLowerCase(), name, side, scheduleKey, annual: 1000 })
  const rule = (l, act = "Trading", loc = "mainland") => classify(l, act, loc).splits[0].rule
  assert.equal(rule(line("Payroll Expense", "payroll")), "OOS-01")
  assert.equal(rule(line("Meal & Entertainment", "entertainment")), "IN-05")
  assert.equal(rule(line("Visa Fees", "otherExpenses")), "OOS-07")
  assert.equal(rule(line("Staff Accommodation", "rent")), "EX-EXP")
  assert.equal(rule(line("Rent Expense", "rent")), "IN-01")
  assert.equal(rule(line("Interest Expense", "finance")), "EX-EXP")
  assert.equal(rule(line("Bank Charges", "finance")), "IN-01")
  assert.equal(rule(line("Google Ads", "marketing")), "RC-01")
  assert.equal(rule(line("Revenue", "sales", "revenue"), "Nursery school"), "ZR-10")
  assert.equal(rule(line("Revenue", "sales", "revenue"), "Leasing of residential buildings"), "EX-05")
  assert.equal(rule(line("Interest income", "otherIncome", "revenue")), "EX-01")
  assert.equal(classify(line("Revenue", "sales", "revenue"), "IT consultancy", "free_zone").flag?.startsWith("J-03"), true)
})

test("estimate: blocked entertainment, payroll out of scope, mixed supplies apportioned", () => {
  const rets = vatReturns(company, recs, readVatAnswers({}))
  const q = rets.find((r) => r.period.id === "2026-06-01_2026-08-31")
  const days = 92 / 365
  const box = (n) => q.boxes.find((b) => b.box === n)
  assert.ok(Math.abs(box("1b").vat - 800000 * days * 0.05) < 0.02)
  // Rent + office recoverable; entertainment blocked; payroll not a purchase.
  assert.ok(Math.abs(box("9").vat - 72000 * days * 0.05) < 0.02)
  // Exempt income triggers apportionment.
  const mixed = resolveRecords([year(2026, [["Revenue", -800000], ["Interest income", -200000], ["Rent Expense", 60000]])])
  const m = vatReturns(company, mixed, readVatAnswers({})).find((r) => r.period.id === "2026-06-01_2026-08-31")
  assert.equal(m.recoveryRate, 0.8)
  assert.ok(Math.abs(m.boxes.find((b) => b.box === "9").vat - 60000 * days * 0.05 * 0.8) < 0.02)
  assert.ok(Math.abs(m.boxes.find((b) => b.box === "5").amount - 200000 * days) < 0.02)
})

test("reverse charge imports go to boxes 6 and 10 and net to nil", () => {
  const r = resolveRecords([year(2026, [["Revenue", -500000], ["Cost of Goods Sold", 300000]])])
  const answers = readVatAnswers({ profile: { heads: { "cost of goods sold": { splits: [{ rule: "RC-02", percent: 100 }] } } } })
  const q = vatReturns(company, r, answers).find((x) => x.period.id === "2026-06-01_2026-08-31")
  const b6 = q.boxes.find((b) => b.box === "6"), b10 = q.boxes.find((b) => b.box === "10")
  assert.ok(b6.vat > 0)
  assert.equal(b6.vat, b10.vat)
})

test("registration test and stagger labels", () => {
  assert.equal(registrationCheck(company, recs, readVatAnswers({})).rule, "REG-01")
  const small = resolveRecords([year(2026, [["Revenue", -200000]])])
  assert.equal(registrationCheck({ ...company, vat: { ...company.vat, trn: "" } }, small, readVatAnswers({})).rule, "REG-02")
  assert.equal(staggerLabel({ ...company, vat: { ...company.vat, cycleStartMonth: 1 } }).label, "Stagger 3 – Quarterly (Jan to Dec)")
  assert.equal(staggerLabel({ ...company, vat: { ...company.vat, cycleStartMonth: 2 } }).label, "Stagger 1 – Quarterly (Feb to Jan)")
  assert.equal(vatLines(recs[0], null).some((l) => l.name === "Revenue"), true)
  assert.deepEqual(readVatAnswers({ profile: { taxGroup: true, bogus: 1 }, periods: { bad: {} } }), { profile: { taxGroup: true }, periods: {} })
})
