import { lineTotals, round2, type Books } from "./books"
import type { BoxKey, VatFiling, VatPeriodSlot } from "./vat-filings"

/**
 * A VAT return prepared from what Bayani holds: invoices and credit notes, bills, and bank lines
 * the user marked as including VAT (receipts without an invoice, expenses without a bill, VAT
 * debited on its own line). Each item belongs to the period of its date unless the user moved it
 * to a later return or left it out for now; items left out are tracked until they are included.
 */
export type VatItem = {
  key: string
  date: string
  kind: "output" | "input"
  box: BoxKey
  source: "Invoice" | "Credit note" | "Bill" | "Bank line"
  description: string
  /** In the base currency. */
  net: number
  vat: number
  /** In AED (returns are filed in AED). */
  netAed: number
  vatAed: number
  /** True when the AED rate is missing on a document in another currency. */
  noAedRate?: boolean
}
export type BankVatItem = { id: string; date: string; description: string; kind: "output" | "input"; net: number; vat: number; netAed: number; vatAed: number }

const EMIRATE_BOX: Record<string, BoxKey> = { "Abu Dhabi": "1a", Dubai: "1b", Sharjah: "1c", Ajman: "1d", "Umm Al Quwain": "1e", "Ras Al Khaimah": "1f", Fujairah: "1g" }

export function vatItems(books: Books, bank: BankVatItem[], base: string, emirate: string): VatItem[] {
  const standardBox = EMIRATE_BOX[emirate] ?? "1b"
  const out: VatItem[] = []
  const aedPer = (doc: { currency?: string; rate?: number; aedRate?: number }) => {
    const c = doc.currency ?? base
    if (c === "AED") return 1
    if (doc.aedRate) return doc.aedRate
    if (base === "AED") return doc.rate ?? 1
    return 0
  }
  const add = (item: Omit<VatItem, "net" | "vat" | "netAed" | "vatAed" | "noAedRate"> & { aed: number; rate: number; docNet: number; docVat: number }) => {
    const { aed, rate, docNet, docVat, ...rest } = item
    out.push({ ...rest, net: round2(docNet * rate), vat: round2(docVat * rate), netAed: round2(docNet * aed), vatAed: round2(docVat * aed), noAedRate: aed === 0 || undefined })
  }
  for (const inv of books.invoices) {
    const client = books.clients.find((c) => c.id === inv.clientId)?.name ?? ""
    const groups = new Map<BoxKey, { net: number; vat: number }>()
    for (const line of inv.lines) {
      const box: BoxKey | null = line.vat === "standard" ? standardBox : line.vat === "zero" ? "4" : line.vat === "exempt" ? "5" : null
      if (!box) continue
      const t = lineTotals(line)
      const g = groups.get(box) ?? { net: 0, vat: 0 }
      g.net += t.net
      g.vat += t.vat
      groups.set(box, g)
    }
    for (const [box, g] of groups)
      add({ key: `inv:${inv.id}${box === standardBox ? "" : `:${box}`}`, date: inv.date, kind: "output", box, source: "Invoice", description: `${inv.number} · ${client}`, aed: aedPer(inv), rate: inv.rate ?? 1, docNet: g.net, docVat: g.vat })
  }
  for (const note of books.creditNotes) {
    const inv = books.invoices.find((i) => i.id === note.invoiceId)
    if (!inv) continue
    const groups = new Map<BoxKey, { net: number; vat: number }>()
    for (const line of note.lines) {
      const box: BoxKey | null = line.vat === "standard" ? standardBox : line.vat === "zero" ? "4" : line.vat === "exempt" ? "5" : null
      if (!box) continue
      const t = lineTotals(line)
      const g = groups.get(box) ?? { net: 0, vat: 0 }
      g.net -= t.net
      g.vat -= t.vat
      groups.set(box, g)
    }
    for (const [box, g] of groups)
      add({ key: `cn:${note.id}${box === standardBox ? "" : `:${box}`}`, date: note.date, kind: "output", box, source: "Credit note", description: `${note.number} against ${inv.number}`, aed: aedPer(inv), rate: inv.rate ?? 1, docNet: g.net, docVat: g.vat })
  }
  for (const bill of books.bills) {
    const vendor = books.vendors.find((v) => v.id === bill.vendorId)?.name ?? ""
    const description = `${bill.number || "Bill"} · ${vendor}`
    if (bill.vatTreatment === "standard" && bill.vat !== 0)
      add({ key: `bill:${bill.id}`, date: bill.date, kind: "input", box: "9", source: "Bill", description, aed: aedPer(bill), rate: bill.rate ?? 1, docNet: bill.net, docVat: bill.vat })
    if (bill.vatTreatment === "reverseCharge") {
      // Reverse charge: due as output tax (box 3) and recovered as input tax (box 10) in the same return.
      const v = bill.vat || round2(bill.net * 0.05)
      add({ key: `bill:${bill.id}:rc3`, date: bill.date, kind: "output", box: "3", source: "Bill", description: `${description} (reverse charge)`, aed: aedPer(bill), rate: bill.rate ?? 1, docNet: bill.net, docVat: v })
      add({ key: `bill:${bill.id}:rc10`, date: bill.date, kind: "input", box: "10", source: "Bill", description: `${description} (reverse charge)`, aed: aedPer(bill), rate: bill.rate ?? 1, docNet: bill.net, docVat: v })
    }
  }
  for (const b of bank)
    out.push({
      key: `bank:${b.id}`,
      date: b.date,
      kind: b.kind,
      box: b.kind === "output" ? standardBox : "9",
      source: "Bank line",
      description: b.description,
      net: b.net,
      vat: b.vat,
      netAed: b.netAed,
      vatAed: b.vatAed,
    })
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** The period an item is in: its own (by date), the one the user moved it to, or none. */
/** A document's parts (standard, zero-rated, reverse charge) move between returns together. */
export const docKey = (key: string) => (key.startsWith("bank:") ? key : key.split(":").slice(0, 2).join(":"))

export function periodOf(item: VatItem, assignments: Record<string, string>, periods: VatPeriodSlot[]) {
  const assigned = assignments[docKey(item.key)]
  if (assigned) return assigned
  return periods.find((p) => item.date >= p.start && item.date <= p.end)?.id ?? "none"
}

/** Box totals for a set of items, as a VAT 201 filing draft (AED). */
export function filingFrom(items: VatItem[], slot: VatPeriodSlot): VatFiling {
  const boxes: VatFiling["boxes"] = {}
  for (const item of items) {
    const cell = (boxes[item.box] ??= {})
    cell.amount = round2((cell.amount ?? 0) + item.netAed)
    if (!["4", "5"].includes(item.box)) cell.vat = round2((cell.vat ?? 0) + item.vatAed)
  }
  return { periodStart: slot.start, periodEnd: slot.end, source: "manual", profitMarginScheme: false, boxes }
}
