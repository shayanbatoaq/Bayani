import {
  categoryOf,
  scheduleLines,
  suggestSchedule,
  type ScheduleKey,
} from "./financial-statements"

export type LedgerHead = {
  name: string
  statement: "P&L" | "BS"
  mainHead: string
  /** Default report line. VAT Control is resolved by balance sign. */
  scheduleKey: ScheduleKey | "auto"
}

/** Standard trial balance heads (TB Heads file, Sheet1). */
export const ledgerHeads: LedgerHead[] = [
  { name: "Revenue", statement: "P&L", mainHead: "Income", scheduleKey: "sales" },
  { name: "Cost of Goods Sold", statement: "P&L", mainHead: "Cost of Sales", scheduleKey: "costOfSales" },
  { name: "Commission Expense", statement: "P&L", mainHead: "Operating Expenses", scheduleKey: "otherExpenses" },
  { name: "Fee & Subscription", statement: "P&L", mainHead: "Operating Expenses", scheduleKey: "subscriptions" },
  { name: "Finance Consultancy", statement: "P&L", mainHead: "Operating Expenses", scheduleKey: "consultancy" },
  { name: "General Expense", statement: "P&L", mainHead: "Operating Expenses", scheduleKey: "otherExpenses" },
  { name: "Insurance Expense", statement: "P&L", mainHead: "Operating Expenses", scheduleKey: "insurance" },
  { name: "Legal & Professional", statement: "P&L", mainHead: "Operating Expenses", scheduleKey: "legal" },
  { name: "Marketing Expense", statement: "P&L", mainHead: "Selling & Marketing Expenses", scheduleKey: "marketing" },
  { name: "Meal & Entertainment", statement: "P&L", mainHead: "Operating Expenses", scheduleKey: "entertainment" },
  { name: "Medical Expense", statement: "P&L", mainHead: "Operating Expenses", scheduleKey: "medical" },
  { name: "Office Expense", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "office" },
  { name: "Payroll Expense", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "payroll" },
  { name: "Printing & Stationery", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "printing" },
  { name: "Rent Expense", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "rent" },
  { name: "Travelling Expense", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "travel" },
  { name: "Utilities", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "utilities" },
  { name: "Vehicle Running", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "vehicle" },
  { name: "Bank Charges", statement: "P&L", mainHead: "Finance Cost", scheduleKey: "finance" },
  { name: "Interest Expense", statement: "P&L", mainHead: "Finance Cost", scheduleKey: "finance" },
  { name: "Exchange Gain / (Loss)", statement: "P&L", mainHead: "Other Income / Expense", scheduleKey: "exchange" },
  { name: "Discount Given", statement: "P&L", mainHead: "Selling Expenses", scheduleKey: "otherExpenses" },
  { name: "Postage & Courier Expense", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "office" },
  { name: "Depreciation Expense", statement: "P&L", mainHead: "Administrative Expenses", scheduleKey: "depreciation" },
  { name: "Other Expense", statement: "P&L", mainHead: "Other Expenses", scheduleKey: "otherExpenses" },
  { name: "Other Income", statement: "P&L", mainHead: "Other Income", scheduleKey: "otherIncome" },
  { name: "Accounts Receivable", statement: "BS", mainHead: "Assets", scheduleKey: "receivables" },
  { name: "Bank", statement: "BS", mainHead: "Assets", scheduleKey: "bank" },
  { name: "Cash in Hand", statement: "BS", mainHead: "Assets", scheduleKey: "cash" },
  { name: "Inventory", statement: "BS", mainHead: "Assets", scheduleKey: "inventory" },
  { name: "Prepaid Expense", statement: "BS", mainHead: "Assets", scheduleKey: "prepayments" },
  { name: "Fixed Assets", statement: "BS", mainHead: "Assets", scheduleKey: "ppe" },
  { name: "Allowance for Bad Debt", statement: "BS", mainHead: "Assets (Contra Asset)", scheduleKey: "receivables" },
  { name: "Allowance for Depreciation", statement: "BS", mainHead: "Assets (Contra Asset)", scheduleKey: "ppe" },
  { name: "Accounts Payable", statement: "BS", mainHead: "Liabilities", scheduleKey: "payables" },
  {
    name: "VAT Control",
    statement: "BS",
    mainHead: "Current Assets / Current Liabilities (depends on balance)",
    scheduleKey: "auto",
  },
  {
    name: "Current Account",
    statement: "BS",
    mainHead: "Equity / Liability (depends on partner/director account)",
    scheduleKey: "shareholder",
  },
  { name: "Long Term Liabilities", statement: "BS", mainHead: "Liabilities", scheduleKey: "longTermLiabilities" },
  { name: "Share Capital", statement: "BS", mainHead: "Equity", scheduleKey: "capital" },
  { name: "Retained Earnings", statement: "BS", mainHead: "Equity", scheduleKey: "retained" },
  { name: "Dividends", statement: "BS", mainHead: "Equity", scheduleKey: "dividends" },
]

