import { z } from "zod"

/**
 * Invoices, credit notes, bills, payments and adjusting schedules for one company.
 * Shared by the browser and the server; the accounting lives in lib/books-engine.ts.
 */

export const VAT_TREATMENTS = [
  { key: "standard", label: "Standard rated (5%)", rate: 0.05, invoice: true, bill: true },
  { key: "zero", label: "Zero rated (0%)", rate: 0, invoice: true, bill: true },
  { key: "exempt", label: "Exempt", rate: 0, invoice: true, bill: true },
  { key: "outOfScope", label: "Out of scope", rate: 0, invoice: true, bill: true },
  { key: "reverseCharge", label: "Reverse charge (5%, self-accounted)", rate: 0.05, invoice: false, bill: true },
] as const
export type VatTreatment = (typeof VAT_TREATMENTS)[number]["key"]
export const vatTreatmentSchema = z.enum(["standard", "zero", "exempt", "outOfScope", "reverseCharge"])
export const vatRate = (t: VatTreatment) => VAT_TREATMENTS.find((x) => x.key === t)?.rate ?? 0

const id = z.string().min(1).max(60)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
const money = z.number().finite().min(-1e12).max(1e12)
const text = (max: number) => z.string().trim().max(max)
/** A document in another currency: its currency, units of the base currency per unit, and AED per unit (shown on UAE tax invoices). */
const currencyFields = {
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  rate: z.number().finite().positive().max(1e6).default(1),
  aedRate: z.number().finite().positive().max(1e6).optional(),
}

export const partySchema = z.object({
  id,
  name: z.string().trim().min(1, "Name is required.").max(160),
  trn: text(20).default(""),
  address: text(400).default(""),
  email: z.string().trim().max(160).refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), "Enter a valid email.").default(""),
  phone: text(40).default(""),
})
export type Party = z.infer<typeof partySchema>

export const itemSchema = z.object({ name: text(160).min(1), description: text(1000).default(""), rate: money.default(0), vat: vatTreatmentSchema.default("standard") })
export type Item = z.infer<typeof itemSchema>

export const lineSchema = z.object({
  id,
  item: text(160).default(""),
  description: text(1000).default(""),
  quantity: z.number().finite().min(0).max(1e9),
  rate: money,
  vat: vatTreatmentSchema,
})
export type Line = z.infer<typeof lineSchema>

export const settingsSchema = z.object({
  address: text(400).default(""),
  phone: text(40).default(""),
  email: text(160).default(""),
  bank: z
    .object({ accountName: text(160).default(""), bankName: text(160).default(""), iban: text(40).default(""), accountNumber: text(40).default(""), swift: text(20).default("") })
    .default({ accountName: "", bankName: "", iban: "", accountNumber: "", swift: "" }),
  numbering: z.enum(["auto", "manual"]).default("auto"),
  prefix: text(12).default("INV-"),
  nextNumber: z.number().int().min(1).max(1e9).default(1001),
  creditPrefix: text(12).default("CN-"),
  nextCredit: z.number().int().min(1).max(1e9).default(1001),
  paymentDays: z.number().int().min(0).max(365).default(30),
  footer: text(600).default(""),
})
export type BooksSettings = z.infer<typeof settingsSchema>

export const invoiceSchema = z.object({
  id,
  number: text(40).min(1, "Invoice number is required."),
  date,
  dueDate: date.or(z.literal("")).default(""),
  clientId: id,
  lines: z.array(lineSchema).min(1, "Add at least one line.").max(200),
  notes: text(1000).default(""),
  createdAt: z.string().max(40).default(""),
  ...currencyFields,
})
export type Invoice = z.infer<typeof invoiceSchema>

export const creditNoteSchema = z.object({
  id,
  number: text(40).min(1),
  date,
  invoiceId: id,
  lines: z.array(lineSchema).min(1).max(200),
  reason: text(600).default(""),
  createdAt: z.string().max(40).default(""),
})
export type CreditNote = z.infer<typeof creditNoteSchema>

