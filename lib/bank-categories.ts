import type { BankAccount, BankTransaction } from "./bank-statement"

/**
 * Sorting bank transactions into the heads of the data input, with rules for how UAE
 * businesses' money moves: card settlements, WPS salaries, Ejari rent, DEWA, FTA payments,
 * licence and visa fees, and bank charges. Anything unclear goes to "Under review" with a
 * suggestion, and every choice the user makes is remembered for the next statement.
 */

export type CategoryGroup = "Income" | "Cost of sales" | "Expenses" | "Balance sheet" | "Not counted"
export type Category = {
  key: string
  label: string
  /** Head written into the data input; matches the standard ledger heads where one exists. */
  ledgerName: string
  scheduleKey: string
  group: CategoryGroup
  hint: string
}

export const CATEGORIES: Category[] = [
  { key: "sales", label: "Sales / customer receipts", ledgerName: "Revenue", scheduleKey: "sales", group: "Income", hint: "Money received from customers, card and payment-link settlements" },
  { key: "otherIncome", label: "Other income", ledgerName: "Other Income", scheduleKey: "otherIncome", group: "Income", hint: "Interest received, refunds, cashback, sundry income" },
  { key: "purchases", label: "Purchases / suppliers", ledgerName: "Cost of Goods Sold", scheduleKey: "costOfSales", group: "Cost of sales", hint: "Stock, materials and direct costs of what you sell" },
  { key: "payroll", label: "Salaries & staff", ledgerName: "Payroll Expense", scheduleKey: "payroll", group: "Expenses", hint: "Salaries (WPS), bonuses, staff benefits" },
  { key: "rent", label: "Rent", ledgerName: "Rent Expense", scheduleKey: "rent", group: "Expenses", hint: "Office, shop or warehouse rent, Ejari" },
  { key: "utilities", label: "Utilities & telecom", ledgerName: "Utilities", scheduleKey: "utilities", group: "Expenses", hint: "DEWA, SEWA, ADDC, Empower, du, e&" },
  { key: "govFees", label: "Licence, visa & government fees", ledgerName: "Licence & Visa Fees", scheduleKey: "otherExpenses", group: "Expenses", hint: "Trade licence, free zone, immigration, MOHRE, Amer, Tasheel" },
  { key: "professional", label: "Professional fees", ledgerName: "Legal & Professional", scheduleKey: "legal", group: "Expenses", hint: "Audit, accounting, legal, consultancy, PRO" },
  { key: "marketing", label: "Marketing", ledgerName: "Marketing Expense", scheduleKey: "marketing", group: "Expenses", hint: "Google, Meta, TikTok, LinkedIn, printing of promotions" },
  { key: "software", label: "Software & subscriptions", ledgerName: "Fee & Subscription", scheduleKey: "subscriptions", group: "Expenses", hint: "Microsoft, Google Workspace, Zoho, Adobe, hosting" },
  { key: "travel", label: "Travel", ledgerName: "Travelling Expense", scheduleKey: "travel", group: "Expenses", hint: "Flights, hotels, taxis" },
  { key: "vehicle", label: "Vehicle & fuel", ledgerName: "Vehicle Running", scheduleKey: "vehicle", group: "Expenses", hint: "Fuel, Salik, RTA, car rental, servicing" },
  { key: "meals", label: "Meals & entertainment", ledgerName: "Meal & Entertainment", scheduleKey: "entertainment", group: "Expenses", hint: "Restaurants, food delivery, client entertainment" },
  { key: "office", label: "Office & supplies", ledgerName: "Office Expense", scheduleKey: "office", group: "Expenses", hint: "Stationery, groceries for office, courier, small items" },
  { key: "insurance", label: "Insurance", ledgerName: "Insurance Expense", scheduleKey: "insurance", group: "Expenses", hint: "Medical, vehicle, property insurance" },
  { key: "bankCharges", label: "Bank charges", ledgerName: "Bank Charges", scheduleKey: "finance", group: "Expenses", hint: "Fees, commissions, transfer charges and the VAT on them" },
  { key: "interest", label: "Interest / finance cost", ledgerName: "Interest Expense", scheduleKey: "finance", group: "Expenses", hint: "Interest or profit paid on loans and overdrafts" },
  { key: "otherExpense", label: "Other expenses", ledgerName: "Other Expense", scheduleKey: "otherExpenses", group: "Expenses", hint: "Anything that fits no other head" },
  { key: "tax", label: "VAT / corporate tax paid", ledgerName: "VAT Control", scheduleKey: "taxPayable", group: "Balance sheet", hint: "Payments to the Federal Tax Authority (not an expense)" },
  { key: "assets", label: "Equipment & fixed assets", ledgerName: "Fixed Assets", scheduleKey: "ppe", group: "Balance sheet", hint: "Computers, furniture, vehicles, fit-out bought for long-term use" },
  { key: "deposits", label: "Deposits & advances paid", ledgerName: "Prepaid Expense", scheduleKey: "prepayments", group: "Balance sheet", hint: "Security deposits, advances to suppliers, prepaid rent" },
  { key: "capital", label: "Capital introduced", ledgerName: "Share Capital", scheduleKey: "capital", group: "Balance sheet", hint: "Owner paying in share capital" },
  { key: "owner", label: "Owner's account (in / drawings)", ledgerName: "Current Account", scheduleKey: "shareholder", group: "Balance sheet", hint: "Owner putting money in or taking money out" },
  { key: "loan", label: "Loan received / repaid", ledgerName: "Long Term Liabilities", scheduleKey: "longTermLiabilities", group: "Balance sheet", hint: "Bank or other loans drawn and instalments repaid" },
  { key: "cash", label: "Cash withdrawn / deposited", ledgerName: "Cash in Hand", scheduleKey: "cash", group: "Balance sheet", hint: "ATM withdrawals and cash deposits (spent or banked in cash)" },
  { key: "reversed", label: "Reversed / returned payment", ledgerName: "", scheduleKey: "", group: "Not counted", hint: "A payment and its reversal: together they move no money" },
  { key: "transfer", label: "Transfer between own accounts", ledgerName: "Bank (other company accounts)", scheduleKey: "bank", group: "Not counted", hint: "Moving money between the company's own accounts" },
  { key: "review", label: "Under review", ledgerName: "", scheduleKey: "", group: "Not counted", hint: "Not yet decided" },
]
export const categoryByKey = new Map(CATEGORIES.map((c) => [c.key, c]))

