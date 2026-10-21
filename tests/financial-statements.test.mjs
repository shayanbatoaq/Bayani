import assert from "node:assert/strict"
import { test } from "node:test"
import {
  calculateFinancials,
  suggestSchedule,
} from "../lib/financial-statements.ts"

const rows = (entries) =>
  entries.map(([scheduleKey, amount], i) => ({
    id: String(i),
    ledgerName: scheduleKey || "Unallocated",
    scheduleKey,
    amount,
  }))
const input = (
  entries,
  openingEquity = { capital: 1000, earnings: 0, retained: 0, shareholder: 0 }
) => ({
  clientId: "test",
  clientName: "Test client",
  year: 2025,
  currency: "AED",
  rows: rows(entries),
  openingEquity,
})
const fixture = [
  ["bank", 1800],
  ["office", 200],
  ["sales", -1000],
  ["capital", -1000],
]

test("signed trial balance flows through schedules, income, BS and equity", () => {
  const report = calculateFinancials(input(fixture))
  assert.equal(report.netProfit, 800)
  assert.equal(report.trialBalanceTotal, 0)
  assert.equal(report.balanceDifference, 0)
  assert.equal(report.schedules.find((line) => line.row === 35).amount, 1800)
  assert.equal(report.bs.find((line) => line.row === 25).amount, 1800)
  assert.deepEqual(report.equity.at(-1).values, [1000, 800, 0, 0, 1800])
  assert.deepEqual(report.warnings, [])
})
test("dividends and prior-year earnings reconcile without double counting", () => {
  const report = calculateFinancials(
    input(
      [
        ["bank", 2100],
        ["office", 200],
        ["sales", -600],
        ["capital", -1000],
        ["retained", -800],
        ["dividends", 100],
      ],
      { capital: 1000, earnings: 800, retained: 0, shareholder: 0 }
    )
  )
  assert.equal(report.netProfit, 400)
  assert.equal(report.balanceDifference, 0)
  assert.equal(report.closingEquity.retained, 700)
  for (let i = 0; i < 5; i++)
    assert.equal(
      report.equity
        .slice(0, -1)
        .reduce((total, line) => total + line.values[i], 0),
      report.equity.at(-1).values[i]
    )
})
test("contra assets net down and missing openings are not fabricated", () => {
  const report = calculateFinancials(
    input(
      [
        ["ppe", 1000],
        ["ppe", -100],
        ["capital", -900],
      ],
      null
    )
  )
  assert.equal(report.bs.find((line) => line.row === 11).amount, 900)
  assert.equal(report.balanceDifference, 0)
  assert.deepEqual(report.equity[0].values, Array(5).fill(null))
  assert.equal(report.schedules.find((line) => line.row === 59).amount, null)
  assert.match(report.warnings.join(" "), /Opening equity/)
})
test("unmapped ledgers and imbalances are surfaced, not dropped silently", () => {
  const report = calculateFinancials(
    input([
      ["", 10],
      ["bank", 100],
    ])
  )
  assert.deepEqual(report.unmapped, ["Unallocated"])
  assert.equal(report.trialBalanceTotal, 110)
  assert.equal(report.balanceDifference, 100)
  assert.equal(report.warnings.length, 3)
})
test("decimal amounts sum in cents and years remain independent", () => {
  const first = calculateFinancials(
    input([
      ["bank", 0.1],
      ["bank", 0.2],
      ["capital", -0.3],
    ])
  )
  const second = calculateFinancials(input(fixture))
  assert.equal(first.trialBalanceTotal, 0)
  assert.equal(first.balanceDifference, 0)
  assert.equal(first.closingEquity.capital, 0.3)
  assert.equal(second.closingEquity.capital, 1000)
})
test("schedule suggestions handle liabilities and contra balances", () => {
  assert.equal(suggestSchedule("Salary payable", -500), "accruals")
  assert.equal(suggestSchedule("VAT", -500), "taxPayable")
  assert.equal(suggestSchedule("VAT", 500), "taxReceivable")
  assert.equal(suggestSchedule("Accumulated depreciation", -500), "ppe")
  assert.equal(suggestSchedule("Unknown account", 500), "")
})
