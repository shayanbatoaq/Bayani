import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

// jiti resolves the extensionless TypeScript imports used inside lib/.
const jiti = createJiti(import.meta.url)
const { calculateFinancials, calculateCashFlow } = await jiti.import("../lib/financial-statements.ts")
const { resolveSchedule, ledgerHeads } = await jiti.import("../lib/ledger-heads.ts")
const { vatPeriods, financialPeriod, ctDueDate, companyDraftSchema, emptyCompanyDraft } = await jiti.import("../lib/company.ts")
const { vatSchedule, ctSchedule } = await jiti.import("../lib/tax.ts")
const { buildReport } = await jiti.import("../lib/report-model.ts")
const { extractWithRules, normaliseDate } = await jiti.import("../lib/document-rules.ts")

const record = (year, entries, openingEquity = null) => {
  const input = {
    clientId: "00000000-0000-4000-8000-000000000001",
    clientName: "Test LLC",
    year,
    currency: "AED",
    openingEquity,
    rows: entries.map(([ledgerName, amount], i) => ({
      id: `${year}-${i}`,
      ledgerName,
      amount,
      scheduleKey: resolveSchedule(ledgerName, amount),
    })),
  }
  return { ...input, id: `x-${year}`, revision: 1, updatedAt: "", statements: calculateFinancials(input) }
}

// Year 1: capital 100k introduced, trading.
const y2024 = record(2024, [
  ["Share Capital", -100000],
  ["Revenue", -713816],
  ["Cost of Goods Sold", 583228],
  ["Rent Expense", 98113],
  ["Fee & Subscription", 8251],
  ["Bank Charges", 19068],
  ["Bank", 166448.64],
  ["Cash in Hand", 4312.58],
  ["Inventory", 299172.28],
  ["Accounts Receivable", 302825.4],
  ["Accounts Payable", -606834.33],
  ["VAT Control", 15415.71],
  ["Current Account", -76184],
  ["Other Expense", -0.28],
])
// Year 2 with fixed assets, depreciation and entertainment.
const y2025 = record(
  2025,
  [
    ["Share Capital", -100000],
    ["Retained Earnings", -y2024.statements.netProfit],
    ["Revenue", -1422700.46],
    ["Cost of Goods Sold", 755643.05],
    ["Rent Expense", 124500],
    ["Meal & Entertainment", 2000],
    ["Depreciation Expense", 375],
    ["Office Expense", 20163.8],
    ["Bank Charges", 849.97],
    ["Fixed Assets", 750],
    ["Allowance for Depreciation", -375],
    ["Bank", 139599.88],
    ["Inventory", 815876.54],
    ["Accounts Receivable", 514756.77],
    ["Accounts Payable", -773960.58],
    ["VAT Control", 15492.74],
    ["Current Account", -87815.43],
  ],
  { capital: 100000, earnings: y2024.statements.netProfit, retained: 0, shareholder: 76184 }
)

test("standard TB heads map to a report line and category", () => {
  assert.equal(ledgerHeads.length, 41)
  for (const head of ledgerHeads)
    assert.notEqual(resolveSchedule(head.name, head.name === "VAT Control" ? -1 : 1), "", head.name)
  assert.equal(resolveSchedule("Cash in Hand", 10), "cash")
  assert.equal(resolveSchedule("VAT Control", 10), "taxReceivable")
  assert.equal(resolveSchedule("VAT Control", -10), "taxPayable")
  assert.equal(resolveSchedule("Depreciation Expense", 10), "depreciation")
  assert.equal(resolveSchedule("Staff accommodation", 10, [{ name: "Staff accommodation", scheduleKey: "rent" }]), "rent")
})

test("cash flow reconciles to cash across two years", () => {
  assert.equal(y2024.statements.balanceDifference, 0)
  assert.equal(y2025.statements.balanceDifference, 0)
  const first = calculateCashFlow(y2024.statements, null)
  assert.equal(first.firstYear, true)
  assert.equal(first.difference, 0)
  const second = calculateCashFlow(y2025.statements, y2024.statements)
  assert.equal(second.difference, 0)
  assert.equal(second.openingCash, 170761.22)
  assert.equal(second.closingCash, 139599.88)
  const ppe = second.lines.find((line) => line.label.startsWith("Purchase of property"))
  assert.equal(ppe.amount, -750)
})

test("VAT periods follow the registration cycle", () => {
  const vat = { trn: "104123456700003", effectiveDate: "2023-05-01", frequency: "quarterly", cycleStartMonth: 5 }
  const periods = vatPeriods(vat, "2023-01-01", "2023-12-31")
  assert.deepEqual(periods.map((p) => [p.start, p.end]), [
    ["2023-05-01", "2023-07-31"],
    ["2023-08-01", "2023-10-31"],
    ["2023-11-01", "2024-01-31"],
  ])
  assert.equal(periods[0].dueDate, "2023-08-28")
  const midCycle = vatPeriods({ ...vat, effectiveDate: "2023-06-15" }, "2023-01-01", "2023-08-31")
  assert.deepEqual(midCycle[0], { id: "2023-06-15_2023-07-31", start: "2023-06-15", end: "2023-07-31", dueDate: "2023-08-28" })
  assert.equal(vatPeriods({ ...vat, frequency: "monthly" }, "2023-01-01", "2023-06-30").length, 2)
  // A window starting mid-period keeps the whole return period.
  const later = vatPeriods({ ...vat, cycleStartMonth: 2 }, "2024-01-01", "2024-03-31")
  assert.deepEqual(later.map((p) => [p.start, p.end]), [["2023-11-01", "2024-01-31"], ["2024-02-01", "2024-04-30"]])
})