/** The company's own heads (from the trial balance list) can be used as categories too. */
export const HEAD_PREFIX = "head:"
export function headCategory(head: { name: string; scheduleKey: string }, statement?: "BS" | "P&L"): Category {
  return {
    key: `${HEAD_PREFIX}${head.name}`,
    label: head.name,
    ledgerName: head.name,
    scheduleKey: head.scheduleKey,
    group: statement === "BS" ? "Balance sheet" : head.scheduleKey === "sales" || head.scheduleKey === "otherIncome" ? "Income" : head.scheduleKey === "costOfSales" ? "Cost of sales" : "Expenses",
    hint: "Your own head",
  }
}

type Rule = { test: RegExp; category: string; direction?: "in" | "out"; review?: boolean; max?: number }

const RULES: Rule[] = [
  // Not income or expense
  { test: /own acc|own account|account to account transfer|between (my|own) accounts|internal transfer|transfer to self/i, category: "transfer" },
  { test: /federal tax authority|\bfta\b|tax payment|vat payment|corporate tax payment|emaratax/i, category: "tax", direction: "out" },
  { test: /\b(atm|cash withdrawal|cash wdl|cdm|cash deposit)\b/i, category: "cash" },
  { test: /share capital|capital (injection|contribution|introduced)/i, category: "capital", direction: "in" },
  { test: /\b(loan (disbursal|disbursement|drawdown)|finance disbursal)\b/i, category: "loan", direction: "in" },
  { test: /\b(loan|emi|instal?ment|murabaha|ijara|finance repayment)\b/i, category: "loan", direction: "out" },
  { test: /security deposit|refundable deposit/i, category: "deposits", direction: "out" },
  // Bank charges and the VAT on them
  { test: /tax amount due|vat amount|tax on charges/i, category: "bankCharges", direction: "out", max: 1000 },
  // (size limits keep large payments whose narrative mentions "telex" or "charges" out of bank charges)
  { test: /value added tax|vat on|^vat\b|\bvat$|- vat|vat\)|incl\. vat/i, category: "bankCharges", direction: "out", max: 1000 },
  { test: /\b(bank|account|a\/c|transfer|trf|txn|transaction|service|remittance|swift|telex|ipp|atm|cheque|chq|card|digital banking|online banking|internet banking|corr|correspondent|correspondant|conf\.?|confirmation|membership|subscription|processing|handling|statement|ledger|maintenance|maintainance|min(imum)? bal(ance)?|balance requirement|outward|inward|instant payment|exchange|fx|covering|retail|monthly|annual|aani|uaefts)\b[\w\s.-]{0,14}?\b(charges?|chgs|fees?|commission|recovery|recoveries)\b|^charges?\b|charge collection|commission|telex recover|stamp duty|non maintenance of balance|min bal fee|premium -|corr\.?bank|charges collection/i, category: "bankCharges", direction: "out", max: 5000 },
  { test: /\binterest\b|profit paid|overdraft interest/i, category: "interest", direction: "out" },
  { test: /\binterest\b|profit (credit|distribution)|cashback|cash back/i, category: "otherIncome", direction: "in" },
  // Income
  { test: /network international|magnati|mashreq neopay|\bpos settlement|merchant settlement|card settlement|stripe|checkout\.?com|telr|paytabs|tap payments|\bpayby\b|ziina|tabby|tamara|amazon payments|noon payments|talabat|deliveroo|careem (pay|food)|shopify payments|paypal/i, category: "sales", direction: "in" },
  // Staff
  { test: /\b(salary|salaries|sal\b|payroll|wps|sif|wages?|bonus|end of service|gratuity|leave salary)\b|\bsal(?:ary)?[\s-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i, category: "payroll", direction: "out" },
  { test: /\b(enoc|adnoc|eppco|emarat|petrol|fuel|salik|rta|parking|rent a car|car rental|autopro|tyres?|car wash)\b/i, category: "vehicle", direction: "out" },
  // Premises
  { test: /\b(rent|ejari|lease|landlord|tenancy)\b/i, category: "rent", direction: "out" },
  // Utilities and telecom
  { test: /\b(dewa|sewa|addc|aadc|fewa|etihad water|empower|tabreed|lootah gas|emirates gas|etisalat|e&|du (quick ?pay|bill|mobile|postpaid|prepaid|recharge|payment|home)|du\.ae|emirates integrated telecom|virgin mobile)\b/i, category: "utilities", direction: "out" },
  // Government
  { test: /\b(ded|dubai economy|department of economy|tasheel|amer|tawjeeh|mohre|ministry of human|ministry of|gdrfa|federal authority for identity|emirates id|visa (fee|fees|charges|application|renewal|stamping|change)|entry permit|residence permit|immigration|jafza|jebel ali free zone|dmcc authority|dafza|rakez|ifza|meydan free zone|shams free zone|spc free zone|ajman free zone|creative city|trade licen[cs]e|licen[cs]e renewal|chamber of commerce|dubai municipality|traffic fine|dubai police)\b/i, category: "govFees", direction: "out" },
  // Professional
  { test: /\b(audit|auditing|accounting|bookkeeping|legal|advocates?|lawyer|consultan(t|cy)|notary|pro services|tax agent)\b/i, category: "professional", direction: "out" },
  // Marketing
  { test: /google ?ads|google \*ads|facebk|facebook|meta platforms|instagram|tiktok|linkedin|snapchat|twitter|x corp|mailchimp|hubspot|semrush|fiverr|upwork/i, category: "marketing", direction: "out" },
  // Software
  { test: /microsoft|msft|google \*|gsuite|google workspace|zoho|adobe|amazon web services|\baws\b|apple\.com|icloud|openai|chatgpt|anthropic|slack|notion|canva|godaddy|namecheap|shopify|wix|squarespace|dropbox|zoom\.us|atlassian|github|artlist|envato|quickbooks|xero/i, category: "software", direction: "out" },
  // Travel and vehicle
  { test: /emirates airline|emirates\.com|flydubai|air ?arabia|etihad airways|booking\.com|expedia|agoda|airbnb|hotel|marriott|hilton|accor|ibis|rotana|careem|uber|\btaxi\b|hala|airport/i, category: "travel", direction: "out" },
  // Meals, office, insurance
  { test: /restaurant|cafe|coffee|starbucks|costa|tim hortons|mcdonald|kfc|pizza|shawarma|talabat|deliveroo|zomato|noon food|eataly|diner|grill|bistro|kitchen/i, category: "meals", direction: "out" },
  { test: /carrefour|lulu|spinneys|waitrose|union coop|choithrams|instashop|ikea|ace hardware|office (supplies|expense|equipment)|stationery|aramex|dhl|fedex|smsa|courier|emirates post|amazon\.ae|noon\.com|duty free/i, category: "office", direction: "out" },
  { test: /insurance|takaful|axa (insurance|gulf)|sukoon|daman|orient insurance|oman insurance|adnic|watania/i, category: "insurance", direction: "out" },
]

