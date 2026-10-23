"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { CalendarClock, Hourglass, Loader2, Plus, Trash2, Wrench } from "lucide-react"

import { CompanySwitch, Field, HeadPicker, Modal, SpreadChoice, aed, costHeads, shortDate, today, uid, useBooks } from "@/components/books-shared"
import { Loading, NoData } from "@/components/tax-workbench"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { round2, type Accrual, type Books, type BooksAction, type Schedule } from "@/lib/books"
import { instalments, scheduleEnd } from "@/lib/books-engine"
import { financialPeriod, type Company } from "@/lib/company"
import { cn } from "@/lib/utils"

type Change = (action: BooksAction) => Promise<Books>
type Period = { start: string; end: string }

function released(s: Schedule, upTo: string, from = "") {
  return round2(
    instalments(s.amount, s.start, s.months)
      .filter((p) => p.date <= upTo && p.date >= from)
      .reduce((t, p) => t + p.amount, 0),
  )
}

export function AdjustmentsWorkbench() {
  const { companies, company, companyId, setCompanyId, books, change, loading, error } = useBooks()
  const [year, setYear] = useState(new Date().getFullYear())
  const [adding, setAdding] = useState<"prepaid" | "depreciation" | "accrual" | null>(null)
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")

  const period = useMemo(() => financialPeriod(year, company?.ct.yearEndMonth ?? 12), [year, company])
  if (loading) return <Loading />
  if (!company) return <NoData title="No company yet" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i)
  const prepaid = books.schedules.filter((s) => s.kind === "prepaid")
  const assets = books.schedules.filter((s) => s.kind === "depreciation")
  const accruals = books.accruals
  const thisYear = (list: Schedule[]) => round2(list.reduce((t, s) => t + released(s, period.end, period.start), 0))
  const accrued = round2(accruals.filter((a) => a.date >= period.start && a.date <= period.end).reduce((t, a) => t + a.amount, 0))

  async function remove(action: BooksAction, label: string) {
    if (!window.confirm(`Remove ${label}? Its entries are taken out of every year.`)) return
    setBusy(label)
    setFailure("")
    try {
      await change(action)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not remove.")
    } finally {
      setBusy("")
    }
  }

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
        <div className="track" role="tablist" aria-label="Financial year">
          {years.map((y) => (
            <button key={y} role="tab" aria-selected={year === y} className="track-item" onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </div>
      {(error || failure) && <p className="note note-alert text-sm">{error || failure}</p>}
      <p className="note note-info text-sm">
        Adjusting entries post themselves to the trial balance and reports every month of their schedule. They are created when you spread a rent, insurance or licence payment, buy a fixed asset (in Bills or Data
        Input), or add one below. Year {year}: {shortDate(period.start)} – {shortDate(period.end)}.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary icon={CalendarClock} label={`Prepaid released in ${year} (${company.baseCurrency ?? "AED"})`} value={thisYear(prepaid)} />
        <Summary icon={Wrench} label={`Depreciation in ${year} (${company.baseCurrency ?? "AED"})`} value={thisYear(assets)} />
        <Summary icon={Hourglass} label={`Accrued in ${year} (${company.baseCurrency ?? "AED"})`} value={accrued} />
      </div>

      <Section
        title="Prepaid expenses"
        text="Licence, rent, insurance and other costs paid ahead, released to expense month by month."
        onAdd={() => setAdding("prepaid")}
        addLabel="Add prepaid expense"
        empty="Nothing is being spread yet. Choose “Spread” when you post a rent, insurance or licence bill, or map a bank line to one of them."
      >
        {prepaid.map((s) => (
          <ScheduleRow key={s.id} s={s} period={period} busy={busy === s.label} onRemove={s.source.type === "bill" ? undefined : () => remove({ action: "deleteSchedule", id: s.id }, s.label)} />
        ))}
      </Section>

      <Section
        title="Depreciation"
        text="Fixed assets written down monthly over their useful life (straight line)."
        onAdd={() => setAdding("depreciation")}
        addLabel="Add asset"
        empty="No assets yet. Assets bought through Bills, or bank lines mapped to Fixed Assets, are added here with their useful life."
      >
        {assets.map((s) => (
          <ScheduleRow key={s.id} s={s} period={period} busy={busy === s.label} onRemove={s.source.type === "bill" ? undefined : () => remove({ action: "deleteSchedule", id: s.id }, s.label)} />
        ))}
      </Section>

      <Section title="Accrued expenses" text="Costs of the period not yet billed or paid, such as salaries for the month. Reversed the next month when the actual cost is booked." onAdd={() => setAdding("accrual")} addLabel="Add accrual" empty="No accruals.">
        {accruals
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((a) => (
            <AccrualRow key={a.id} a={a} busy={busy === a.label} onRemove={() => remove({ action: "deleteAccrual", id: a.id }, a.label)} />
          ))}
      </Section>

      <MonthlyPostings books={books} period={period} />

      {adding && (
        <Modal title={adding === "prepaid" ? "Add prepaid expense" : adding === "depreciation" ? "Add an asset to depreciate" : "Add accrued expense"} onClose={() => setAdding(null)}>
          {adding === "accrual" ? <AccrualForm company={company} change={change} onDone={() => setAdding(null)} /> : <ScheduleForm kind={adding} company={company} change={change} onDone={() => setAdding(null)} />}
        </Modal>
      )}
    </div>
  )
}

function Summary({ icon: Icon, label, value }: { icon: typeof Wrench; label: string; value: number }) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--cobalt-wash)] text-[var(--cobalt)]">
        <Icon className="size-5" />
      </span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-lg font-semibold tabular-nums">{value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
      </div>
    </div>
  )
}