export type CustomHead = { name: string; scheduleKey: string }

function normal(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Report line for a ledger: standard head first, then the company's own
 * heads, then a name-based suggestion. Returns "" when nothing matches.
 */
export function resolveSchedule(
  ledgerName: string,
  amount: number,
  customHeads: CustomHead[] = []
): ScheduleKey | "" {
  const key = normal(ledgerName)
  const custom = customHeads.find((head) => normal(head.name) === key)
  if (custom && scheduleLines.some((line) => line.key === custom.scheduleKey))
    return custom.scheduleKey as ScheduleKey
  const head = ledgerHeads.find((item) => normal(item.name) === key)
  if (head)
    return head.scheduleKey === "auto"
      ? amount >= 0
        ? "taxReceivable"
        : "taxPayable"
      : head.scheduleKey
  return suggestSchedule(ledgerName, amount)
}

export function describeSchedule(scheduleKey: string) {
  return categoryOf(scheduleKey)
}

/* ------------------------------------------------------------------
 * Plain-amount entry. Business owners enter positive amounts; the
 * accounting side (debit +, credit -) comes from the nature of the head.
 * ------------------------------------------------------------------ */

export type Side = 1 | -1
export type BalanceChoice = { label: string; side: Side }

/** Heads that can sit on either side, asked as a plain question. */
const headChoices: Record<string, BalanceChoice[]> = {
  "vat control": [
    { label: "We owe the FTA", side: -1 },
    { label: "The FTA owes us", side: 1 },
  ],
  "current account": [
    { label: "Company owes the owner", side: -1 },
    { label: "Owner owes the company", side: 1 },
  ],
  "exchange gain / (loss)": [
    { label: "Gain", side: -1 },
    { label: "Loss", side: 1 },
  ],
  "retained earnings": [
    { label: "Accumulated profit", side: -1 },
    { label: "Accumulated loss", side: 1 },
  ],
}

/** Standard heads whose usual balance is a credit; every other standard head is a debit. */
const creditHeads = new Set(
  [
    "Revenue",
    "Other Income",
    "Exchange Gain / (Loss)",
    "Accounts Payable",
    "VAT Control",
    "Current Account",
    "Long Term Liabilities",
    "Share Capital",
    "Retained Earnings",
    "Allowance for Bad Debt",
    "Allowance for Depreciation",
  ].map(normal)
)

export function choicesFor(ledgerName: string) {
  return headChoices[normal(ledgerName)] ?? null
}

/** Usual side of a head: +1 for debit-natured heads, -1 for credit-natured ones. */
export function naturalSide(
  ledgerName: string,
  scheduleKey: string,
  customHeads: CustomHead[] = []
): Side {
  const key = normal(ledgerName)
  if (ledgerHeads.some((head) => normal(head.name) === key))
    return creditHeads.has(key) ? -1 : 1
  const custom = customHeads.find((head) => normal(head.name) === key)
  const line = scheduleLines.find((item) => item.key === (custom?.scheduleKey ?? scheduleKey))
  return (line?.sign ?? 1) as Side
}

/** Signed amount stored by the engine, from the amount an owner types. */
export function toSigned(
  ledgerName: string,
  plainAmount: number,
  scheduleKey: string,
  customHeads: CustomHead[] = [],
  choice?: Side
) {
  if (choice && choicesFor(ledgerName)) return Math.abs(plainAmount) * choice
  return plainAmount * naturalSide(ledgerName, scheduleKey, customHeads)
}

/** Amount as the owner sees it: positive when the balance is the usual way round. */
export function toPlain(
  ledgerName: string,
  signedAmount: number,
  scheduleKey: string,
  customHeads: CustomHead[] = []
) {
  if (choicesFor(ledgerName)) return Math.abs(signedAmount)
  return signedAmount * naturalSide(ledgerName, scheduleKey, customHeads)
}

/** Plain label for the side of an either-way head, e.g. "We owe the FTA". */
export function choiceLabel(ledgerName: string, signedAmount: number) {
  return choicesFor(ledgerName)?.find((choice) => choice.side === Math.sign(signedAmount))?.label ?? null
}

export type ImportedBalance = { ledgerName: string; amount: number; scheduleKey: string }

/**
 * Converts uploaded amounts to signed balances. Files already in the
 * accountant's convention (credits negative, e.g. software exports) are kept;
 * plain positive files are signed by head. Either-way heads are set to the
 * combination that makes the figures balance.
 */
export function interpretImport(
  entries: { ledgerName: string; amount: number }[],
  customHeads: CustomHead[] = []
): { rows: ImportedBalance[]; convention: "signed" | "plain"; resolved: string[] } {
  const withKeys = entries.map((entry) => ({
    ...entry,
    scheduleKey: resolveSchedule(entry.ledgerName, entry.amount, customHeads),
  }))
  const creditNatured = withKeys.filter(
    (entry) => !choicesFor(entry.ledgerName) && naturalSide(entry.ledgerName, entry.scheduleKey, customHeads) === -1
  )
  const negative = creditNatured.filter((entry) => entry.amount < 0).length
  if (creditNatured.length && negative * 2 > creditNatured.length)
    return { rows: withKeys, convention: "signed", resolved: [] }

  const rows = withKeys.map((entry) => ({
    ...entry,
    amount: choicesFor(entry.ledgerName)
      ? Math.abs(entry.amount)
      : toSigned(entry.ledgerName, entry.amount, entry.scheduleKey, customHeads),
  }))
  const flexible = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => choicesFor(row.ledgerName) && row.amount !== 0)
  const cents = (n: number) => Math.round(n * 100)
  const fixedTotal = rows
    .filter((row) => !choicesFor(row.ledgerName))
    .reduce((sum, row) => sum + cents(row.amount), 0)
  // Try every side combination (at most a few heads) and keep the one closest to balancing.
  let best = { diff: Infinity, mask: 0 }
  const limit = Math.min(flexible.length, 10)
  for (let mask = 0; mask < 1 << limit; mask++) {
    let total = fixedTotal
    flexible.forEach(({ row }, i) => {
      const choices = choicesFor(row.ledgerName)!
      const usual = choices[0].side
      const side = i < limit && mask & (1 << i) ? -usual : usual
      total += cents(Math.abs(row.amount)) * side
    })
    const diff = Math.abs(total)
    if (diff < best.diff) best = { diff, mask }
  }
  const resolved: string[] = []
  flexible.forEach(({ row, index }, i) => {
    const usual = choicesFor(row.ledgerName)![0].side
    const side = i < limit && best.mask & (1 << i) ? -usual : usual
    rows[index] = { ...row, amount: Math.abs(row.amount) * side }
    resolved.push(row.ledgerName)
  })
  return { rows, convention: "plain", resolved }
}
