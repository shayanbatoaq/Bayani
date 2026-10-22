import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)
const { resolveSchedule } = await jiti.import("../lib/ledger-heads.ts")
const { emptyCompanyDraft } = await jiti.import("../lib/company.ts")
const { resolveRecords } = await jiti.import("../lib/movement.ts")
const { ctReturns, buildCtReturn, isFreeZone, readAnswerStore } = await jiti.import("../lib/ct-return.ts")

const base = {
  ...emptyCompanyDraft(),
  id: "00000000-0000-4000-8000-000000000002",
  name: "Sample Consulting LLC",
  legalForm: "Limited Liability Company",
  authority: "Department of Economy and Tourism",
  emirate: "Dubai",
  businessActivity: "Management consultancy activities",
  partners: [{ name: "Owner One", nationality: "India", sharePercent: 100, shareValue: 100000 }],
  ct: { trn: "104000000000001", firstPeriodStart: "2024-01-01", yearEndMonth: 12 },
  customHeads: [], vatOverrides: {}, ctAnswers: {}, documents: [], revision: 1, createdAt: "", updatedAt: "",
}
// A closing trial balance that balances through Bank.
const year = (y, entries) => {
  const pl = entries.reduce((t, [, a]) => t + a, 0)
  const rows = [...entries, ["Share Capital", -100000], ["Bank", 100000 - pl]]
  return {
    clientId: base.id, clientName: base.name, year: y, currency: "AED", openingEquity: null, entryMode: "closing",
    id: `r-${y}`, revision: 1, updatedAt: "",
    rows: rows.map(([ledgerName, amount], i) => ({ id: `${y}-${i}`, ledgerName, amount, scheduleKey: resolveSchedule(ledgerName, amount) })),
  }
}
const records = (...list) => resolveRecords(list)

test("filed example: taxable income 2,283,616 gives AED 171,775", () => {
  const fz = { ...base, authority: "Ras Al Khaimah Economic Zone (RAKEZ)", legalForm: "FZ-LLC" }
  const recs = records(
    year(2024, [["Revenue", -3212638], ["Cost of Goods Sold", 245248], ["Payroll Expense", 623800], ["General Expense", 81400 + 0]]),
    year(2025, [["Revenue", -3665303], ["Cost of Goods Sold", 274010], ["Payroll Expense", 508240], ["General Expense", 108457 + 490980]])
  )
  const ret = buildCtReturn(fz, recs, 2025, { electStandardRegime: true })
  assert.equal(ret.freeZone, true)
  assert.equal(ret.regime, "Standard (9%)")
  // Net profit = 3,665,303 - 274,010 - 508,240 - 599,437
  assert.equal(ret.accountingIncome, 2283616)
  assert.equal(ret.summary.find((l) => l.no === 19).amount, 2283616)
  assert.equal(ret.liability, 171775)
  assert.equal(ret.payable, 171775)
  assert.equal(ret.sbr.eligible, false)
  assert.equal(ret.dueDate, "2026-09-30")
})

test("Small Business Relief: nil return, all return figures zero", () => {
  const recs = records(year(2025, [["Revenue", -677507], ["Rent Expense", 100000]]))
  const ret = buildCtReturn(base, recs, 2025, {})
  assert.equal(ret.regime, "Small Business Relief")
  assert.ok(ret.summary.every((line) => line.amount === 0))
  assert.equal(ret.payable, 0)
  assert.equal(ret.ordinary.liability, Math.round((577507 - 375000) * 0.09))
  // Declining the election gives the standard tax.
  assert.equal(buildCtReturn(base, recs, 2025, { sbrElection: "no" }).liability, Math.round((577507 - 375000) * 0.09))
})

test("prior revenue above AED 3m blocks SBR (manual example B)", () => {
  const recs = records(
    year(2024, [["Revenue", -3600000], ["Rent Expense", 3000000]]),
    year(2025, [["Revenue", -2500000], ["Rent Expense", 1900000]])
  )
  const ret = ctReturns(base, recs).find((r) => r.year === 2025)
  assert.equal(ret.sbr.eligible, false)
  assert.equal(ret.liability, 20250)
})