export const attachmentSchema = z.object({ id, name: text(200), type: text(100), size: z.number().int().nonnegative() })
export const billSchema = z.object({
  id,
  number: text(60).default(""),
  date,
  dueDate: date.or(z.literal("")).default(""),
  vendorId: id,
  /** Head the cost is booked to (an expense, or an asset or prepayment). */
  ledgerName: text(120).min(1, "Choose the expense type."),
  scheduleKey: text(40).min(1),
  net: money,
  vat: money,
  vatTreatment: vatTreatmentSchema.default("standard"),
  ...currencyFields,
  payment: z.enum(["bank", "card", "cash", "credit"]).default("bank"),
  description: text(2000).default(""),
  attachment: attachmentSchema.nullable().default(null),
  /** Spread over months (prepaid) or depreciated (asset), set from the bill form. */
  treatment: z.enum(["expense", "prepaid", "asset"]).default("expense"),
  months: z.number().int().min(1).max(600).nullable().default(null),
  createdAt: z.string().max(40).default(""),
})
export type Bill = z.infer<typeof billSchema>

/** A statement line identified by its id and, if the statements are uploaded again, by what it says. */
export const bankLineRefSchema = z.object({ id: z.string().max(120), date, amount: money, description: z.string().max(2000) })
export type BankLineRef = z.infer<typeof bankLineRefSchema>

export const paymentSchema = z.object({
  id,
  kind: z.enum(["invoice", "bill"]),
  docId: id,
  date,
  /** In the document's currency. */
  amount: z.number().finite().positive().max(1e12),
  /** What was actually received or paid in the base currency, when it differs from amount × the document's rate (exchange difference). */
  baseAmount: z.number().finite().positive().max(1e14).optional(),
  method: z.enum(["bankLine", "bank", "cash", "card"]),
  bankLine: bankLineRefSchema.nullable().default(null),
  note: text(300).default(""),
})
export type Payment = z.infer<typeof paymentSchema>

export const scheduleSchema = z.object({
  id,
  kind: z.enum(["prepaid", "depreciation"]),
  label: text(160).min(1),
  /** Expense head the cost is released to (rent, insurance, licence; depreciation for assets). */
  ledgerName: text(120).min(1),
  scheduleKey: text(40).min(1),
  amount: z.number().finite().positive().max(1e12),
  start: date,
  months: z.number().int().min(1).max(600),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("bankLine"), line: bankLineRefSchema }),
    z.object({ type: z.literal("bill"), billId: id }),
    /** Already in the figures as a prepayment or asset: only the release is posted. */
    z.object({ type: z.literal("manual") }),
  ]),
})
export type Schedule = z.infer<typeof scheduleSchema>

export const accrualSchema = z.object({
  id,
  label: text(160).min(1),
  ledgerName: text(120).min(1),
  scheduleKey: text(40).min(1),
  amount: z.number().finite().positive().max(1e12),
  date,
  reverse: z.boolean().default(true),
})
export type Accrual = z.infer<typeof accrualSchema>

export const booksSchema = z.object({
  settings: settingsSchema.default(settingsSchema.parse({})),
  clients: z.array(partySchema).max(5000).default([]),
  vendors: z.array(partySchema).max(5000).default([]),
  items: z.array(itemSchema).max(2000).default([]),
  invoices: z.array(invoiceSchema).max(20000).default([]),
  creditNotes: z.array(creditNoteSchema).max(20000).default([]),
  bills: z.array(billSchema).max(20000).default([]),
  payments: z.array(paymentSchema).max(50000).default([]),
  schedules: z.array(scheduleSchema).max(2000).default([]),
  accruals: z.array(accrualSchema).max(2000).default([]),
  revision: z.number().int().nonnegative().default(0),
})
export type Books = z.infer<typeof booksSchema>
export const emptyBooks = (): Books => booksSchema.parse({})

/* ---------------- amounts ---------------- */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export function lineTotals(line: Pick<Line, "quantity" | "rate" | "vat">) {
  const net = round2(line.quantity * line.rate)
  const vat = line.vat === "reverseCharge" ? 0 : round2(net * vatRate(line.vat))
  return { net, vat, total: round2(net + vat) }
}
export function documentTotals(lines: Pick<Line, "quantity" | "rate" | "vat">[]) {
  const parts = lines.map(lineTotals)
  const net = round2(parts.reduce((t, p) => t + p.net, 0))
  const vat = round2(parts.reduce((t, p) => t + p.vat, 0))
  return { net, vat, total: round2(net + vat) }
}
export const billTotal = (bill: Pick<Bill, "net" | "vat" | "vatTreatment">) => round2(bill.net + (bill.vatTreatment === "reverseCharge" ? 0 : bill.vat))

