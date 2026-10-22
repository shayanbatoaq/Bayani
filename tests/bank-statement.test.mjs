import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

// All statements here are invented layouts with invented names and figures.
const jiti = createJiti(import.meta.url)
const { parsePdfStatement, parseTableStatement, parseMoney, parseDate, detectBank } = await jiti.import("../lib/bank-statement.ts")
const { categorise, categoriseAccounts, patternOf, ledgerEntries, totalsByHead, markReversals, headCategory } = await jiti.import("../lib/bank-categories.ts")

const t = (s, x, y, w = s.length * 4.5) => ({ s, x, y, w })
const page = (items) => ({ width: 595, height: 842, items })

test("amounts and dates in the formats UAE banks print", () => {
  assert.equal(parseMoney("1,234.50"), 1234.5)
  assert.equal(parseMoney("-1,234.50"), -1234.5)
  assert.equal(parseMoney("(250.00)"), -250)
  assert.equal(parseMoney("65,625.53 Cr."), 65625.53)
  assert.equal(parseMoney("Dr.30,000.00"), -30000)
  assert.equal(parseMoney("12.5-"), -12.5)
  assert.equal(parseMoney("AE123"), null)
  assert.equal(parseDate("03/11/2025"), "2025-11-03")
  assert.equal(parseDate("29-Jan-2024"), "2024-01-29")
  assert.equal(parseDate("02 Jun 2026"), "2026-06-02")
  assert.equal(parseDate("05-08-26"), "2026-08-05")
  assert.equal(parseDate("31/13/2025"), null)
})

test("debit / credit / balance statement, newest first, with wrapped descriptions", () => {
  const items = [
    t("Sample Bank PJSC", 30, 40),
    t("IBAN: AE070330000012345678901", 30, 60),
    t("Currency: AED", 30, 75),
    t("Date", 30, 120), t("Description", 120, 120), t("Debit", 330, 120), t("Credit", 410, 120), t("Balance", 490, 120),
    // newest first
    t("Card settlement", 120, 140),
    t("10/03/2026", 30, 145), t("2,500.00", 410, 145), t("10,700.00", 490, 145),
    t("NETWORK INTERNATIONAL", 120, 150),
    t("05/03/2026", 30, 175), t("Office rent Q1 Ejari 4471", 120, 175), t("12,000.00", 330, 175), t("8,200.00", 490, 175),
    t("01/03/2026", 30, 200), t("Bank charges incl. VAT", 120, 200), t("52.50", 330, 200), t("20,200.00", 490, 200),
    t("Page 1 of 1", 260, 800),
  ]
  const result = parsePdfStatement([page(items)])
  assert.equal(result.accounts.length, 1)
  const account = result.accounts[0]
  assert.equal(account.currency, "AED")
  assert.equal(account.transactions.length, 3)
  assert.equal(account.mismatches, 0)
  assert.equal(account.opening, 20252.5)
  assert.equal(account.closing, 10700)
  assert.deepEqual(account.transactions.map((x) => x.amount), [-52.5, -12000, 2500])
  assert.match(account.transactions[2].description, /Card settlement NETWORK INTERNATIONAL/)
  assert.equal(detectBank("IBAN AE070330000012345678901"), "Mashreq")
})

test("signed amount column under a two-line heading, opening and closing printed above", () => {
  const items = [
    t("OPENING BALANCE", 420, 300), t("CLOSING BALANCE", 520, 300),
    t("1,000.00", 425, 315), t("1,640.25", 525, 315),
    t("Amount", 430, 395), t("(Incl. VAT)", 430, 401), t("Balance", 490, 403),
    t("Date", 23, 405), t("Ref. Number", 78, 405), t("Description", 160, 405),
    t("(", 490, 409), t("AED", 493, 409), t(")", 506, 409),
    t("01/02/2026", 23, 440), t("P1001", 78, 440), t("From PAYBRIDGE SETTLEMENTS", 160, 440), t("890.25", 430, 440), t("1,890.25", 490, 440),
    t("02/02/2026", 23, 462), t("P1002", 78, 462), t("Fuel station 22", 160, 462), t("-250", 430, 462), t("1,640.25", 490, 462),
  ]
  const account = parsePdfStatement([page(items)]).accounts[0]
  assert.equal(account.statedOpening, 1000)
  assert.equal(account.statedClosing, 1640.25)
  assert.equal(account.closing, 1640.25)
  assert.equal(account.verified, 2)
  assert.deepEqual(account.transactions.map((x) => x.amount), [890.25, -250])
})

