import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)
const { resolveSchedule } = await jiti.import("../lib/ledger-heads.ts")
const { emptyCompanyDraft } = await jiti.import("../lib/company.ts")
const { resolveRecords } = await jiti.import("../lib/movement.ts")
const { valueBusiness, detectIndustry } = await jiti.import("../lib/valuation.ts")
const { allMetrics, healthScore } = await jiti.import("../lib/analytics.ts")

const company = { ...emptyCompanyDraft(), id: "c", name: "Sample IT Solutions LLC", businessActivity: "Software development and IT consultancy" }
const year = (y, entries) => {
  const pl = entries.reduce((t, [, a]) => t + a, 0)
  const rows = [...entries, ["Share Capital", -100000], ["Bank", 100000 - pl]]
  return { clientId: "c", clientName: "x", year: y, currency: "AED", openingEquity: null, entryMode: "closing", id: `r${y}`, revision: 1, updatedAt: "",
    rows: rows.map(([ledgerName, amount], i) => ({ id: `${y}-${i}`, ledgerName, amount, scheduleKey: resolveSchedule(ledgerName, amount) })) }
}
const records = resolveRecords([
  year(2023, [["Revenue", -2000000], ["Payroll Expense", 1400000], ["Rent Expense", 200000], ["Accounts Receivable", 300000]]),
  year(2024, [["Revenue", -2400000], ["Payroll Expense", 1600000], ["Rent Expense", 220000], ["Accounts Receivable", 350000]]),
  year(2025, [["Revenue", -2900000], ["Payroll Expense", 1850000], ["Rent Expense", 240000], ["Accounts Receivable", 400000]]),
])

test("industry is detected from the activity", () => {
  assert.equal(detectIndustry("Software development").key, "software")
  assert.equal(detectIndustry("General Trading").key, "trading")
  assert.equal(detectIndustry("Something unusual").key, "general")
})

test("valuation weighs earnings methods for a profitable business", () => {
  const v = valueBusiness(company, records)
  assert.equal(v.year, 2025)
  assert.deepEqual(v.yearsUsed, [2023, 2024, 2025])
  // EBITDA 400k, 580k, 810k -> weighted (400+1160+2430)/6 = 665k
  assert.equal(v.maintainableEbitda, 665000)
  const ebitda = v.methods.find((m) => m.key === "ebitda")
  assert.equal(ebitda.weight, 0.4)
  assert.ok(v.low <= v.value && v.value <= v.high)
  assert.ok(v.value > 0)
  assert.equal(v.confidence, "High")
  assert.ok(v.summary[0].includes("Sample IT Solutions LLC"))
})

test("loss-making business uses revenue multiple and net assets", () => {
  const loss = resolveRecords([year(2025, [["Revenue", -500000], ["Payroll Expense", 700000]])])
  const v = valueBusiness(company, loss)
  assert.equal(v.methods.find((m) => m.key === "dcf"), undefined)
  assert.equal(v.methods.find((m) => m.key === "revenue").weight, 0.5)
  assert.equal(v.confidence, "Low")
})

test("snap view metrics and health score", () => {
  const m = allMetrics(records)
  assert.equal(m[2].revenue, 2900000)
  assert.ok(Math.abs(m[2].ratios.netMargin - 810000 / 2900000) < 1e-9)
  assert.ok(Math.round(m[2].ratios.receivableDays) === Math.round((400000 / 2900000) * 365))
  const h = healthScore(m[2], m[1])
  assert.ok(h.score > 0 && h.score <= 100)
})