export function nextInvoiceNumber(books: Books) {
  const { prefix, nextNumber } = books.settings
  const taken = new Set(books.invoices.map((i) => i.number))
  let n = nextNumber
  while (taken.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}
export function nextCreditNumber(books: Books) {
  const { creditPrefix, nextCredit } = books.settings
  const taken = new Set(books.creditNotes.map((i) => i.number))
  let n = nextCredit
  while (taken.has(`${creditPrefix}${n}`)) n++
  return `${creditPrefix}${n}`
}

/* ---------------- actions (validated on the server) ---------------- */

export const booksActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), settings: settingsSchema }),
  z.object({ action: z.literal("party"), kind: z.enum(["client", "vendor"]), party: partySchema }),
  z.object({ action: z.literal("invoice"), invoice: invoiceSchema }),
  z.object({ action: z.literal("deleteInvoice"), id }),
  z.object({ action: z.literal("creditNote"), creditNote: creditNoteSchema }),
  z.object({ action: z.literal("deleteCreditNote"), id }),
  z.object({ action: z.literal("bill"), bill: billSchema }),
  z.object({ action: z.literal("deleteBill"), id }),
  z.object({ action: z.literal("payment"), payment: paymentSchema }),
  z.object({ action: z.literal("deletePayment"), id }),
  z.object({ action: z.literal("schedule"), schedule: scheduleSchema }),
  z.object({ action: z.literal("deleteSchedule"), id }),
  z.object({ action: z.literal("accrual"), accrual: accrualSchema }),
  z.object({ action: z.literal("deleteAccrual"), id }),
])
export type BooksAction = z.infer<typeof booksActionSchema>

const remember = (items: Item[], lines: Line[]) => {
  const out = [...items]
  for (const line of lines) {
    const name = line.item.trim()
    if (!name) continue
    const at = out.findIndex((i) => i.name.toLowerCase() === name.toLowerCase())
    const item = { name, description: line.description, rate: line.rate, vat: line.vat }
    if (at >= 0) out[at] = item
    else out.push(item)
  }
  return out.slice(-2000)
}