export type CategorisedTransaction = BankTransaction & {
  account: string
  currency: string
  category: string
  suggested: string
  /** How the category was chosen. */
  source: "rule" | "learned" | "user" | "suggested"
}

export type LearnedRule = { pattern: string; category: string }

/** A stable key for "the same counterparty": words without numbers, references or dates. */
export function patternOf(description: string) {
  return description
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z& ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "from", "to", "ref", "trf", "transfer", "payment", "inward", "outward", "remittance", "online", "llc", "fze", "fzco", "fz", "dmcc", "date", "value"].includes(w))
    .slice(0, 4)
    .join(" ")
}

function companyWords(name: string) {
  return name
    .toLowerCase()
    .replace(/\b(l\.?l\.?c|fze|fzco|fz-llc|fz llc|dmcc|co|company|trading|est|establishment|limited|ltd|the|and|for|of)\b/g, " ")
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
}

export function categorise(transaction: BankTransaction, options: { companyName?: string; learned?: LearnedRule[] } = {}): { category: string; suggested: string; source: CategorisedTransaction["source"] } {
  const text = transaction.description
  const direction = transaction.amount >= 0 ? "in" : "out"
  const pattern = patternOf(text)
  const learned = pattern ? options.learned?.find((rule) => rule.pattern === pattern) : undefined
  if (learned && (categoryByKey.has(learned.category) || learned.category.startsWith(HEAD_PREFIX))) return { category: learned.category, suggested: learned.category, source: "learned" }
  // Money moving between accounts held in the company's own name.
  // (the name must follow the transfer wording: the company also appears as remitter on its own payments)
  const words = options.companyName ? companyWords(options.companyName) : []
  if (words.length && new RegExp(`\\b(b\\/o|from|to|trf to|transfer to|transfer from)[\\s_:-]*${words.join("[\\s\\S]{0,14}")}`, "i").test(text))
    return { category: "transfer", suggested: "transfer", source: "rule" }
  for (const rule of RULES) {
    if (rule.direction && rule.direction !== direction) continue
    if (rule.max !== undefined && Math.abs(transaction.amount) > rule.max) continue
    if (rule.test.test(text)) return { category: rule.category, suggested: rule.category, source: "rule" }
  }
  // Unclear: suggest the usual meaning, but leave it for the user to confirm.
  const suggested = direction === "in" ? (/cheque|chq|clearing|deposit|remittance|b\/o|from |inward/i.test(text) ? "sales" : "sales") : "purchases"
  return { category: "review", suggested, source: "suggested" }
}