test("ordinary adjustments and losses (manual example A)", () => {
  const recs = records(
    year(2025, [
      ["Revenue", -5000000], ["Other Income", -100000], ["Meal & Entertainment", 40000],
      ["General Expense", 3860000],
    ])
  )
  // PBT 1,200,000; entertainment 50% add-back 20,000; fines 10,000 and private 30,000 inside General Expense; dividend 100,000 in Other Income.
  const ret = buildCtReturn(base, recs, 2025, { fines: 10000, notWhollyBusiness: 30000, uaeDividends: 100000, openingTaxLosses: 200000 })
  assert.equal(ret.accountingIncome, 1200000)
  assert.equal(ret.taxableBeforeLosses, 1160000)
  assert.equal(ret.lossesUsed, 200000)
  assert.equal(ret.liability, 52650)
  assert.equal(ret.warnings.filter((w) => /does not agree/.test(w)).length, 0)
})

test("losses are capped at 75% and carried forward (manual example E)", () => {
  const recs = records(
    year(2024, [["Revenue", -4000000], ["Rent Expense", 7000000]]),
    year(2025, [["Revenue", -5000000], ["Rent Expense", 3000000]])
  )
  const [r24, r25] = ctReturns(base, recs)
  assert.equal(r24.liability, 0)
  assert.equal(r24.lossesCarriedForward, 3000000)
  assert.equal(r25.lossesUsed, 1500000)
  assert.equal(r25.taxableIncome, 500000)
  assert.equal(r25.liability, 11250)
  assert.equal(r25.lossesCarriedForward, 1500000)
})

test("taxable income exactly AED 375,000 gives nil tax", () => {
  const recs = records(year(2025, [["Revenue", -3500000], ["Rent Expense", 3125000]]))
  assert.equal(buildCtReturn(base, recs, 2025, {}).liability, 0)
})

test("free zone: unconfirmed QFZP status stays provisional at 9%; de minimis decides QFZP", () => {
  const fz = { ...base, authority: "Dubai Multi Commodities Centre Authority (DMCC)" }
  assert.equal(isFreeZone(fz), true)
  assert.equal(isFreeZone(base), false)
  const recs = records(year(2025, [["Revenue", -4000000], ["Rent Expense", 2000000]]))
  const unconfirmed = buildCtReturn(fz, recs, 2025, {})
  assert.equal(unconfirmed.regime, "Standard (9%)")
  assert.equal(unconfirmed.status, "Provisional liability")
  const within = buildCtReturn(fz, recs, 2025, { qfzpConfirmed: true, audited: true, qualifyingRevenue: 3900000, nonQualifyingRevenue: 100000 })
  assert.equal(within.regime, "Qualifying Free Zone Person")
  assert.equal(within.liability, 0)
  const excluded = buildCtReturn(fz, recs, 2025, { qfzpConfirmed: true, audited: true, qualifyingRevenue: 3900000, nonQualifyingRevenue: 100000, excludedTaxableIncome: 100000 })
  assert.equal(excluded.liability, 9000) // 9% with no AED 375,000 band
  const breach = buildCtReturn(fz, recs, 2025, { qfzpConfirmed: true, audited: true, qualifyingRevenue: 3000000, nonQualifyingRevenue: 1000000 })
  assert.equal(breach.regime, "Standard (9%)")
  assert.equal(breach.liability, Math.round((2000000 - 375000) * 0.09))
})

test("periods before June 2023 are out of scope; stored answers are read leniently", () => {
  const recs = records(year(2023, [["Revenue", -5000000]]))
  const ret = buildCtReturn({ ...base, ct: { ...base.ct, firstPeriodStart: "" } }, recs, 2023, {})
  assert.equal(ret.inScope, false)
  assert.equal(ret.payable, 0)
  assert.deepEqual(readAnswerStore({ 2025: { fines: 5, bogus: 1, audited: "x" } }), { 2025: { fines: 5 } })
})

test("saving answers keeps only what was answered", async () => {
  const { ctAnswerStoreSchema } = await jiti.import("../lib/ct-return.ts")
  assert.deepEqual(ctAnswerStoreSchema.parse({ 2025: { audited: true } }), { 2025: { audited: true } })
})
