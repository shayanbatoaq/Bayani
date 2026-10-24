import { billTotal, documentTotals, round2, type Books, type BooksAction } from "./books"
import type { Company } from "./company"
import type { FinancialInput, FinancialRecord } from "./financial-statements"

/**
 * The activity log: every change saved in Bayani, when it was made and what it changed.
 * Entries are only ever added: the database stamps their time and refuses edits and deletions.
 */
export const ACTIVITY_AREAS = ["company", "figures", "statements", "invoices", "bills", "adjustments", "vat", "tax", "audit"] as const
export type ActivityArea = (typeof ACTIVITY_AREAS)[number]
export const AREA_LABELS: Record<ActivityArea, string> = {
  company: "Company",
  figures: "Trial balance",
  statements: "Bank statements",
  invoices: "Invoices",
  bills: "Bills",
  adjustments: "Adjustments",
  vat: "VAT",
  tax: "Corporate tax",
  audit: "Audit",
}

export type ActivityChange = { label: string; before?: string; after?: string }
export type ActivityEntry = {
  id: string
  at: string
  area: ActivityArea
  companyId: string
  companyName: string
  year?: number
  summary: string
  changes: ActivityChange[]
}
export type ActivityDraft = Omit<ActivityEntry, "id" | "at">

/** At most this many changes are kept per entry; the summary says how many there were. */
export const MAX_CHANGES = 60

const amount = (n: number, currency = "") => `${currency ? `${currency} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const cap = (changes: ActivityChange[]) =>
  changes.length > MAX_CHANGES ? [...changes.slice(0, MAX_CHANGES), { label: `… and ${changes.length - MAX_CHANGES} more` }] : changes

/* ---------------- trial balance ---------------- */

type Row = FinancialInput["rows"][number]
const totalsByHead = (rows: Row[]) => {
  const out = new Map<string, number>()
  for (const row of rows) {
    if (row.id.startsWith("books-")) continue
    const key = row.ledgerName.trim() || "(no name)"
    out.set(key, round2((out.get(key) ?? 0) + row.amount))
  }
  return out
}

/** The heads whose amounts changed between two saves of a year (debits positive, credits negative). */
export function diffRows(before: Row[], after: Row[], currency: string): ActivityChange[] {
  const a = totalsByHead(before)
  const b = totalsByHead(after)
  const changes: ActivityChange[] = []
  for (const [head, value] of b) {
    const old = a.get(head)
    if (old === undefined) changes.push({ label: head, after: amount(value, currency) })
    else if (round2(old - value) !== 0) changes.push({ label: head, before: amount(old, currency), after: amount(value, currency) })
  }
  for (const [head, value] of a) if (!b.has(head)) changes.push({ label: head, before: amount(value, currency) })
  return changes
}

export function describeRecord(before: FinancialRecord | null, after: FinancialInput): ActivityDraft | null {
  const changes = diffRows(before?.rows ?? [], after.rows, after.currency)
  if ((before?.entryMode ?? "closing") !== (after.entryMode ?? "closing"))
    changes.unshift({ label: "Entry mode", before: before ? (before.entryMode ?? "closing") : undefined, after: after.entryMode ?? "closing" })
  const eq = (o: FinancialInput["openingEquity"]) => (o ? `capital ${amount(o.capital)}, retained ${amount(o.retained)}` : "none")
  if (before && eq(before.openingEquity) !== eq(after.openingEquity)) changes.push({ label: "Opening equity", before: eq(before.openingEquity), after: eq(after.openingEquity) })
  // A save that changed nothing (another year re-saved alongside) is not a change.
  if (before && !changes.length) return null
  const summary = !before
    ? `Trial balance for ${after.year} saved (${plural(after.rows.filter((r) => !r.id.startsWith("books-")).length, "head")})`
    : `Trial balance for ${after.year} changed: ${plural(changes.length, "item")}`
  return { area: "figures", companyId: after.clientId, companyName: after.clientName, year: after.year, summary, changes: cap(changes) }
}

