export type LedgerRow = {
  scheduleKey?: string
  id: string
  ledgerName: string
  amount: number
  category: string
  confidence: "High" | "Medium" | "Low" | "Reviewed"
  rationale: string
}

export type ImportResult = {
  entries: { ledgerName: string; amount: number }[]
  skipped: number
  totalsSkipped: number
}

export const ledgerHeaders = [
  "name of ledger",
  "ledger name",
  "ledger",
  "heads name",
  "account name",
  "account",
  "name",
]
const amountHeaders = ["amount", "balance", "net balance", "closing balance"]
const debitHeaders = ["debit", "dr", "debit balance"]
const creditHeaders = ["credit", "cr", "credit balance"]

export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  let text = String(value ?? "").trim()
  if (!text) return null
  text = text.replace(/^(?:AED|USD|GBP|EUR|PKR|[$\u00a3\u20ac])\s*/i, "")
  const parenthesized = /^\(.*\)$/.test(text)
  if (parenthesized) text = text.slice(1, -1).trim()
  // Validate separators before stripping them so malformed values cannot become valid balances.
  if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)$/.test(text))
    return null
  const amount = Number(text.replaceAll(",", ""))
  if (
    !Number.isFinite(amount) ||
    Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100
  )
    return null
  return parenthesized ? -Math.abs(amount) : amount
}

export function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

export function findColumns(row: unknown[]) {
  const headers = row.map(normalizeHeader)
  const find = (names: string[]) =>
    headers.findIndex((header) => names.includes(header))
  return {
    ledger: find(ledgerHeaders),
    amount: find(amountHeaders),
    debit: find(debitHeaders),
    credit: find(creditHeaders),
  }
}

export function isLedgerHeader(row: unknown[]) {
  const columns = findColumns(row)
  return (
    columns.ledger >= 0 &&
    (columns.amount >= 0 || columns.debit >= 0 || columns.credit >= 0)
  )
}

export function rowsToLedgerEntries(rows: unknown[][]): ImportResult {
  const headerIndex = rows.findIndex(isLedgerHeader)
  if (headerIndex < 0)
    throw new Error(
      "No ledger table found. Use Account and Amount column headings, or download the template."
    )
  const columns = findColumns(rows[headerIndex])
  const result: ImportResult = { entries: [], skipped: 0, totalsSkipped: 0 }
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.every((cell) => !String(cell ?? "").trim()) || isLedgerHeader(row))
      continue
    const ledgerName = String(row[columns.ledger] ?? "").trim()
    if (/^(?:grand\s+total|sub\s*total|total)(?:\s|$)/i.test(ledgerName)) {
      result.totalsSkipped++
      continue
    }
    let amount: number | null
    if (columns.amount >= 0) {
      amount = parseAmount(row[columns.amount])
    } else {
      const debitCell = columns.debit >= 0 ? row[columns.debit] : null
      const creditCell = columns.credit >= 0 ? row[columns.credit] : null
      const empty = (cell: unknown) =>
        cell == null || String(cell).trim() === ""
      const debit = empty(debitCell) ? 0 : parseAmount(debitCell)
      const credit = empty(creditCell) ? 0 : parseAmount(creditCell)
      amount =
        debit === null ||
        credit === null ||
        (empty(debitCell) && empty(creditCell))
          ? null
          : debit - credit
    }
    if (!ledgerName || amount === null) {
      result.skipped++
      continue
    }
    result.entries.push({ ledgerName, amount })
  }
  if (!result.entries.length)
    throw new Error(
      "No ledger amounts found. Fill in the Amount column in the template, then upload it again."
    )
  return result
}

export function suggestMapping(
  name: string
): Pick<LedgerRow, "category" | "confidence" | "rationale"> {
  const rules: [RegExp, string][] = [
    [
      /\b(related party|director|current account|shareholder loan)\b/i,
      "Related Party Accounts",
    ],
    [/\b(vat|tax)\b/i, "Tax Accounts"],
    [/\b(other income|exchange gain)\b/i, "Other Income"],
    [/\b(revenue|sales income|sales revenue)\b/i, "Revenue"],
    [/\bcost of (goods sold|sales)\b/i, "Cost of Sales"],
    [/\b(interest|finance costs?|bank charges)\b/i, "Finance Costs"],
    [/\b(capital|retained earnings|dividends|drawings|equity)\b/i, "Equity"],
    [
      /\b(long[ -]term|non[ -]current)\b.*\b(liabilit|loan|borrow)/i,
      "Non-Current Liabilities",
    ],
    [
      /\b(payable|payables|accrual|accrued|loan|borrowings)\b/i,
      "Current Liabilities",
    ],
    [/\bprepaid\b/i, "Current Assets"],
    [
      /\b(depreciation expense|expense|expenses|payroll|wages|salaries|rent|utilities|subscription|consultancy|professional|stationery|travelling|vehicle running|discount given|meal|entertainment)\b/i,
      "Operating Expenses",
    ],
    [
      /\b(fixed assets|property|equipment|depreciation|intangible)\b/i,
      "Non-Current Assets",
    ],
    [
      /\b(bank|cash|receivable|receivables|inventory|prepaid|bad debt)\b/i,
      "Current Assets",
    ],
  ]
  const matched = rules.find(([pattern]) => pattern.test(name))
  if (!matched)
    return {
      category: "",
      confidence: "Low",
      rationale: "No matching ledger rule. Select a category.",
    }
  const review =
    matched[1] === "Related Party Accounts" ||
    /\b(loan|exchange|vat control)\b/i.test(name)
  return {
    category: matched[1],
    confidence: review ? "Low" : "Medium",
    rationale: review
      ? "Suggested from the ledger name; confirm the account treatment."
      : "Suggested from the ledger name; review before accepting.",
  }
}

export function createLedgerRow(entry: {
  ledgerName: string
  amount: number
}): LedgerRow {
  return {
    ...entry,
    id: crypto.randomUUID(),
    ...suggestMapping(entry.ledgerName),
  }
}

export function formatAmount(amount: number) {
  return amount.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