test("financial periods and CT deadlines", () => {
  assert.deepEqual(financialPeriod(2025, 12), { start: "2025-01-01", end: "2025-12-31" })
  assert.deepEqual(financialPeriod(2025, 3), { start: "2024-04-01", end: "2025-03-31" })
  assert.equal(ctDueDate("2024-12-31"), "2025-09-30")
  assert.equal(ctDueDate("2025-03-31"), "2025-12-31")
})

const company = {
  ...emptyCompanyDraft(),
  id: "00000000-0000-4000-8000-000000000001",
  name: "TARANTEEN LLC",
  authority: "Sharjah Economic Development Department",
  emirate: "Sharjah",
  licenseNumber: "2323551",
  licenseIssueDate: "2023-04-14",
  businessActivity: "General Trading",
  partners: [{ name: "Owner One", nationality: "Iran", sharePercent: 100, shareValue: 100000 }],
  manager: "Owner One",
  vat: { trn: "104123456700003", effectiveDate: "2024-01-01", frequency: "quarterly", cycleStartMonth: 1 },
  ct: { trn: "104123456700099", firstPeriodStart: "2024-01-01", yearEndMonth: 12 },
  customHeads: [],
  vatOverrides: {},
  documents: [],
  revision: 1,
  createdAt: "",
  updatedAt: "",
}

test("company draft validation", () => {
  assert.equal(companyDraftSchema.safeParse(company).success, true)
  const bad = companyDraftSchema.safeParse({ ...company, partners: [{ ...company.partners[0], sharePercent: 60 }] })
  assert.equal(bad.success, false)
  assert.match(bad.error.issues[0].message, /100%/)
  assert.equal(companyDraftSchema.safeParse({ ...company, vat: { ...company.vat, trn: "123" } }).success, false)
})

test("VAT estimate apportions annual figures by days; overrides win", () => {
  const rows = vatSchedule(company, [y2024, y2025])
  assert.equal(rows.length, 8)
  const q1 = rows[0]
  assert.equal(q1.start, "2024-01-01")
  assert.equal(q1.source, "Estimated")
  assert.equal(q1.outputVat, Math.round(713816 * (91 / 366) * 0.05 * 100) / 100)
  const withOverride = vatSchedule(
    { ...company, vatOverrides: { [q1.id]: { standardSales: 100000, zeroRatedSales: 0, exemptSales: 0, standardExpenses: 40000 } } },
    [y2024]
  )
  assert.equal(withOverride[0].source, "Entered")
  assert.equal(withOverride[0].netVat, 3000)
  assert.deepEqual(vatSchedule({ ...company, vat: { ...company.vat, trn: "" } }, [y2024]), [])
})

test("corporate tax: regime start, 9% above 375k, entertainment add-back, SBR", () => {
  const rows = ctSchedule(company, [y2024, y2025])
  const r25 = rows.find((row) => row.year === 2025)
  assert.equal(r25.status, "In scope")
  assert.equal(r25.entertainmentAddBack, 1000)
  assert.equal(r25.taxableIncome, Math.round((y2025.statements.netProfit + 1000) * 100) / 100)
  assert.equal(r25.ctStandard, Math.round((r25.taxableAfterLosses - 375000) * 0.09 * 100) / 100)
  assert.equal(r25.sbrEligible, true)
  assert.equal(r25.dueDate, "2026-09-30")
  const early = ctSchedule(company, [record(2023, [["Revenue", -10], ["Bank", 10]])])
  assert.equal(early[0].status, "Before CT regime")
})

test("report model: comparatives, dynamic notes, no audit wording", () => {
  const model = buildReport(company, [y2024, y2025], 2025)
  assert.equal(model.priorYear, 2024)
  assert.equal(model.periodEndText, "31 December 2025")
  const totalAssets = model.bs.find((row) => row.label === "Total assets")
  assert.equal(totalAssets.current, y2025.statements.bs.find((l) => l.row === 25).amount)
  assert.equal(totalAssets.prior, y2024.statements.bs.find((l) => l.row === 25).amount)
  // Notes are numbered consecutively from 5 and BS notes point at them.
  model.notes.forEach((note, i) => assert.equal(note.number, 5 + i))
  const ppeNote = model.notes.find((note) => note.title === "Property, plant and equipment")
  assert.equal(model.bs.find((row) => row.label === "Property, plant and equipment").note, ppeNote.number)
  assert.equal(ppeNote.rows.at(-1).current, 375)
  const text = JSON.stringify(model).toLowerCase()
  assert.doesNotMatch(text, /audit/)
  assert.equal(model.cashFlow.at(-1).current, 139599.88)
})