/* ---------------- company ---------------- */

const COMPANY_FIELDS: [string, (c: Company) => string][] = [
  ["Name", (c) => c.name],
  ["Legal form", (c) => c.legalForm],
  ["Licensing authority", (c) => c.authority],
  ["Emirate", (c) => c.emirate],
  ["Licence number", (c) => c.licenseNumber],
  ["Business activity", (c) => c.businessActivity],
  ["Manager", (c) => c.manager],
  ["Base currency", (c) => c.baseCurrency ?? "AED"],
  ["VAT TRN", (c) => c.vat.trn],
  ["VAT effective date", (c) => c.vat.effectiveDate],
  ["VAT filing", (c) => c.vat.frequency],
  ["Corporate tax TRN", (c) => c.ct.trn],
  ["Financial year end month", (c) => String(c.ct.yearEndMonth ?? 12)],
  ["Partners", (c) => c.partners.map((p) => `${p.name} ${p.sharePercent}%`).join(", ")],
]

export function describeCompany(before: Company | null, after: Company): ActivityDraft {
  if (!before) return { area: "company", companyId: after.id, companyName: after.name, summary: `Company ${after.name} added (base currency ${after.baseCurrency ?? "AED"})`, changes: [] }
  const changes: ActivityChange[] = []
  for (const [label, get] of COMPANY_FIELDS) {
    const a = String(get(before) ?? "")
    const b = String(get(after) ?? "")
    if (a !== b) changes.push({ label, before: a || "(blank)", after: b || "(blank)" })
  }
  const added = after.documents.length - before.documents.length
  if (added > 0) changes.push({ label: "Documents", after: `${plural(added, "document")} added` })
  return { area: "company", companyId: after.id, companyName: after.name, summary: changes.length ? `Company details changed: ${plural(changes.length, "item")}` : "Company details saved with no change", changes }
}

type Extras = Partial<Pick<Company, "customHeads" | "vatOverrides" | "ctAnswers" | "vatFilings" | "vatSettings" | "logo" | "bankRules">>
const count = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0)
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Changes to the company's working data; null when nothing worth logging changed. */
export function describeExtras(before: Company, patch: Extras): ActivityDraft | null {
  const base = { companyId: before.id, companyName: before.name }
  const keys = (Object.keys(patch) as (keyof Extras)[]).filter((k) => !same(before[k], patch[k]))
  if (!keys.length) return null
  if (keys.includes("vatFilings")) {
    const a = (before.vatFilings ?? {}) as Record<string, unknown>
    const b = (patch.vatFilings ?? {}) as Record<string, unknown>
    const added = Object.keys(b).filter((k) => !(k in a))
    const removed = Object.keys(a).filter((k) => !(k in b))
    const changed = Object.keys(b).filter((k) => k in a && !same(a[k], b[k]))
    const changes = [...added.map((k) => ({ label: k, after: "return added" })), ...changed.map((k) => ({ label: k, after: "return changed" })), ...removed.map((k) => ({ label: k, before: "return removed" }))]
    return { ...base, area: "vat", summary: `VAT returns updated: ${changes.map((c) => c.label).join(", ") || "no period"}`, changes }
  }
  if (keys.includes("vatOverrides") || keys.includes("vatSettings")) return { ...base, area: "vat", summary: "VAT settings or figures changed", changes: keyChanges(before, patch, ["vatOverrides", "vatSettings"]) }
  if (keys.includes("ctAnswers")) return { ...base, area: "tax", summary: "Corporate tax answers changed", changes: keyChanges(before, patch, ["ctAnswers"]) }
  if (keys.includes("logo")) return { ...base, area: "company", summary: patch.logo ? "Company logo uploaded" : "Company logo removed", changes: [] }
  if (keys.includes("customHeads")) return { ...base, area: "figures", summary: `Custom ledger heads: ${count(before.customHeads)} → ${count(patch.customHeads)}`, changes: [] }
  if (keys.includes("bankRules")) {
    const a = new Set((before.bankRules ?? []).map((r) => JSON.stringify(r)))
    const added = (patch.bankRules ?? []).filter((r) => !a.has(JSON.stringify(r)))
    if (!added.length) return null
    return { ...base, area: "statements", summary: `Bank mapping remembered: ${plural(added.length, "rule")}`, changes: cap(added.map((r) => ({ label: r.pattern, after: [r.category, r.vat ? `VAT ${r.vat}` : "", r.party ? `party ${r.party}` : ""].filter(Boolean).join(", ") }))) }
  }
  return null
}