function Section({ title, text, children, onAdd, addLabel, empty }: { title: string; text: string; children: React.ReactNode[]; onAdd: () => void; addLabel: string; empty: string }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="size-4" /> {addLabel}
        </Button>
      </div>
      {children.length ? <ul className="divide-y">{children}</ul> : <p className="p-6 text-sm text-muted-foreground">{empty}</p>}
    </section>
  )
}

function ScheduleRow({ s, period, busy, onRemove }: { s: Schedule; period: Period; busy: boolean; onRemove?: () => void }) {
  const charge = released(s, period.end, period.start)
  const remaining = round2(s.amount - released(s, period.end))
  const done = Math.min(100, Math.round(((s.amount - remaining) / s.amount) * 100))
  const source = s.source.type === "bill" ? "From a bill" : s.source.type === "bankLine" ? `Bank line ${shortDate(s.source.line.date)}` : "Added here"
  return (
    <li className="grid gap-3 px-4 py-3 sm:grid-cols-[1.6fr_1fr_1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{s.label}</p>
        <p className="text-xs text-muted-foreground">
          {s.kind === "depreciation" ? "Depreciation Expense" : s.ledgerName} · {aed(s.amount)} over {s.months} months · {shortDate(s.start)} – {shortDate(scheduleEnd(s.start, s.months))} · {source}
        </p>
        <div className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-[var(--lagoon)]" style={{ width: `${done}%` }} />
        </div>
      </div>
      <p className="text-sm">
        <span className="block text-xs text-muted-foreground">This year</span>
        <span className="tabular-nums">{aed(charge)}</span>
      </p>
      <p className="text-sm">
        <span className="block text-xs text-muted-foreground">{s.kind === "depreciation" ? "Book value at year end" : "Prepaid at year end"}</span>
        <span className="tabular-nums">{aed(remaining)}</span>
      </p>
      <div className="flex justify-end">
        {onRemove ? (
          <Button size="icon" variant="ghost" aria-label={`Remove ${s.label}`} disabled={busy} onClick={onRemove}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </Button>
        ) : (
          <Link href="/bills" className="text-xs text-[var(--cobalt)] underline">
            Edit bill
          </Link>
        )}
      </div>
    </li>
  )
}