test("block layout: date split over two lines, figures on the last line of the block", () => {
  const items = [
    t("Account No. :", 20, 40), t("12345678 - AED", 90, 40),
    t("Opening Balance:", 20, 55), t("5,000.00", 90, 55),
    t("Sr.No", 10, 100), t("Date", 40, 100), t("Description", 120, 100), t("Debit", 330, 100), t("Credit", 400, 100), t("Running", 470, 100),
    t("Amount", 330, 110), t("Amount", 400, 110), t("Balance", 470, 110),
    t("1", 10, 130), t("01-Aug-", 40, 130), t("MONTHLY FEE", 120, 130),
    t("2025", 40, 142), t("ACCOUNT SERVICE", 120, 142),
    t("105.00", 330, 166), t("-", 410, 166), t("4,895.00", 470, 166),
    t("2", 10, 185), t("02-Aug-", 40, 185), t("B/O SAMPLE CUSTOMER", 120, 185),
    t("2025", 40, 197),
    t("-", 340, 221), t("1,200.00", 400, 221), t("6,095.00", 470, 221),
  ]
  const account = parsePdfStatement([page(items)]).accounts[0]
  assert.equal(account.transactions.length, 2)
  assert.equal(account.opening, 5000)
  assert.equal(account.mismatches, 0)
  assert.deepEqual(account.transactions.map((x) => [x.date, x.amount]), [["2025-08-01", -105], ["2025-08-02", 1200]])
  assert.match(account.transactions[0].description, /MONTHLY FEE ACCOUNT SERVICE/)
})

test("a misread sign is corrected by the running balance; a broken line is flagged", () => {
  const items = [
    t("Date", 30, 100), t("Narration", 120, 100), t("Withdrawal", 330, 100), t("Deposit", 410, 100), t("Balance", 490, 100),
    t("01/05/2026", 30, 120), t("Opening transfer", 120, 120), t("1,000.00", 410, 120), t("1,000.00", 490, 120),
    // printed between the columns: read as a withdrawal, but the balance went up
    t("02/05/2026", 30, 140), t("Customer receipt", 120, 140), t("300.00", 372, 140), t("1,300.00", 490, 140),
    t("03/05/2026", 30, 160), t("Odd line", 120, 160), t("50.00", 330, 160), t("1,200.00", 490, 160),
  ]
  const account = parsePdfStatement([page(items)]).accounts[0]
  assert.equal(account.transactions[1].amount, 300)
  assert.equal(account.mismatches, 1)
  assert.ok(account.transactions[2].issue)
})

test("Excel export with separate debit and credit columns", () => {
  const rows = [
    ["Account statement"],
    ["Currency: USD"],
    ["Transaction Date", "Description", "Debit", "Credit", "Balance"],
    ["", "Opening balance", "", "", "100.00"],
    [new Date(Date.UTC(2026, 0, 3)), "Stripe payout", "", "400", "500.00"],
    [new Date(Date.UTC(2026, 0, 4)), "Google Workspace", "12.00", "", "488.00"],
  ]
  const parsed = parseTableStatement(rows, "statement.xlsx")
  const account = parsed.accounts[0]
  assert.equal(account.currency, "USD")
  assert.equal(account.opening, 100)
  assert.equal(account.mismatches, 0)
  assert.deepEqual(account.transactions.map((x) => x.amount), [400, -12])
})

test("UAE categorisation rules, review for unclear lines, learned rules", () => {
  const c = (description, amount) => categorise({ id: "x", date: "2026-01-01", description, amount, balance: null }).category
  assert.equal(c("From NETWORK INTERNATIONAL LLC", 500), "sales")
  assert.equal(c("WPS SALARY TRANSFER MARCH", -9000), "payroll")
  assert.equal(c("DEWA BILL PAYMENT", -800), "utilities")
  assert.equal(c("BUDGET RENT A CAR LLC", -900), "vehicle")
  assert.equal(c("Ejari rent cheque 3 of 4", -25000), "rent")
  assert.equal(c("Value Added Tax - Output", -0.25), "bankCharges")
  assert.equal(c("FEDERAL TAX AUTHORITY VAT PAYMENT", -4000), "tax")
  assert.equal(c("MINISTRY OF HUMAN RESOURCES", -450), "govFees")
  assert.equal(c("Transfer to Rami Haddad", -3000), "review")
  const own = categorise({ id: "y", date: "2026-01-01", description: "B/O NORTHWIND MARINE SUPPLIES L.L.C", amount: 5000, balance: null }, { companyName: "Northwind Marine Supplies LLC" })
  assert.equal(own.category, "transfer")
  const learned = [{ pattern: patternOf("Transfer to Rami Haddad 2201"), category: "owner" }]
  assert.equal(categorise({ id: "z", date: "2026-02-01", description: "Transfer to Rami Haddad 3307", amount: -1500, balance: null }, { learned }).category, "owner")
})