export function categoriseAccounts(accounts: BankAccount[], options: { companyName?: string; learned?: LearnedRule[] } = {}): CategorisedTransaction[] {
  return accounts.flatMap((account) =>
    account.transactions.map((t) => ({ ...t, account: account.account || account.key, currency: account.currency, ...categorise(t, options) }))
  )
}

/**
 * A payment and its reversal (same account, same amount in and out within a week, same
 * counterparty) cancel out; banks leave both lines on the statement but out of their totals.
 */
export function markReversals<T extends CategorisedTransaction & { accountKey?: string }>(list: T[]) {
  const used = new Set<string>()
  for (const t of list) {
    if (t.amount >= 0 || used.has(t.id)) continue
    const pattern = patternOf(t.description)
    const back = list.find(
      (u) =>
        !used.has(u.id) &&
        u.id !== t.id &&
        (u.accountKey ?? u.account) === (t.accountKey ?? t.account) &&
        Math.abs(u.amount + t.amount) < 0.005 &&
        Math.abs(Date.parse(u.date) - Date.parse(t.date)) <= 7 * 86400000 &&
        (patternOf(u.description) === pattern || /revers|return|refund|recall|cancel/i.test(u.description))
    )
    if (back) {
      t.category = back.category = "reversed"
      t.source = back.source = "rule"
      used.add(t.id).add(back.id)
    }
  }
  return list
}

