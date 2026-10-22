"use client"

import { useState } from "react"
import { ArrowDownRight, ArrowUpRight, Building2, CalendarDays, FileBadge2, Landmark, Receipt, ScrollText, Users } from "lucide-react"

import { SnapView } from "@/components/snap-view"
import type { FinancialRecord } from "@/lib/financial-statements"
import type { EquityTable, ReportModel, Row, Schedule } from "@/lib/report-model"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "snap", label: "Snap view" },
  { key: "details", label: "Company details" },
  { key: "bs", label: "Financial position" },
  { key: "income", label: "Comprehensive income" },
  { key: "equity", label: "Changes in equity" },
  { key: "cashFlow", label: "Cash flows" },
  { key: "schedules", label: "Schedules" },
] as const
type Tab = (typeof TABS)[number]["key"]

const fmt = (value: number | null | undefined) => {
  if (value === null || value === undefined) return ""
  const rounded = Math.round(value)
  if (rounded === 0) return "–"
  const text = Math.abs(rounded).toLocaleString("en-US")
  return rounded < 0 ? `(${text})` : text
}

/**
 * On-screen statements: same figures as the downloaded report, laid out for reading on a
 * screen — change against last year, highlighted totals and schedules as cards.
 */
export function ReportView({ model, records }: { model: ReportModel; records: FinancialRecord[] }) {
  const [tab, setTab] = useState<Tab>("snap")
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Report sections" className="track">
        {TABS.map((item) => (
          <button key={item.key} role="tab" type="button" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className="track-item">
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "snap" && <SnapView model={model} records={records} />}
        {tab === "details" && <Details model={model} />}
        {tab === "bs" && <StatementCard model={model} title="Statement of financial position" subtitle={`As at ${model.periodEndText}`} rows={model.bs} />}
        {tab === "income" && <StatementCard model={model} title="Statement of comprehensive income" subtitle={`For the year ended ${model.periodEndText}`} rows={model.income} />}
        {tab === "equity" && (
          <section className="panel space-y-6 p-5 sm:p-7">
            <CardHeading model={model} title="Statement of changes in equity" subtitle={`For the year ended ${model.periodEndText}`} />
            {model.equity.map((table) => (
              <EquityView key={table.year} table={table} currency={model.currency} />
            ))}
          </section>
        )}
        {tab === "cashFlow" && <StatementCard model={model} title="Statement of cash flows" subtitle={`For the year ended ${model.periodEndText}`} rows={model.cashFlow} />}
        {tab === "schedules" && <Schedules model={model} />}
      </div>
    </div>
  )
}

function CardHeading({ model, title, subtitle }: { model: ReportModel; title: string; subtitle: string }) {
  return (
    <header className="flex flex-wrap items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {model.logo ? <img src={model.logo} alt="" className="max-h-11 max-w-28 rounded-lg object-contain" /> : null}
      <div className="flex-1">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {model.companyName} · {subtitle} · {model.currency}
        </p>
      </div>
    </header>
  )
}

function Change({ current, prior }: { current: number | null; prior: number | null }) {
  if (current === null || prior === null || Math.abs(prior) < 0.5) return <span className="text-xs text-muted-foreground">—</span>
  const change = (current - prior) / Math.abs(prior)
  if (Math.abs(change) < 0.0005) return <span className="text-xs text-muted-foreground">0%</span>
  const up = change > 0
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", up ? "bg-[var(--lagoon-wash)] text-[#0d7d73]" : "bg-[#fdecec] text-[#b42318]")}>
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(change * 100) >= 1000 ? ">999" : Math.abs(change * 100).toFixed(0)}%
    </span>
  )
}

function StatementCard({ model, title, subtitle, rows }: { model: ReportModel; title: string; subtitle: string; rows: Row[] }) {
  return (
    <section className="panel space-y-5 p-5 sm:p-7">
      <CardHeading model={model} title={title} subtitle={subtitle} />
      <StatementTable model={model} rows={rows} />
    </section>
  )
}