test("totals become balanced trial balance rows", () => {
  const account = { key: "a", currency: "AED", account: "", opening: 1000, closing: 1550, statedOpening: null, statedClosing: null, verified: 3, mismatches: 0, from: "", to: "",
    transactions: [
      { id: "1", date: "2026-01-02", description: "Stripe payout", amount: 1000, balance: 2000 },
      { id: "2", date: "2026-01-03", description: "DEWA", amount: -300, balance: 1700 },
      { id: "3", date: "2026-01-04", description: "Salary WPS", amount: -150, balance: 1550 },
    ] }
  const tx = categoriseAccounts([account])
  const { totals } = totalsByHead(tx)
  const rows = ledgerEntries(totals, 1550)
  rows.push({ ledgerName: "Retained Earnings", amount: -1000, scheduleKey: "retained" })
  assert.equal(Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100), 0)
  assert.deepEqual(rows.find((r) => r.ledgerName === "Revenue"), { ledgerName: "Revenue", amount: -1000, scheduleKey: "sales" })
})

test("statements issued page by page with their own opening balance stay one account", () => {
  const sheet = (y0, opening, rows) => [
    t("Currency", 389, y0), t("AED", 549, y0),
    t("DATE", 26, y0 + 155), t("DESCRIPTION", 209, y0 + 155), t("DEBIT", 355, y0 + 155), t("CREDIT", 426, y0 + 155), t("BALANCE", 518, y0 + 155),
    t("Opening balance", 214, y0 + 190), t(opening, 541, y0 + 190),
    ...rows.flatMap(([date, text, debit, credit, balance], i) => [t(date, 17, y0 + 213 + i * 12), t(text, 154, y0 + 213 + i * 12), ...(debit ? [t(debit, 374, y0 + 213 + i * 12)] : []), ...(credit ? [t(credit, 440, y0 + 213 + i * 12)] : []), t(balance, 541, y0 + 213 + i * 12)]),
    t("Closing Statement Balance", 192, y0 + 213 + rows.length * 12 + 10), t(rows.at(-1)[4], 541, y0 + 213 + rows.length * 12 + 10),
  ]
  const pages = [
    page(sheet(100, "0.00", [["23 AUG 2024", "ATM Cash Deposit", "", "2,250.00", "2,250.00"]])),
    page(sheet(100, "2,250.00", [["30 SEP 2024", "Tax Amount Due", "5.00", "", "2,245.00"], ["01 OCT 2024", "Account Maintenance Fee", "250.00", "", "1,995.00"]])),
  ]
  const accounts = parsePdfStatement(pages).accounts
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0].transactions.length, 3)
  assert.equal(accounts[0].closing, 1995)
  assert.equal(categorise(accounts[0].transactions[1]).category, "bankCharges")
})

test("a payment and its reversal cancel out; own heads can be categories", () => {
  const list = [
    { id: "a", date: "2026-03-01", description: "IPP Transfer Ref 7781 Pay Dtls SALMAR", amount: -11000, balance: null, account: "x", currency: "AED", category: "review", suggested: "purchases", source: "suggested" },
    { id: "b", date: "2026-03-01", description: "IPP Transfer Ref 7781 Pay Dtls SALMAR", amount: 11000, balance: null, account: "x", currency: "AED", category: "review", suggested: "sales", source: "suggested" },
    { id: "c", date: "2026-03-02", description: "Supplier payment", amount: -11000, balance: null, account: "x", currency: "AED", category: "review", suggested: "purchases", source: "suggested" },
  ]
  markReversals(list)
  assert.deepEqual(list.map((x) => x.category), ["reversed", "reversed", "review"])
  const head = headCategory({ name: "Subcontractor charges", scheduleKey: "costOfSales" }, "P&L")
  assert.equal(head.key, "head:Subcontractor charges")
  assert.equal(head.group, "Cost of sales")
  const learned = [{ pattern: patternOf("BLUEWAVE SCAFFOLDING 2231"), category: head.key }]
  assert.equal(categorise({ id: "d", date: "2026-03-05", description: "BLUEWAVE SCAFFOLDING 9910", amount: -700, balance: null }, { learned }).category, head.key)
})