/** Applies one action; throws a message for the user when it cannot be done. */
export function applyBooksAction(books: Books, a: BooksAction): Books {
  const next: Books = structuredClone(books)
  const upsert = <T extends { id: string }>(list: T[], value: T) => {
    const at = list.findIndex((x) => x.id === value.id)
    if (at >= 0) list[at] = value
    else list.push(value)
  }
  switch (a.action) {
    case "settings":
      next.settings = a.settings
      break
    case "party": {
      const list = a.kind === "client" ? next.clients : next.vendors
      if (list.some((p) => p.id !== a.party.id && p.name.toLowerCase() === a.party.name.toLowerCase())) throw new Error(`${a.party.name} already exists.`)
      upsert(list, a.party)
      break
    }
    case "invoice": {
      if (!next.clients.some((c) => c.id === a.invoice.clientId)) throw new Error("Choose a client.")
      if (next.invoices.some((i) => i.id !== a.invoice.id && i.number === a.invoice.number)) throw new Error(`Invoice number ${a.invoice.number} is already used.`)
      const isNew = !next.invoices.some((i) => i.id === a.invoice.id)
      upsert(next.invoices, a.invoice)
      next.items = remember(next.items, a.invoice.lines)
      // Automatic numbering moves on past the number just used.
      const m = a.invoice.number.match(/(\d+)$/)
      if (isNew && m && a.invoice.number.startsWith(next.settings.prefix)) next.settings.nextNumber = Math.max(next.settings.nextNumber, Number(m[1]) + 1)
      break
    }
    case "deleteInvoice":
      if (next.payments.some((p) => p.kind === "invoice" && p.docId === a.id)) throw new Error("This invoice has payments. Remove them first.")
      if (next.creditNotes.some((c) => c.invoiceId === a.id)) throw new Error("This invoice has credit notes. Remove them first.")
      next.invoices = next.invoices.filter((i) => i.id !== a.id)
      break
    case "creditNote": {
      const invoice = next.invoices.find((i) => i.id === a.creditNote.invoiceId)
      if (!invoice) throw new Error("The invoice for this credit note was not found.")
      if (a.creditNote.date < invoice.date) throw new Error("A credit note cannot be dated before its invoice.")
      const credited = next.creditNotes.filter((c) => c.invoiceId === invoice.id && c.id !== a.creditNote.id).reduce((t, c) => t + documentTotals(c.lines).total, 0)
      if (documentTotals(a.creditNote.lines).total + credited > documentTotals(invoice.lines).total + 0.005) throw new Error("Credit notes cannot exceed the invoice total.")
      if (next.creditNotes.some((c) => c.id !== a.creditNote.id && c.number === a.creditNote.number)) throw new Error(`Credit note number ${a.creditNote.number} is already used.`)
      const isNew = !next.creditNotes.some((c) => c.id === a.creditNote.id)
      upsert(next.creditNotes, a.creditNote)
      const m = a.creditNote.number.match(/(\d+)$/)
      if (isNew && m && a.creditNote.number.startsWith(next.settings.creditPrefix)) next.settings.nextCredit = Math.max(next.settings.nextCredit, Number(m[1]) + 1)
      break
    }
    case "deleteCreditNote":
      next.creditNotes = next.creditNotes.filter((c) => c.id !== a.id)
      break
    case "bill": {
      if (!next.vendors.some((v) => v.id === a.bill.vendorId)) throw new Error("Choose a supplier.")
      upsert(next.bills, a.bill)
      // Paid in cash on the day: recorded as paid straight away.
      next.payments = next.payments.filter((p) => !(p.kind === "bill" && p.docId === a.bill.id && p.note === "Paid in cash with the bill"))
      if (a.bill.payment === "cash")
        next.payments.push({ id: `cash-${a.bill.id}`, kind: "bill", docId: a.bill.id, date: a.bill.date, amount: billTotal(a.bill), method: "cash", bankLine: null, note: "Paid in cash with the bill" })
      // The bill's own schedule follows the bill.
      next.schedules = next.schedules.filter((s) => !(s.source.type === "bill" && s.source.billId === a.bill.id))
      if (a.bill.treatment !== "expense" && a.bill.months)
        next.schedules.push({
          id: `bill-${a.bill.id}`,
          kind: a.bill.treatment === "asset" ? "depreciation" : "prepaid",
          label: `${a.bill.description || a.bill.ledgerName}${a.bill.number ? ` (bill ${a.bill.number})` : ""}`.slice(0, 160),
          ledgerName: a.bill.treatment === "asset" ? "Depreciation Expense" : a.bill.ledgerName,
          scheduleKey: a.bill.treatment === "asset" ? "depreciation" : a.bill.scheduleKey,
          amount: round2(a.bill.net),
          start: a.bill.date,
          months: a.bill.months,
          source: { type: "bill", billId: a.bill.id },
        })
      break
    }
    case "deleteBill":
      if (next.payments.some((p) => p.kind === "bill" && p.docId === a.id && p.method !== "cash")) throw new Error("This bill has payments. Remove them first.")
      next.bills = next.bills.filter((b) => b.id !== a.id)
      next.payments = next.payments.filter((p) => !(p.kind === "bill" && p.docId === a.id))
      next.schedules = next.schedules.filter((s) => !(s.source.type === "bill" && s.source.billId === a.id))
      break
    case "payment": {
      const doc = a.payment.kind === "invoice" ? next.invoices.find((i) => i.id === a.payment.docId) : next.bills.find((b) => b.id === a.payment.docId)
      if (!doc) throw new Error("The document for this payment was not found.")
      if (a.payment.bankLine && next.payments.some((p) => p.id !== a.payment.id && p.bankLine?.id === a.payment.bankLine!.id)) throw new Error("This statement line is already linked.")
      upsert(next.payments, a.payment)
      break
    }
    case "deletePayment":
      next.payments = next.payments.filter((p) => p.id !== a.id)
      break
    case "schedule":
      if (a.schedule.source.type === "bankLine" && next.schedules.some((s) => s.id !== a.schedule.id && s.source.type === "bankLine" && s.source.line.id === (a.schedule.source as { line: BankLineRef }).line.id))
        throw new Error("This statement line already has a schedule.")
      upsert(next.schedules, a.schedule)
      break
    case "deleteSchedule":
      next.schedules = next.schedules.filter((s) => s.id !== a.id)
      break
    case "accrual":
      upsert(next.accruals, a.accrual)
      break
    case "deleteAccrual":
      next.accruals = next.accruals.filter((x) => x.id !== a.id)
      break
  }
  next.revision = books.revision + 1
  return next
}
