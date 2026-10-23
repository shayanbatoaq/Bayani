/**
 * Which bank statement lines carry VAT, under the UAE VAT law (Federal Decree-Law 8 of 2017
 * and its Executive Regulation). Lines that are never VAT (salaries, transfers between own
 * accounts, owner and loan movements, government fees, tax payments, interest) are settled
 * automatically; for the rest the user says whether the amount includes 5% VAT, and the
 * answer is remembered for that payer or payee.
 */

/** Categories that never carry VAT. */
const NO_VAT = new Set([
  "payroll", // employment is not a supply
  "transfer",
  "owner",
  "capital",
  "loan",
  "tax", // payments to the FTA
  "cash",
  "reversed",
  "review",
  "govFees", // sovereign fees are outside the scope of VAT
  "interest", // margin-based financial services are exempt
  "deposits", // refundable deposits are not consideration
  "vatPaid", // the VAT line itself
  "receivable", // settles an invoice that already carries its VAT
  "payable",
  "prepaid",
  "otherIncome", // interest, refunds and cashback
])
/** Balance sheet heads that carry no VAT when money moves on them. */
const NO_VAT_KEYS = new Set(["payroll", "capital", "retained", "shareholder", "dividends", "longTermLiabilities", "directorLoan", "bank", "cash", "taxPayable", "taxReceivable", "endOfService", "depreciation", "relatedPayable", "relatedReceivable", "otherIncome", "receivables", "payables", "customerAdvances", "deposits"])

export type VatAnswer = "incl" | "none"

/** "none" when the law settles it, null when the user must say. */
export function lawVat(category: string, scheduleKey: string): VatAnswer | null {
  if (NO_VAT.has(category)) return "none"
  if (category.startsWith("head:") && NO_VAT_KEYS.has(scheduleKey)) return "none"
  return null
}

export const splitVat = (gross: number) => {
  const net = Math.round((gross / 1.05) * 100) / 100
  return { net, vat: Math.round((gross - net) * 100) / 100 }
}

/**
 * Banks either include the VAT in the charge (210 = 200 + 10) or debit it as its own line
 * ("VAT on charges" 10 beside the 200 charge). A charge with its VAT line beside it carries
 * no VAT itself.
 */
export function chargesWithVatLine<T extends { id: string; date: string; amount: number; accountKey: string }>(lines: T[], isVatLine: (t: T) => boolean) {
  const found = new Set<string>()
  const vatLines = lines.filter(isVatLine)
  for (const v of vatLines) {
    const partner = lines.find(
      (t) => t.id !== v.id && !isVatLine(t) && t.accountKey === v.accountKey && t.amount < 0 && Math.abs(Date.parse(t.date) - Date.parse(v.date)) <= 86400000 && Math.abs(Math.abs(t.amount) * 0.05 - Math.abs(v.amount)) <= 0.011,
    )
    if (partner) found.add(partner.id)
  }
  return found
}