export type HeadTotal = { category: Category; amount: number; count: number }

/**
 * Totals per head for the data input, in AED. Income is money in less refunds out;
 * expenses are money out less refunds in. Transfers and unreviewed lines are left out.
 */
export function totalsByHead(transactions: CategorisedTransaction[], rates: Record<string, number> = {}) {
  const totals = new Map<string, HeadTotal>()
  let unconverted = 0
  for (const t of transactions) {
    const category = categoryByKey.get(t.category)
    if (!category || !category.ledgerName) continue
    const rate = t.currency === "AED" ? 1 : rates[t.currency]
    if (!rate) {
      unconverted++
      continue
    }
    const entry = totals.get(category.key) ?? { category, amount: 0, count: 0 }
    entry.amount += t.amount * rate
    entry.count++
    totals.set(category.key, entry)
  }
  return { totals: [...totals.values()].map((t) => ({ ...t, amount: Math.round(t.amount * 100) / 100 })), unconverted }
}

/**
 * Ledger rows for the data input in its signed convention (debit +, credit −).
 * Bank money in is a credit to the head, money out a debit; the bank balance is the
 * closing balance of the accounts.
 */
export function ledgerEntries(totals: HeadTotal[], closingBank: number) {
  const rows = totals
    .filter((t) => Math.round(t.amount * 100) !== 0)
    .map((t) => ({ ledgerName: t.category.ledgerName, amount: Math.round(-t.amount * 100) / 100, scheduleKey: t.category.scheduleKey }))
  if (Math.round(closingBank * 100) !== 0) rows.push({ ledgerName: "Bank", amount: Math.round(closingBank * 100) / 100, scheduleKey: "bank" })
  return rows
}

/** Reference rates (AED per unit) for converting foreign currency accounts; the user can change them. */
export const DEFAULT_RATES: Record<string, number> = { AED: 1, USD: 3.6725, EUR: 4.0, GBP: 4.7, SAR: 0.979, QAR: 1.009, OMR: 9.54, KWD: 12.0, BHD: 9.74, INR: 0.042, PKR: 0.013, CHF: 4.3, JPY: 0.024, CNY: 0.51, CAD: 2.65, AUD: 2.4, EGP: 0.075, TRY: 0.09, SGD: 2.8, HKD: 0.47 }
