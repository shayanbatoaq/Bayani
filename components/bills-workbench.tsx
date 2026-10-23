"use client"

import { useRef, useState } from "react"
import { AlertTriangle, CreditCard, FilePlus2, FileText, Loader2, Paperclip, Pencil, Plus, Search, ShieldCheck, Sparkles, Trash2, Users } from "lucide-react"

import {
  CompanySwitch,
  DocumentCurrency,
  Field,
  HeadPicker,
  Modal,
  PartyForm,
  SPREADABLE,
  SpreadChoice,
  StatusPill,
  addDays,
  aed,
  costHeads,
  selectClass,
  shortDate,
  today,
  uid,
  useBooks,
} from "@/components/books-shared"
import { PaymentForm } from "@/components/invoices-workbench"
import { Loading, NoData } from "@/components/tax-workbench"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { VAT_TREATMENTS, billTotal, round2, type Bill, type Books, type BooksAction, type VatTreatment } from "@/lib/books"
import { billStatus, findParty } from "@/lib/books-engine"
import type { BillCheck, BillFields } from "@/lib/bill-rules"
import type { Company } from "@/lib/company"
import { pdfPageImages, readDocument, type ReadProgress } from "@/lib/document-reader"
import { cn } from "@/lib/utils"

type Change = (action: BooksAction) => Promise<Books>
type Attachment = NonNullable<Bill["attachment"]>
type Draft = { fields: BillFields; sources: Record<string, string>; attachment: Attachment | null; preview: string | null; ai: string; check: BillCheck }

const isOverdue = (books: Books, bill: Bill) => billStatus(books, bill).due > 0 && Boolean(bill.dueDate) && bill.dueDate < today()
const statusOf = (books: Books, bill: Bill) => (isOverdue(books, bill) ? "overdue" : billStatus(books, bill).status)
const PAYMENT_LABEL = { bank: "Bank", card: "Card", cash: "Cash", credit: "On credit" } as const

