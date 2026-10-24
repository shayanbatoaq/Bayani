import test from "node:test"
import assert from "node:assert/strict"
import Papa from "papaparse"
import { readSheet } from "read-excel-file/node"
import {
  parseAmount,
  rowsToLedgerEntries,
  suggestMapping,
} from "../lib/trial-balance.ts"

test("amounts preserve signs and reject invalid or empty values", () => {
  for (const [input, expected] of [
    ["0", 0],
    ["1,250.50", 1250.5],
    ["(500.25)", -500.25],
    ["-15.00", -15],
    ["AED 10.25", 10.25],
    ["", null],
    ["abc", null],
    ["1,2,3", null],
    ["123oops", null],
    [Infinity, null],
    ["1,234.00 Dr", 1234],
    ["1,234.00 CR", -1234],
    ["500Cr", -500],
    ["500-", -500],
    ["-500 Cr", null],
    ["(500)-", null],
    ["Dr", null],
    ["-", null],
  ]) {
    assert.equal(parseAmount(input), expected, String(input))
  }
})

test("the supplied template imports all 41 filled ledgers", async () => {
  const template = await readSheet(
    "public/templates/trial-balance-template.xlsx"
  )
  assert.throws(() => rowsToLedgerEntries(template), /No ledger amounts/)
  const filled = template.map((row, index) =>
    index === 0 ? row : [row[0], row[1], index % 2 ? index * 100 : -index * 100]
  )
  const result = rowsToLedgerEntries(filled)
  assert.equal(result.entries.length, 41)
  assert.deepEqual(result.entries.at(-1), {
    ledgerName: "Dividends",
    amount: 4100,
  })
  assert.equal(result.skipped, 0)
})

test("quoted CSV names, embedded newlines and grouped numbers remain intact", () => {
  const csv =
    'Account,Amount\r\n"Bank, operating","1,250.50"\r\n"Sales\nRevenue",-1250.50'
  const result = rowsToLedgerEntries(Papa.parse(csv).data)
  assert.deepEqual(result.entries, [
    { ledgerName: "Bank, operating", amount: 1250.5 },
    { ledgerName: "Sales\nRevenue", amount: -1250.5 },
  ])
})

test("invalid rows are counted, repeated headers and totals are excluded", () => {
  const result = rowsToLedgerEntries([
    ["Company report"],
    ["ID", "Account", "Amount"],
    [1, "Bank", 0],
    [2, "Rent", "bad"],
    [3, "Cash", null],
    [4, "", 42],
    ["ID", "Account", "Amount"],
    [null, "Grand Total", 42],
  ])
  assert.deepEqual(result.entries, [{ ledgerName: "Bank", amount: 0 }])
  assert.equal(result.skipped, 3)
  assert.equal(result.totalsSkipped, 1)
})

test("debit/credit imports convert to amounts without treating invalid values as zero", () => {
  const result = rowsToLedgerEntries([
    ["Account", "Debit", "Credit"],
    ["Bank", "100.00", ""],
    ["Revenue", "", 100],
    ["Bad amount", "oops", 10],
    ["Blank", "", ""],
  ])
  assert.deepEqual(result.entries, [
    { ledgerName: "Bank", amount: 100 },
    { ledgerName: "Revenue", amount: -100 },
  ])
  assert.equal(result.skipped, 2)
})

test("debit/credit imports read dash placeholders as zero and Dr, Cr and trailing minus figures", () => {
  const result = rowsToLedgerEntries([
    ["Account", "Debit", "Credit"],
    ["Bank", "5,000.00", " - "],
    ["Share Capital", "–", "6,000.00"],
    ["Rent", "1,000.00 Dr", "-"],
    ["Revenue", "-", "500.00 Cr"],
    ["Refund", "500-", "-"],
    ["Suspense", "-", "-"],
  ])
  assert.deepEqual(result.entries, [
    { ledgerName: "Bank", amount: 5000 },
    { ledgerName: "Share Capital", amount: -6000 },
    { ledgerName: "Rent", amount: 1000 },
    { ledgerName: "Revenue", amount: -500 },
    { ledgerName: "Refund", amount: -500 },
    { ledgerName: "Suspense", amount: 0 },
  ])
  assert.equal(result.skipped, 0)
  assert.deepEqual(rowsToLedgerEntries([["Account", "Amount"], ["Bank", " - "], ["Loan", "2,000.00 Cr"]]).entries, [
    { ledgerName: "Bank", amount: 0 },
    { ledgerName: "Loan", amount: -2000 },
  ])
})

test("unknown ledger names require mapping; overrides are never implied", () => {
  assert.equal(suggestMapping("Unidentified balance").category, "")
  assert.equal(suggestMapping("Unidentified balance").confidence, "Low")
  assert.equal(suggestMapping("Prepaid Expense").category, "Current Assets")
  assert.equal(
    suggestMapping("Depreciation Expense").category,
    "Operating Expenses"
  )
  assert.equal(
    suggestMapping("Allowance for Depreciation").category,
    "Non-Current Assets"
  )
  assert.equal(
    suggestMapping("Long Term Liabilities").category,
    "Non-Current Liabilities"
  )
})