function StatementTable({ model, rows, compact = false }: { model: ReportModel; rows: Row[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm">
        {!compact && (
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="pb-2 text-left font-medium" />
              <th className="w-14 pb-2 text-center font-medium">Note</th>
              <th className="w-32 pb-2 text-right font-medium">
                <span className="rounded-md bg-[var(--ink)] px-2 py-1 text-white">{model.year}</span>
              </th>
              {model.priorYear && <th className="w-32 pb-2 text-right font-medium">{model.priorYear}</th>}
              {model.priorYear && <th className="w-20 pb-2 text-right font-medium">Change</th>}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => {
            if (row.kind === "spacer") return <tr key={i} aria-hidden><td className="h-2" /></tr>
            if (row.kind === "section")
              return (
                <tr key={i}>
                  <td colSpan={5} className="pt-4 pb-1">
                    <span className="font-display text-[15px] font-semibold text-[var(--cobalt)]">{sentence(row.label)}</span>
                  </td>
                </tr>
              )
            const heading = row.kind === "heading" && row.current === null
            if (heading)
              return (
                <tr key={i}>
                  <td colSpan={5} className="pt-3 pb-1 text-xs font-semibold text-muted-foreground">{sentence(row.label)}</td>
                </tr>
              )
            const total = row.kind === "total"
            const subtotal = row.kind === "subtotal" || row.kind === "heading"
            return (
              <tr key={i} className={cn(total && "font-semibold", subtotal && "font-semibold")}>
                <td className={cn("py-2 pr-3", total ? "rounded-l-xl bg-[var(--ink)] pl-3 text-white" : subtotal ? "border-t border-dashed" : "border-b border-border/60")}>{sentence(row.label)}</td>
                <td className={cn("text-center", total ? "bg-[var(--ink)]" : subtotal ? "border-t border-dashed" : "border-b border-border/60")}>
                  {row.note ? <span className={cn("inline-grid size-6 place-items-center rounded-full text-[11px] font-semibold", total ? "bg-white/15 text-white" : "bg-[var(--cobalt-wash)] text-[var(--cobalt)]")}>{row.note}</span> : null}
                </td>
                <td className={cn("py-2 text-right tabular-nums", total ? "bg-[var(--ink)] text-white" : subtotal ? "border-t border-dashed" : "border-b border-border/60", !model.priorYear && total && "rounded-r-xl pr-3", (row.current ?? 0) < 0 && !total && "text-[#b42318]")}>
                  {fmt(row.current)}
                </td>
                {model.priorYear && (
                  <td className={cn("py-2 text-right tabular-nums text-muted-foreground", total ? "bg-[var(--ink)] text-white/70" : subtotal ? "border-t border-dashed" : "border-b border-border/60")}>{fmt(row.prior)}</td>
                )}
                {model.priorYear && (
                  <td className={cn("py-2 text-right", total ? "rounded-r-xl bg-[var(--ink)] pr-3" : subtotal ? "border-t border-dashed" : "border-b border-border/60")}>
                    <Change current={row.current} prior={row.prior} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function sentence(label: string) {
  if (label !== label.toUpperCase()) return label
  const lower = label.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

const DETAIL_ICONS: Record<string, typeof Building2> = {
  "Company name": Building2,
  "Legal type": FileBadge2,
  "Licensing authority": Landmark,
  "License number": ScrollText,
  "License issue date": CalendarDays,
  "Business activity": ScrollText,
  Owners: Users,
  Manager: Users,
  "VAT registration": Receipt,
  "Corporate tax registration": Landmark,
}

function Details({ model }: { model: ReportModel }) {
  return (
    <section className="panel space-y-5 p-5 sm:p-7">
      <CardHeading model={model} title="Company details" subtitle={`Year ended ${model.periodEndText}`} />
      <dl className="grid gap-3 sm:grid-cols-2">
        {model.details.map((item) => {
          const Icon = DETAIL_ICONS[item.label] ?? Building2
          return (
            <div key={item.label} className={cn("flex gap-3 rounded-2xl border bg-secondary/40 p-4", ["Business activity", "Owners"].includes(item.label) && "sm:col-span-2")}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--cobalt-wash)] text-[var(--cobalt)]">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="mt-0.5 space-y-0.5 text-sm font-medium">
                  {item.lines.map((line, i) => (
                    <p key={i} className="break-words">{line}</p>
                  ))}
                </dd>
              </div>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function EquityView({ table, currency }: { table: EquityTable; currency: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="bg-secondary/60 text-xs text-muted-foreground">
            <th className="px-4 py-2.5 text-left font-semibold text-foreground">{table.year}</th>
            {table.columns.map((column) => (
              <th key={column} className="w-32 px-3 py-2.5 text-right font-medium">
                {column}
                <span className="block text-[10px]">{currency}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.lines.map((line, i) => (
            <tr key={i} className={cn("border-t", line.kind && "bg-[var(--ink)] font-semibold text-white")}>
              <td className="px-4 py-2.5">{line.label}</td>
              {line.values.map((value, j) => (
                <td key={j} className={cn("px-3 py-2.5 text-right tabular-nums", value < 0 && !line.kind && "text-[#b42318]")}>
                  {fmt(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Schedules({ model }: { model: ReportModel }) {
  return (
    <div className="space-y-4">
      <section className="panel p-5 sm:p-7">
        <CardHeading model={model} title="Schedules to the financial statements" subtitle={`For the year ended ${model.periodEndText}`} />
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        {model.schedules.map((schedule) => (
          <ScheduleCard key={schedule.number} schedule={schedule} model={model} />
        ))}
      </div>
    </div>
  )
}

function ScheduleCard({ schedule, model }: { schedule: Schedule; model: ReportModel }) {
  const total = schedule.rows?.at(-1)
  const empty = schedule.rows ? schedule.rows.every((row) => !row.current && !row.prior) : false
  return (
    <section className={cn("panel space-y-3 p-5", empty && "opacity-70")}>
      <header className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--cobalt)] to-[var(--lagoon)] font-display text-sm font-semibold text-white">{schedule.number}</span>
        <div className="flex-1">
          <h3 className="font-display font-semibold">{schedule.title}</h3>
          {total && !empty && (
            <p className="text-xs text-muted-foreground">
              {model.year}: {model.currency} {fmt(total.current)}
              {model.priorYear ? ` · ${model.priorYear}: ${fmt(total.prior)}` : ""}
            </p>
          )}
          {empty && <p className="text-xs text-muted-foreground">Nil in both years</p>}
        </div>
      </header>
      {schedule.paragraphs?.map((text, i) => (
        <p key={i} className="text-sm text-muted-foreground">
          {text}
        </p>
      ))}
      {schedule.table && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/60 text-xs text-muted-foreground">
                {schedule.table.head.map((cell, i) => (
                  <th key={i} className={cn("px-3 py-2 font-medium", schedule.table!.numeric.includes(i) ? "text-right" : "text-left")}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.table.body.map((cells, r) => (
                <tr key={r} className={cn("border-t", schedule.table!.totalLast && r === schedule.table!.body.length - 1 && "font-semibold")}>
                  {cells.map((cell, i) => (
                    <td key={i} className={cn("px-3 py-2", schedule.table!.numeric.includes(i) && "text-right tabular-nums")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {schedule.rows && !empty && <StatementTable model={model} rows={schedule.rows} compact />}
    </section>
  )
}