test("rule-based extraction reads text-based UAE documents", () => {
  const fields = extractWithRules({
    tradeLicense: "Government of Sharjah\nSharjah Economic Development Department\nCommercial License\nLicense No. 2323551\nTrade Name: TARANTEEN LLC\nLegal Type: Limited Liability Company\nIssue Date: 14/04/2023\nActivities: General Trading, Non Specialized wholesale trade\nManager: Hamidreza Esmaeel Damroodi\nPartners: Hamidreza Esmaeel Damroodi Iran 100%",
    vatCertificate: "Federal Tax Authority\nTax Registration Number (TRN): 104123456700003\nEffective Registration Date: 01/05/2023\nFirst VAT Return Period: 01/05/2023 - 31/07/2023\nTax Period: Quarterly",
    ctCertificate: "Corporate Tax Registration Certificate\nTax Registration Number: 104123456700099\nFirst Tax Period: 01/01/2024 - 31/12/2024",
  })
  assert.equal(fields.name, "TARANTEEN LLC")
  assert.equal(fields.emirate, "Sharjah")
  assert.equal(fields.licenseNumber, "2323551")
  assert.equal(fields.licenseIssueDate, "2023-04-14")
  assert.equal(fields.manager, "Hamidreza Esmaeel Damroodi")
  assert.deepEqual(fields.partners, [{ name: "Hamidreza Esmaeel Damroodi", nationality: "Iran", sharePercent: 100, shareValue: 0 }])
  assert.deepEqual(fields.vat, { trn: "104123456700003", effectiveDate: "2023-05-01", frequency: "quarterly", cycleStartMonth: 5 })
  assert.deepEqual(fields.ct, { trn: "104123456700099", firstPeriodStart: "2024-01-01", yearEndMonth: 12 })
  assert.equal(normaliseDate("14th April 2023"), "2023-04-14")
  assert.equal(normaliseDate("31/02/2024"), "")
})

test("VAT periods straddling a year with no data are flagged partial", () => {
  const staggered = { ...company, vat: { ...company.vat, effectiveDate: "2023-05-01", cycleStartMonth: 2 } }
  const rows = vatSchedule(staggered, [y2024])
  assert.equal(rows[0].id, "2023-11-01_2024-01-31")
  assert.equal(rows[0].source, "Partial data")
  assert.equal(rows.at(-1).id, "2024-11-01_2025-01-31")
  assert.equal(rows.at(-1).source, "Partial data")
  assert.equal(rows[1].source, "Estimated")
})

test("plain amounts are signed by the nature of each head", async () => {
  const { toSigned, toPlain, naturalSide, choiceLabel } = await jiti.import("../lib/ledger-heads.ts")
  assert.equal(toSigned("Revenue", 1000, "sales"), -1000)
  assert.equal(toSigned("Rent Expense", 500, "rent"), 500)
  assert.equal(toSigned("Allowance for Depreciation", 375, "ppe"), -375)
  assert.equal(toSigned("Bank", -200, "bank"), -200) // overdrawn: entered as negative
  assert.equal(toSigned("VAT Control", 300, "taxPayable", [], -1), -300)
  assert.equal(choiceLabel("VAT Control", -300), "We owe the FTA")
  assert.equal(choiceLabel("Current Account", 50), "Owner owes the company")
  assert.equal(toPlain("Accounts Payable", -900, "payables"), 900)
  // Custom heads take their side from the report line they are mapped to.
  assert.equal(naturalSide("Staff accommodation", "rent", [{ name: "Staff accommodation", scheduleKey: "rent" }]), 1)
  assert.equal(naturalSide("Customer deposits", "customerAdvances", [{ name: "Customer deposits", scheduleKey: "customerAdvances" }]), -1)
})

test("uploads: plain positive files are signed and balanced; signed exports are kept", async () => {
  const { interpretImport } = await jiti.import("../lib/ledger-heads.ts")
  const plain = interpretImport([
    { ledgerName: "Share Capital", amount: 100000 },
    { ledgerName: "Revenue", amount: 50000 },
    { ledgerName: "Rent Expense", amount: 20000 },
    { ledgerName: "Bank", amount: 132000 },
    { ledgerName: "VAT Control", amount: 2000 }, // either way: must be "We owe the FTA" to balance
  ])
  assert.equal(plain.convention, "plain")
  assert.equal(plain.rows.reduce((t, r) => t + r.amount, 0), 0)
  assert.equal(plain.rows.find((r) => r.ledgerName === "VAT Control").amount, -2000)
  assert.equal(plain.rows.find((r) => r.ledgerName === "VAT Control").scheduleKey !== "", true)
  assert.deepEqual(plain.resolved, ["VAT Control"])

  const signed = interpretImport([
    { ledgerName: "Share Capital", amount: -100000 },
    { ledgerName: "Revenue", amount: -50000 },
    { ledgerName: "Rent Expense", amount: 20000 },
    { ledgerName: "Bank", amount: 130000 },
  ])
  assert.equal(signed.convention, "signed")
  assert.equal(signed.rows.find((r) => r.ledgerName === "Revenue").amount, -50000)
})