function AccrualRow({ a, busy, onRemove }: { a: Accrual; busy: boolean; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{a.label}</p>
        <p className="text-xs text-muted-foreground">
          {a.ledgerName} · {shortDate(a.date)}
          {a.reverse ? " · reversed the next month" : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{aed(a.amount)}</span>
        <Button size="icon" variant="ghost" aria-label={`Remove ${a.label}`} disabled={busy} onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  )
}

function MonthlyPostings({ books, period }: { books: Books; period: Period }) {
  const months: { key: string; label: string }[] = []
  const d = new Date(`${period.start}T00:00:00Z`)
  while (d.toISOString().slice(0, 10) <= period.end) {
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  const sumFor = (kind: Schedule["kind"], month: string) =>
    books.schedules
      .filter((s) => s.kind === kind)
      .flatMap((s) => instalments(s.amount, s.start, s.months))
      .filter((p) => p.date.startsWith(month))
      .reduce((t, p) => t + p.amount, 0)
  const accruedFor = (month: string) => books.accruals.filter((a) => a.date.startsWith(month)).reduce((t, a) => t + a.amount, 0)
  const rows = months.map((m) => ({ ...m, prepaid: sumFor("prepaid", m.key), depreciation: sumFor("depreciation", m.key), accrued: accruedFor(m.key) }))
  if (!rows.some((r) => r.prepaid || r.depreciation || r.accrued)) return null
  return (
    <section className="panel overflow-x-auto p-4">
      <h2 className="mb-3 font-display text-lg font-semibold">Posted each month</h2>
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2">Month</th>
            <th className="py-2 text-right">Prepaid released</th>
            <th className="py-2 text-right">Depreciation</th>
            <th className="py-2 text-right">Accrued</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn("border-b last:border-0", r.key === today().slice(0, 7) && "bg-[var(--cobalt-wash)]/50")}>
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums">{r.prepaid ? aed(r.prepaid) : "-"}</td>
              <td className="py-1.5 text-right tabular-nums">{r.depreciation ? aed(r.depreciation) : "-"}</td>
              <td className="py-1.5 text-right tabular-nums">{r.accrued ? aed(r.accrued) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function ScheduleForm({ kind, company, change, onDone }: { kind: "prepaid" | "depreciation"; company: Company; change: Change; onDone: () => void }) {
  const heads = costHeads(company.customHeads).filter((h) => h.group === "Expenses")
  const [label, setLabel] = useState("")
  const [head, setHead] = useState(kind === "prepaid" ? heads.find((h) => h.name === "Rent Expense") ?? null : null)
  const [amount, setAmount] = useState("")
  const [start, setStart] = useState(today().slice(0, 8) + "01")
  const [months, setMonths] = useState<number | null>(kind === "prepaid" ? 12 : 60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const value = Number(amount.replace(/,/g, "")) || 0
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!label.trim()) return setError("Describe it, for example “Office rent 2025-26”.")
        if (kind === "prepaid" && !head) return setError("Choose the expense head.")
        if (!(value > 0)) return setError("Enter the amount.")
        if (!months) return setError("Choose the period.")
        setSaving(true)
        setError("")
        try {
          await change({
            action: "schedule",
            schedule: {
              id: uid(),
              kind,
              label: label.trim(),
              ledgerName: kind === "prepaid" ? head!.name : "Depreciation Expense",
              scheduleKey: kind === "prepaid" ? head!.scheduleKey : "depreciation",
              amount: round2(value),
              start,
              months,
              source: { type: "manual" },
            },
          })
          onDone()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save.")
        } finally {
          setSaving(false)
        }
      }}
    >
      <p className="note note-info text-sm">
        {kind === "prepaid"
          ? "Use this when the payment is already in your figures as Prepaid Expense (typed in Data Input). Bayani releases it to the expense each month."
          : "Use this when the asset is already in your figures as Fixed Assets. Bayani posts the depreciation and the accumulated depreciation each month."}
      </p>
      <Field label="Description" required>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "prepaid" ? "Office rent 2025-26" : "Laptops"} />
      </Field>
      {kind === "prepaid" && (
        <Field label="Released to" required>
          <HeadPicker label="Expense head" value={head?.name ?? ""} options={heads} onChange={(o) => setHead(o)} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={kind === "prepaid" ? `Amount paid (${company.baseCurrency ?? "AED"})` : `Cost (${company.baseCurrency ?? "AED"})`} required>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={kind === "prepaid" ? "Covers from" : "In use from"} required>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
      </div>
      <Field label={kind === "prepaid" ? "Spread over" : "Useful life"}>
        <SpreadChoice kind={kind === "prepaid" ? "prepaid" : "asset"} months={months} onChange={setMonths} amount={value} />
      </Field>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />} Save schedule
        </Button>
      </div>
    </form>
  )
}

function AccrualForm({ company, change, onDone }: { company: Company; change: Change; onDone: () => void }) {
  const heads = costHeads(company.customHeads).filter((h) => h.group !== "Fixed assets")
  const [label, setLabel] = useState("")
  const [head, setHead] = useState(heads.find((h) => h.name === "Payroll Expense") ?? null)
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => {
    const d = new Date()
    return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10)
  })
  const [reverse, setReverse] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        const value = Number(amount.replace(/,/g, "")) || 0
        if (!label.trim()) return setError("Describe it, for example “December salaries”.")
        if (!head) return setError("Choose the expense head.")
        if (!(value > 0)) return setError("Enter the amount.")
        setSaving(true)
        setError("")
        try {
          await change({ action: "accrual", accrual: { id: uid(), label: label.trim(), ledgerName: head.name, scheduleKey: head.scheduleKey, amount: round2(value), date, reverse } })
          onDone()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save.")
        } finally {
          setSaving(false)
        }
      }}
    >
      <Field label="Description" required>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="December salaries" />
      </Field>
      <Field label="Expense head" required>
        <HeadPicker label="Expense head" value={head?.name ?? ""} options={heads} onChange={(o) => setHead(o)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Amount (${company.baseCurrency ?? "AED"})`} required>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Accrue at">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
        <span>Reverse it on the first day of the next month (usual: the actual payment is then booked as the expense).</span>
      </label>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />} Save accrual
        </Button>
      </div>
    </form>
  )
}