function keyChanges(before: Company, patch: Extras, keys: (keyof Extras)[]): ActivityChange[] {
  const out: ActivityChange[] = []
  for (const key of keys) {
    if (!(key in patch)) continue
    const a = (before[key] ?? {}) as Record<string, unknown>
    const b = (patch[key] ?? {}) as Record<string, unknown>
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (same(a[k], b[k])) continue
      const show = (v: unknown) => (v === undefined ? undefined : typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v))
      out.push({ label: k, before: show(a[k]), after: show(b[k]) })
    }
  }
  return cap(out)
}

/* ---------------- books ---------------- */

const partyName = (books: Books, kind: "client" | "vendor", id: string) => (kind === "client" ? books.clients : books.vendors).find((p) => p.id === id)?.name ?? "unknown"

export function describeBooks(company: Pick<Company, "id" | "name" | "baseCurrency">, before: Books, after: Books, action: BooksAction): ActivityDraft | null {
  const base = { companyId: company.id, companyName: company.name }
  const cur = (c?: string) => c ?? company.baseCurrency ?? "AED"
  switch (action.action) {
    case "settings":
      return { ...base, area: "invoices", summary: "Invoice settings changed", changes: settingChanges(before, after) }
    case "party": {
      const list = action.kind === "client" ? before.clients : before.vendors
      const old = list.find((p) => p.id === action.party.id)
      const who = action.kind === "client" ? "Client" : "Supplier"
      return { ...base, area: action.kind === "client" ? "invoices" : "bills", summary: `${who} ${action.party.name} ${old ? "updated" : "added"}`, changes: old ? fieldChanges(old, action.party, ["name", "trn", "address", "email", "phone"]) : [] }
    }
    case "invoice": {
      const old = before.invoices.find((i) => i.id === action.invoice.id)
      const inv = action.invoice
      const total = documentTotals(inv.lines).total
      const summary = `Invoice ${inv.number} ${old ? "edited" : "created"}: ${partyName(after, "client", inv.clientId)}, ${amount(total, cur(inv.currency))}, dated ${inv.date}`
      const changes: ActivityChange[] = []
      if (old) {
        const oldTotal = documentTotals(old.lines).total
        if (oldTotal !== total || old.currency !== inv.currency) changes.push({ label: "Total", before: amount(oldTotal, cur(old.currency)), after: amount(total, cur(inv.currency)) })
        changes.push(...fieldChanges(old, inv, ["number", "date", "dueDate", "rate"]))
        if (old.clientId !== inv.clientId) changes.push({ label: "Client", before: partyName(before, "client", old.clientId), after: partyName(after, "client", inv.clientId) })
      }
      return { ...base, area: "invoices", year: Number(inv.date.slice(0, 4)), summary, changes }
    }
    case "deleteInvoice": {
      const old = before.invoices.find((i) => i.id === action.id)
      if (!old) return null
      return { ...base, area: "invoices", year: Number(old.date.slice(0, 4)), summary: `Invoice ${old.number} deleted (${partyName(before, "client", old.clientId)}, ${amount(documentTotals(old.lines).total, cur(old.currency))})`, changes: [] }
    }
    case "creditNote": {
      const cn = action.creditNote
      const old = before.creditNotes.find((c) => c.id === cn.id)
      const inv = after.invoices.find((i) => i.id === cn.invoiceId)
      return { ...base, area: "invoices", year: Number(cn.date.slice(0, 4)), summary: `Credit note ${cn.number} ${old ? "edited" : "issued"} against ${inv?.number ?? "an invoice"}: ${amount(documentTotals(cn.lines).total, cur(inv?.currency))}`, changes: [] }
    }
    case "deleteCreditNote": {
      const old = before.creditNotes.find((c) => c.id === action.id)
      return old ? { ...base, area: "invoices", year: Number(old.date.slice(0, 4)), summary: `Credit note ${old.number} deleted (${amount(documentTotals(old.lines).total)})`, changes: [] } : null
    }
    case "bill": {
      const bill = action.bill
      const old = before.bills.find((b) => b.id === bill.id)
      const label = bill.number ? `Bill ${bill.number}` : "Bill"
      const summary = `${label} ${old ? "edited" : "recorded"}: ${partyName(after, "vendor", bill.vendorId)}, ${amount(billTotal(bill), cur(bill.currency))} (VAT ${amount(bill.vat)}), ${bill.ledgerName}`
      const changes = old
        ? [
            ...fieldChanges(old, bill, ["number", "date", "net", "vat", "vatTreatment", "ledgerName", "currency", "rate", "treatment", "months"]),
            ...(old.vendorId !== bill.vendorId ? [{ label: "Supplier", before: partyName(before, "vendor", old.vendorId), after: partyName(after, "vendor", bill.vendorId) }] : []),
          ]
        : []
      return { ...base, area: "bills", year: Number(bill.date.slice(0, 4)), summary, changes }
    }
    case "deleteBill": {
      const old = before.bills.find((b) => b.id === action.id)
      return old ? { ...base, area: "bills", year: Number(old.date.slice(0, 4)), summary: `Bill ${old.number || ""} deleted (${partyName(before, "vendor", old.vendorId)}, ${amount(billTotal(old), cur(old.currency))})`.replace("Bill  ", "Bill "), changes: [] } : null
    }
    case "payment": {
      const p = action.payment
      const old = before.payments.find((x) => x.id === p.id)
      const doc = p.kind === "invoice" ? after.invoices.find((i) => i.id === p.docId) : after.bills.find((b) => b.id === p.docId)
      const docName = p.kind === "invoice" ? `invoice ${doc?.number ?? ""}` : `bill ${doc?.number || partyName(after, "vendor", (doc as { vendorId?: string })?.vendorId ?? "")}`
      const how = p.method === "bankLine" ? "matched to a bank line" : p.method
      return {
        ...base,
        area: p.kind === "invoice" ? "invoices" : "bills",
        year: Number(p.date.slice(0, 4)),
        summary: `${p.kind === "invoice" ? "Receipt" : "Payment"} of ${amount(p.amount, cur(doc?.currency))} ${old ? "edited" : "recorded"} for ${docName.trim()} (${how}, ${p.date})`,
        changes: old ? fieldChanges(old, p, ["amount", "date", "method", "baseAmount"]) : [],
      }
    }
    case "deletePayment": {
      const old = before.payments.find((x) => x.id === action.id)
      return old ? { ...base, area: old.kind === "invoice" ? "invoices" : "bills", year: Number(old.date.slice(0, 4)), summary: `${old.kind === "invoice" ? "Receipt" : "Payment"} of ${amount(old.amount)} on ${old.date} removed`, changes: [] } : null
    }
    case "schedule": {
      const s = action.schedule
      const old = before.schedules.find((x) => x.id === s.id)
      const kind = s.kind === "prepaid" ? "Prepaid expense" : "Depreciation"
      return { ...base, area: "adjustments", year: Number(s.start.slice(0, 4)), summary: `${kind} ${s.label} ${old ? "edited" : "set up"}: ${amount(s.amount, cur())} over ${plural(s.months, "month")} from ${s.start}`, changes: old ? fieldChanges(old, s, ["label", "amount", "start", "months", "ledgerName"]) : [] }
    }
    case "deleteSchedule": {
      const old = before.schedules.find((x) => x.id === action.id)
      return old ? { ...base, area: "adjustments", summary: `${old.kind === "prepaid" ? "Prepaid expense" : "Depreciation"} ${old.label} removed (${amount(old.amount, cur())})`, changes: [] } : null
    }
    case "accrual": {
      const a = action.accrual
      const old = before.accruals.find((x) => x.id === a.id)
      return { ...base, area: "adjustments", year: Number(a.date.slice(0, 4)), summary: `Accrual ${a.label} ${old ? "edited" : "added"}: ${amount(a.amount, cur())} on ${a.date}`, changes: old ? fieldChanges(old, a, ["label", "amount", "date", "ledgerName", "reverse"]) : [] }
    }
    case "deleteAccrual": {
      const old = before.accruals.find((x) => x.id === action.id)
      return old ? { ...base, area: "adjustments", summary: `Accrual ${old.label} removed (${amount(old.amount, cur())})`, changes: [] } : null
    }
    case "vatAssign": {
      const where = action.period === null ? "their own VAT period" : action.period === "none" ? "no VAT return (left out)" : `VAT return ${action.period}`
      return { ...base, area: "vat", summary: `${plural(action.keys.length, "item")} moved to ${where}`, changes: cap(action.keys.map((k) => ({ label: k, before: before.vatAssignments[k] ?? "own period", after: action.period ?? "own period" }))) }
    }
  }
}

