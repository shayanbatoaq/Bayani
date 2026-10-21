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

const normal = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ")

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