export function BillsWorkbench() {
  const { companies, company, companyId, setCompanyId, books, change, loading, error } = useBooks()
  const [tab, setTab] = useState<"bills" | "suppliers">("bills")
  const [editing, setEditing] = useState<{ bill: Bill | null; draft: Draft | null } | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [vendorFilter, setVendorFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [query, setQuery] = useState("")
  const [reading, setReading] = useState<string>("")
  const [readError, setReadError] = useState("")
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  if (loading) return <Loading />
  if (!company) return <NoData title="No company yet" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />

  async function read(file: File) {
    setReadError("")
    setReading("Reading the document…")
    try {
      if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type)) throw new Error("Upload a PDF or a photo (PNG, JPG or WEBP).")
      const form = new FormData()
      form.set("companyId", company!.id)
      form.set("file", file)
      const upload = fetch("/api/books/attachments", { method: "POST", body: form }).then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error)
        return d.attachment as Attachment
      })
      const text = await readDocument(file, (p: ReadProgress) => setReading(p.ocr ? `Reading the scan (page ${p.page} of ${p.pages})…` : `Reading page ${p.page} of ${p.pages}…`))
      // The pages themselves go with the text, so the AI reading sees the layout (tables, columns).
      const images = file.type.startsWith("image/") ? [await downscale(file)] : await pdfPageImages(file, 2).catch(() => [])
      setReading("Finding the supplier, amounts and VAT…")
      const response = await fetch("/api/books/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, images, ownTrn: company!.vat.trn || undefined, ownName: company!.name, heads: costHeads(company!.customHeads).map((h) => h.name) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      // The figures are still read when the document cannot be kept (too large, for example).
      const attachment = await upload.catch((cause) => {
        setReadError(`The document was read but not attached: ${cause instanceof Error ? cause.message : "it could not be saved"}`)
        return null
      })
      setEditing({ bill: null, draft: { fields: data.fields, sources: data.sources, attachment, preview: URL.createObjectURL(file), ai: data.ai, check: data.check } })
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : "The document could not be read.")
    } finally {
      setReading("")
    }
  }

  const base = company.baseCurrency ?? "AED"
  const year = String(new Date().getFullYear())
  const totals = books.bills.reduce(
    (t, b) => {
      const st = billStatus(books, b)
      const r = b.rate ?? 1
      if (b.date.startsWith(year)) t.billed += st.total * r
      if (b.date.startsWith(year)) t.paid += st.paid * r
      t.payable += st.due * r
      if (isOverdue(books, b)) t.overdue += st.due * r
      return t
    },
    { billed: 0, paid: 0, payable: 0, overdue: 0 },
  )
  const list = books.bills
    .filter((b) => !vendorFilter || b.vendorId === vendorFilter)
    .filter((b) => !statusFilter || statusOf(books, b) === statusFilter || (statusFilter === "open" && billStatus(books, b).due > 0))
    .filter((b) => !query || `${b.number} ${books.vendors.find((v) => v.id === b.vendorId)?.name} ${b.description} ${b.ledgerName}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date))
  const current = viewing ? books.bills.find((b) => b.id === viewing) : null

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Company</p>
            <p className="mt-1 text-lg font-semibold">{company.name}</p>
          </div>
          <CompanySwitch companies={companies} companyId={companyId} onChange={setCompanyId} />
        </div>
        <Button variant="outline" onClick={() => setEditing({ bill: null, draft: null })}>
          <FilePlus2 className="size-4" /> Enter a bill by hand
        </Button>
      </div>
      {error && <p className="note note-alert text-sm">{error}</p>}

      <button
        type="button"
        disabled={Boolean(reading)}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void read(file)
        }}
        className={cn("choice w-full", dragging && "choice-over")}
        style={{ minHeight: "9rem" }}
      >
        {reading ? <Loader2 className="size-7 animate-spin text-[var(--cobalt)]" /> : <Sparkles className="size-7 text-[var(--cobalt)]" />}
        <span className="font-medium">{reading || "Upload a bill, receipt or purchase invoice"}</span>
        <span className="text-xs text-muted-foreground">PDF or photo. Bayani reads the supplier, TRN, date, number, amounts, VAT and how it was paid; you check and complete the rest.</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="Bill document"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void read(file)
          e.target.value = ""
        }}
      />
      {readError && <p className="note note-alert text-sm">{readError}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile currency={base} label={`Bills in ${year}`} value={totals.billed} />
        <Tile currency={base} label={`Paid in ${year}`} value={totals.paid} />
        <Tile currency={base} label="Payable" value={totals.payable} />
        <Tile currency={base} label="Overdue" value={totals.overdue} alert={totals.overdue > 0} />
      </div>

      <div className="track" role="tablist" aria-label="Bills">
        {(
          [
            ["bills", "Bills"],
            ["suppliers", "Suppliers"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className="track-item" onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "bills" ? (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b p-4">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search supplier, number or expense" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search bills" />
            </div>
            <select aria-label="Supplier" className={cn(selectClass, "w-auto")} value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
              <option value="">All suppliers</option>
              {books.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select aria-label="Status" className={cn(selectClass, "w-auto")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Any status</option>
              <option value="open">Not fully paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Part paid</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          {list.length ? (
            <ul className="divide-y">
              {list.map((b) => {
                const st = billStatus(books, b)
                return (
                  <li key={b.id}>
                    <button type="button" className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-[var(--cobalt-wash)]/40 md:grid-cols-[7rem_1.4fr_1fr_8rem_8rem_6rem]" onClick={() => setViewing(b.id)}>
                      <span className="hidden text-sm md:block">{shortDate(b.date)}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{books.vendors.find((v) => v.id === b.vendorId)?.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <span className="md:hidden">{shortDate(b.date)} · </span>
                          {b.number || "No number"}
                          {b.attachment && <Paperclip className="ml-1 inline size-3" />}
                        </span>
                      </span>
                      <span className="hidden truncate text-sm text-muted-foreground md:block">
                        {b.ledgerName}
                        {b.treatment !== "expense" && b.months ? ` · ${b.months} m` : ""}
                      </span>
                      <span className="hidden text-right text-sm tabular-nums md:block">{aed(st.total)}</span>
                      <span className="text-right font-medium tabular-nums">
                        {aed(st.due)}
                        <span className="block md:hidden">
                          <StatusPill status={statusOf(books, b)} />
                        </span>
                      </span>
                      <span className="hidden md:block">
                        <StatusPill status={statusOf(books, b)} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="space-y-2 p-10 text-center">
              <FileText className="mx-auto size-8 text-muted-foreground" />
              <p className="font-medium">{books.bills.length ? "No bill matches these filters." : "No bills yet"}</p>
              {!books.bills.length && <p className="text-sm text-muted-foreground">Each bill books the expense, the VAT you can reclaim and what you owe the supplier.</p>}
            </div>
          )}
        </div>
      ) : (
        <Suppliers
          base={base}
          books={books}
          change={change}
          onShow={(id) => {
            setVendorFilter(id)
            setTab("bills")
          }}
        />
      )}

      {editing && (
        <Modal title={editing.bill ? `Edit bill ${editing.bill.number}` : editing.draft ? "Check the bill" : "New bill"} onClose={() => setEditing(null)} wide>
          <BillForm
            company={company}
            books={books}
            change={change}
            initial={editing.bill}
            draft={editing.draft}
            onDone={(id) => {
              setEditing(null)
              setViewing(id)
            }}
          />
        </Modal>
      )}
      {current && !editing && <BillView company={company} books={books} change={change} bill={current} onClose={() => setViewing(null)} onEdit={() => setEditing({ bill: current, draft: null })} />}
    </div>
  )
}

/** Photos are sent at a readable size, not the camera's full resolution. */
async function downscale(file: File) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.85)
}

function Tile({ label, value, alert, currency }: { label: string; value: number; alert?: boolean; currency: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-xl font-semibold tabular-nums", alert && "text-[#b42318]")}>
        {currency} {aed(value)}
      </p>
    </div>
  )
}

function BillForm({ company, books, change, initial, draft, onDone }: { company: Company; books: Books; change: Change; initial: Bill | null; draft: Draft | null; onDone: (id: string) => void }) {
  const f = draft?.fields ?? {}
  const heads = costHeads(company.customHeads)
  const knownVendor = f.supplier ? (books.vendors.find((v) => f.vendorTrn && v.trn === f.vendorTrn) ?? findParty(books.vendors, f.supplier)) : undefined
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? knownVendor?.id ?? "")
  const [addingVendor, setAddingVendor] = useState(!initial && !knownVendor && (Boolean(f.supplier) || !books.vendors.length))
  const initialHead = heads.find((h) => h.name === (initial?.ledgerName ?? f.ledgerName))
  const [head, setHead] = useState(initialHead ? { name: initialHead.name, scheduleKey: initialHead.scheduleKey } : f.ledgerName ? { name: f.ledgerName, scheduleKey: f.scheduleKey ?? "otherExpenses" } : null)
  const [date, setDate] = useState(initial?.date ?? f.date ?? today())
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "")
  const [number, setNumber] = useState(initial?.number ?? f.number ?? "")
  const [net, setNet] = useState(initial ? String(initial.net) : f.net !== undefined ? String(f.net) : "")
  const [treatmentVat, setTreatmentVat] = useState<VatTreatment>(initial?.vatTreatment ?? (f.vat === 0 && f.total ? "zero" : "standard"))
  const [vat, setVat] = useState(initial ? String(initial.vat) : f.vat !== undefined ? String(f.vat) : "")
  const [payment, setPayment] = useState<Bill["payment"]>(initial?.payment ?? f.payment ?? "bank")
  const [description, setDescription] = useState(initial?.description ?? f.description ?? "")
  const [months, setMonths] = useState<number | null>(initial?.months ?? null)
  const base = company.baseCurrency ?? "AED"
  const [fx, setFx] = useState<{ currency: string; rate: number; aedRate?: number }>({ currency: initial?.currency ?? f.currency ?? base, rate: initial?.rate ?? 1, aedRate: initial?.aedRate })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const attachment = initial?.attachment ?? draft?.attachment ?? null

  const netValue = Number(net.replace(/,/g, "")) || 0
  const vatValue = Number(vat.replace(/,/g, "")) || 0
  const total = billTotal({ net: netValue, vat: vatValue, vatTreatment: treatmentVat })
  const isAsset = head?.scheduleKey === "ppe"
  const spreadable = !isAsset && head && SPREADABLE.test(head.name)
  // Amounts that were not proven from the document, or that were changed from what it shows, are confirmed by the user.
  const changed = draft?.check.amounts === "proven" && (Math.abs((f.net ?? 0) - netValue) > 0.005 || Math.abs((f.vat ?? 0) - vatValue) > 0.005)
  const needsConfirm = Boolean(draft) && (draft!.check.amounts !== "proven" || changed)
  const missing = (key: keyof BillFields) => Boolean(draft) && draft!.fields[key] === undefined
  const from = (key: string) => draft?.sources[key]

  async function save() {
    setError("")
    if (!vendorId) return setError("Choose the supplier.")
    if (!head) return setError("Choose the expense type.")
    if (!(netValue > 0)) return setError("Enter the amount before VAT.")
    if (isAsset && !months) return setError("Choose the asset's useful life, so it can be depreciated.")
    if (fx.currency !== base && !(fx.rate > 0)) return setError(`Enter the rate from ${fx.currency} to ${base}.`)
    if (needsConfirm && !confirmed) return setError("Tick the box to confirm you checked the amounts against the document.")
    setSaving(true)
    try {
      const bill: Bill = {
        id: initial?.id ?? uid(),
        number: number.trim(),
        date,
        dueDate,
        vendorId,
        ledgerName: head.name,
        scheduleKey: head.scheduleKey,
        net: round2(netValue),
        vat: round2(vatValue),
        vatTreatment: treatmentVat,
        payment,
        description,
        attachment,
        treatment: isAsset ? "asset" : months ? "prepaid" : "expense",
        months: isAsset || months ? months : null,
        createdAt: initial?.createdAt ?? new Date().toISOString(),
        currency: fx.currency,
        rate: fx.currency === base ? 1 : fx.rate,
        aedRate: fx.currency === "AED" ? undefined : (fx.aedRate ?? (base === "AED" ? fx.rate : undefined)),
      }
      await change({ action: "bill", bill })
      onDone(bill.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.")
    } finally {
      setSaving(false)
    }
  }

  const tag = (key: string) =>
    from(key) ? (
      <span className="ml-1 rounded bg-[var(--lagoon-wash)] px-1.5 py-0.5 text-[10px] font-semibold text-[#0b6b62]">{from(key) === "AI" ? "read by AI" : "read"}</span>
    ) : missing(key as keyof BillFields) ? (
      <span className="ml-1 rounded bg-[var(--saffron-wash)] px-1.5 py-0.5 text-[10px] font-semibold text-[#6b4500]">not found, enter it</span>
    ) : null

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0 space-y-4">
        {draft && (
          <div className={cn("note text-sm", draft.check.amounts === "proven" ? "note-good" : "note-warning")}>
            {draft.check.amounts === "proven" ? <ShieldCheck className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            <div className="space-y-1">
              <p>
                {draft.check.amounts === "proven"
                  ? `Amounts checked: ${aed(f.net ?? 0)} before VAT + ${aed(f.vat ?? 0)} VAT = ${aed(f.total ?? 0)}, as printed on the bill.`
                  : "Check the amounts against the document before posting."}{" "}
                Read {Object.keys(draft.sources).length} details{draft.ai === "used" ? " (document rules and AI, compared)" : " (document rules)"}; fill in anything marked “not found”.
              </p>
              {draft.check.notes.map((n) => (
                <p key={n} className="text-xs opacity-90">
                  {n}
                </p>
              ))}
            </div>
          </div>
        )}
        {addingVendor ? (
          <div className="rounded-xl border p-4">
            {books.vendors.length > 0 && (
              <div className="mb-4 space-y-1.5">
                <p className="text-[13px] font-medium">Choose a supplier already on your list</p>
                <select
                  aria-label="Existing supplier"
                  className={selectClass}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return
                    setVendorId(e.target.value)
                    setAddingVendor(false)
                  }}
                >
                  <option value="">Choose…</option>
                  {books.vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <p className="pt-2 text-xs text-muted-foreground">or add a new supplier:</p>
              </div>
            )}
            <p className="mb-3 font-medium">New supplier {tag("supplier")}</p>
            <PartyForm
              kind="vendor"
              initial={{ name: f.supplier ?? "", trn: f.vendorTrn ?? "", address: f.address ?? "" }}
              onCancel={() => setAddingVendor(false)}
              onSave={async (party) => {
                // Already on the list: use it rather than adding it twice.
                const known = findParty(books.vendors, party.name)
                if (known) {
                  setVendorId(known.id)
                  setAddingVendor(false)
                  return
                }
                await change({ action: "party", kind: "vendor", party })
                setVendorId(party.id)
                setAddingVendor(false)
              }}
            />
          </div>
        ) : (
          <Field label="Supplier" required>
            <select className={selectClass} value={vendorId} onChange={(e) => (e.target.value === "__new" ? setAddingVendor(true) : setVendorId(e.target.value))}>
              <option value="">Choose a supplier</option>
              {books.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.trn ? ` · TRN ${v.trn}` : ""}
                </option>
              ))}
              <option value="__new">+ New supplier…</option>
            </select>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Expense type" required>
            <HeadPicker
              label="Expense type"
              value={head?.name ?? ""}
              options={heads}
              onChange={(o) => {
                setHead({ name: o.name, scheduleKey: o.scheduleKey })
                setMonths(null)
              }}
            />
          </Field>
          <Field label="Bill / invoice number">
            <Input value={number} onChange={(e) => setNumber(e.target.value)} className={cn(missing("number") && "border-amber-400")} />
          </Field>
        </div>
        {spreadable && (
          <div className="rounded-xl border border-[var(--cobalt)]/30 bg-[var(--cobalt-wash)]/40 p-3">
            <p className="mb-2 text-sm font-medium">{head.name} is often paid for a period ahead. Expense it in full, or spread it over the months it covers?</p>
            <SpreadChoice kind="prepaid" months={months} onChange={setMonths} amount={netValue} />
          </div>
        )}
        {isAsset && (
          <div className="rounded-xl border border-[var(--cobalt)]/30 bg-[var(--cobalt-wash)]/40 p-3">
            <p className="mb-2 text-sm font-medium">A fixed asset is depreciated over its useful life. How long will it be used?</p>
            <SpreadChoice kind="asset" months={months} onChange={setMonths} amount={netValue} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Bill date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Paid from">
            <select className={selectClass} value={payment} onChange={(e) => setPayment(e.target.value as Bill["payment"])}>
              <option value="bank">Bank</option>
              <option value="card">Card</option>
              <option value="cash">Cash (paid now)</option>
              <option value="credit">Not paid yet (on credit)</option>
            </select>
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} placeholder={addDays(date, 30)} />
          </Field>
        </div>
        <DocumentCurrency base={base} value={fx} date={date} onChange={setFx} label={draft?.fields.currency ? `Currency (read: ${draft.fields.currency})` : "Bill currency"} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={`Amount before VAT (${fx.currency})`} required>
            <Input
              inputMode="decimal"
              value={net}
              className={cn(missing("net") && "border-amber-400")}
              onChange={(e) => {
                setNet(e.target.value)
                const n = Number(e.target.value.replace(/,/g, "")) || 0
                if (treatmentVat === "standard" || treatmentVat === "reverseCharge") setVat(String(round2(n * 0.05)))
              }}
            />
          </Field>
          <Field label="VAT treatment">
            <select
              className={selectClass}
              value={treatmentVat}
              onChange={(e) => {
                const t = e.target.value as VatTreatment
                setTreatmentVat(t)
                setVat(t === "standard" || t === "reverseCharge" ? String(round2(netValue * 0.05)) : "0")
              }}
            >
              {VAT_TREATMENTS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="VAT">
            <Input inputMode="decimal" value={vat} className={cn(missing("vat") && "border-amber-400")} onChange={(e) => setVat(e.target.value)} disabled={treatmentVat === "zero" || treatmentVat === "exempt" || treatmentVat === "outOfScope"} />
          </Field>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Amount with VAT</p>
            <p className="pt-2 font-semibold tabular-nums">
              {fx.currency} {aed(total)}
            </p>
            {fx.currency !== base && <p className="text-xs text-muted-foreground">= {base} {aed(total * fx.rate)}</p>}
            {f.total !== undefined && Math.abs(f.total - total) > 0.05 && <p className="text-xs text-[#b42318]">Document total {aed(f.total)}</p>}
          </div>
        </div>
        {treatmentVat === "reverseCharge" && <p className="text-xs text-muted-foreground">Reverse charge: you account for the 5% VAT yourself and reclaim it in the same return, so the supplier is paid the amount before VAT.</p>}
        {!company.vat.trn && vatValue > 0 && <p className="text-xs text-muted-foreground">Your company has no VAT TRN, so this VAT cannot be reclaimed; consider including it in the expense.</p>}
        <Field label="Details">
          <textarea className="min-h-16 w-full rounded-md border px-3 py-2 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {needsConfirm && (
          <label className="flex items-start gap-2 rounded-xl border border-[var(--saffron)] bg-[var(--saffron-wash)] p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{changed ? "The amounts differ from what Bayani read on the document. " : ""}I have checked the amount before VAT, the VAT and the total against the document.</span>
          </label>
        )}
        {error && <p className="text-sm text-[#b42318]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={() => void save()} disabled={saving || addingVendor}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {initial ? "Save changes" : "Post bill"}
          </Button>
        </div>
      </div>
      <aside className="space-y-2">
        {draft?.preview && attachment ? (
          attachment.type === "application/pdf" ? (
            <iframe title="Bill document" src={draft.preview} className="h-[28rem] w-full rounded-xl border" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.preview} alt="Bill document" className="max-h-[28rem] w-full rounded-xl border object-contain" />
          )
        ) : attachment ? (
          <a className="flex items-center gap-2 rounded-xl border p-3 text-sm text-[var(--cobalt)] underline" href={`/api/books/attachments?companyId=${company.id}&id=${attachment.id}&name=${encodeURIComponent(attachment.name)}`} target="_blank" rel="noreferrer">
            <Paperclip className="size-4" /> {attachment.name}
          </a>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">No document attached. Upload the bill on the Bills page to keep it with the entry.</p>
        )}
        {draft && (
          <div className="rounded-xl border p-3 text-xs">
            <p className="mb-1 font-semibold">Read from the document</p>
            {(["supplier", "vendorTrn", "date", "number", "net", "vat", "total", "payment", "description"] as const).map((key) => (
              <p key={key} className="flex justify-between gap-2 border-b py-1 last:border-0">
                <span className="text-muted-foreground">{{ supplier: "Supplier", vendorTrn: "TRN", date: "Date", number: "Number", net: "Before VAT", vat: "VAT", total: "Total", payment: "Paid by", description: "Details" }[key]}</span>
                <span className="truncate text-right">{f[key] === undefined ? <span className="text-[#6b4500]">not found</span> : typeof f[key] === "number" ? aed(f[key] as number) : String(f[key])}</span>
              </p>
            ))}
          </div>
        )}
      </aside>
    </div>
  )
}

function BillView({ company, books, change, bill, onClose, onEdit }: { company: Company; books: Books; change: Change; bill: Bill; onClose: () => void; onEdit: () => void }) {
  const st = billStatus(books, bill)
  const vendor = books.vendors.find((v) => v.id === bill.vendorId)
  const payments = books.payments.filter((p) => p.kind === "bill" && p.docId === bill.id)
  const schedule = books.schedules.find((s) => s.source.type === "bill" && s.source.billId === bill.id)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState("")
  return (
    <Modal title={`Bill ${bill.number || ""}`.trim()} onClose={onClose} wide>
      {paying ? (
        <PaymentForm
          due={st.due}
          after={bill.date}
          onCancel={() => setPaying(false)}
          onSave={async (payment) => {
            await change({ action: "payment", payment: { ...payment, kind: "bill", docId: bill.id } })
            setPaying(false)
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{vendor?.name}</p>
              <p className="text-sm text-muted-foreground">
                {shortDate(bill.date)} · {bill.ledgerName} · {PAYMENT_LABEL[bill.payment]}
              </p>
              {vendor?.trn && <p className="text-xs text-muted-foreground">TRN {vendor.trn}</p>}
            </div>
            <div className="text-right">
              <StatusPill status={statusOf(books, bill)} />
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {bill.currency ?? company.baseCurrency ?? "AED"} {aed(st.due)}
              </p>
              <p className="text-xs text-muted-foreground">due of {aed(st.total)}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-xl border p-3 text-sm">
            <p>
              <span className="block text-xs text-muted-foreground">Before VAT</span>
              {aed(bill.net)}
            </p>
            <p>
              <span className="block text-xs text-muted-foreground">VAT ({VAT_TREATMENTS.find((t) => t.key === bill.vatTreatment)?.label})</span>
              {aed(bill.vat)}
            </p>
            <p>
              <span className="block text-xs text-muted-foreground">Total</span>
              {aed(st.total)}
            </p>
          </div>
          {bill.description && <p className="text-sm">{bill.description}</p>}
          {schedule && (
            <p className="note note-info text-sm">
              {schedule.kind === "depreciation" ? "Depreciated" : "Expensed"} over {schedule.months} months from {shortDate(schedule.start)}: {company.baseCurrency ?? "AED"} {aed(schedule.amount / schedule.months)} a month, posted automatically. See Adjustments.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {bill.attachment && (
              <Button asChild size="sm" variant="outline">
                <a href={`/api/books/attachments?companyId=${company.id}&id=${bill.attachment.id}&name=${encodeURIComponent(bill.attachment.name)}`} target="_blank" rel="noreferrer">
                  <Paperclip className="size-4" /> Document
                </a>
              </Button>
            )}
            {st.due > 0 && (
              <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
                <CreditCard className="size-4" /> Record payment
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[#b42318]"
              onClick={async () => {
                if (!window.confirm("Delete this bill and its document? The expense, VAT and payable are removed from your reports.")) return
                try {
                  await change({ action: "deleteBill", id: bill.id })
                  onClose()
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Could not delete.")
                }
              }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
          {error && <p className="note note-alert text-sm">{error}</p>}
          {payments.length > 0 && (
            <ul className="divide-y rounded-xl border text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {shortDate(p.date)} · {p.method === "bankLine" ? `Bank statement: ${p.bankLine?.description.slice(0, 60)}` : p.note || PAYMENT_LABEL[p.method as "bank"]}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">{aed(p.amount)}</span>
                    {!p.id.startsWith("cash-") && (
                      <Button size="icon" variant="ghost" aria-label="Remove payment" onClick={() => change({ action: "deletePayment", id: p.id }).catch((c) => setError(c.message))}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {st.due > 0 && <p className="text-xs text-muted-foreground">When you upload bank statements in Data Input, a payment of this amount or naming this supplier is offered as a match.</p>}
        </div>
      )}
    </Modal>
  )
}

function Suppliers({ books, change, onShow, base }: { books: Books; change: Change; onShow: (id: string) => void; base: string }) {
  const [editing, setEditing] = useState<string | null>(null)
  const rows = books.vendors
    .map((v) => {
      const mine = books.bills.filter((b) => b.vendorId === v.id)
      const t = mine.reduce((s, b) => {
        const st = billStatus(books, b)
        const r = b.rate ?? 1
        return { billed: s.billed + st.total * r, paid: s.paid + st.paid * r, due: s.due + st.due * r }
      }, { billed: 0, paid: 0, due: 0 })
      return { v, count: mine.length, ...t }
    })
    .sort((a, b) => b.due - a.due || a.v.name.localeCompare(b.v.name))
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b p-4">
        <p className="flex items-center gap-2 font-semibold">
          <Users className="size-4" /> Suppliers and balances
        </p>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add supplier
        </Button>
      </div>
      {rows.length ? (
        <ul className="divide-y">
          {rows.map(({ v, count, billed, paid, due }) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{v.name}</p>
                <p className="text-xs text-muted-foreground">
                  {v.trn ? `TRN ${v.trn} · ` : ""}
                  {count} bill{count === 1 ? "" : "s"} · billed {aed(billed)} · paid {aed(paid)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("font-semibold tabular-nums", due > 0 && "text-[var(--cobalt)]")}>{base} {aed(due)}</span>
                <Button size="sm" variant="outline" onClick={() => onShow(v.id)}>
                  Bills
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Edit ${v.name}`} onClick={() => setEditing(v.id)}>
                  <Pencil className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-8 text-center text-sm text-muted-foreground">Suppliers are added once, from their first bill.</p>
      )}
      {editing && (
        <Modal title={editing === "new" ? "Add supplier" : "Edit supplier"} onClose={() => setEditing(null)}>
          <PartyForm
            kind="vendor"
            initial={books.vendors.find((v) => v.id === editing)}
            onCancel={() => setEditing(null)}
            onSave={async (party) => {
              await change({ action: "party", kind: "vendor", party })
              setEditing(null)
            }}
          />
        </Modal>
      )}
    </div>
  )
}