function fieldChanges<T extends object>(a: T, b: T, keys: (keyof T)[]): ActivityChange[] {
  const out: ActivityChange[] = []
  for (const key of keys) {
    const x = a[key]
    const y = b[key]
    if (same(x, y)) continue
    const show = (v: unknown) => (v === undefined || v === null || v === "" ? "(blank)" : typeof v === "number" ? (Number.isInteger(v) && Math.abs(v) < 1000 ? String(v) : amount(v)) : String(v))
    out.push({ label: String(key), before: show(x), after: show(y) })
  }
  return out
}

function settingChanges(before: Books, after: Books): ActivityChange[] {
  const a = before.settings as Record<string, unknown>
  const b = after.settings as Record<string, unknown>
  return Object.keys(b)
    .filter((k) => !same(a[k], b[k]))
    .map((k) => ({ label: k, before: typeof a[k] === "object" ? "changed" : String(a[k] ?? ""), after: typeof b[k] === "object" ? "changed" : String(b[k] ?? "") }))
}

/* ---------------- bank statements ---------------- */

type SessionLike = { files: { id: string; name: string; accounts: { transactions: unknown[] }[] }[]; appliedAt: string | null }

/** Statement files added or removed; null for routine saves (categories chosen as the user works). */
export function describeBankSession(company: { id: string; name: string }, year: number, before: SessionLike | null, after: SessionLike | null): ActivityDraft | null {
  const base = { area: "statements" as const, companyId: company.id, companyName: company.name, year }
  if (!after) return before?.files.length ? { ...base, summary: `Bank statements for ${year} cleared (${plural(before.files.length, "file")})`, changes: before.files.map((f) => ({ label: f.name, before: "removed" })) } : null
  const had = new Set((before?.files ?? []).map((f) => f.id))
  const has = new Set(after.files.map((f) => f.id))
  const lines = (f: SessionLike["files"][number]) => f.accounts.reduce((t, a) => t + a.transactions.length, 0)
  const added = after.files.filter((f) => !had.has(f.id))
  const removed = (before?.files ?? []).filter((f) => !has.has(f.id))
  if (!added.length && !removed.length) return null
  const changes = [...added.map((f) => ({ label: f.name, after: `uploaded, ${plural(lines(f), "line")}` })), ...removed.map((f) => ({ label: f.name, before: "removed" }))]
  const parts = [added.length ? `${plural(added.length, "file")} uploaded` : "", removed.length ? `${plural(removed.length, "file")} removed` : ""].filter(Boolean)
  return { ...base, summary: `Bank statements for ${year}: ${parts.join(", ")}`, changes }
}
