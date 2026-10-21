"use client"

import { useState } from "react"
import type { EquityTable, ReportModel, Row, Schedule } from "@/lib/report-model"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "details", label: "Company details" },
  { key: "bs", label: "Financial position" },
  { key: "income", label: "Comprehensive income" },
  { key: "equity", label: "Changes in equity" },
  { key: "cashFlow", label: "Cash flows" },
  { key: "schedules", label: "Schedules" },
] as const
type Tab = (typeof TABS)[number]["key"]

/** Whole currency units, negatives in brackets, nil as a dash; same as the PDF. */
const fmt = (value: number | null | undefined) => {
  if (value === null || value === undefined) return ""
  const rounded = Math.round(value)
  if (rounded === 0) return "-"
  const text = Math.abs(rounded).toLocaleString("en-US")
  return rounded < 0 ? `(${text})` : text
}

export function ReportView({ model }: { model: ReportModel }) {
  const [tab, setTab] = useState<Tab>("bs")
  const ended = `for the year ended ${model.periodEndText}`
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Statements" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={cn(
              "-mb-px shrink-0 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              tab === item.key && "border-primary text-foreground"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <article
        role="tabpanel"
        className="overflow-x-auto rounded-sm border bg-white px-5 py-8 text-[13.5px] leading-snug text-black shadow-md sm:px-12 sm:py-12"
        style={{ fontFamily: "Cambria, Caladea, Georgia, 'Times New Roman', serif" }}
      >
        <div className="min-w-[38rem]">
          {tab === "details" && (
            <>
              <Heading model={model} title="Company details" />
              <dl className="border-t-[3px] border-black">
                {model.details.map((item) => (
                  <div key={item.label} className="grid grid-cols-[13rem_1fr] gap-4 border-b border-neutral-300 py-2.5">
                    <dt className="font-bold">{item.label}</dt>
                    <dd>
                      {item.lines.map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {tab === "bs" && (
            <>
              <Heading model={model} title={`Statement of financial position as at ${model.periodEndText}`} />
              <Statement model={model} rows={model.bs} />
            </>
          )}
          {tab === "income" && (
            <>
              <Heading model={model} title={`Statement of comprehensive income ${ended}`} />
              <Statement model={model} rows={model.income} />
            </>
          )}
          {tab === "equity" && (
            <>
              <Heading model={model} title={`Statement of changes in equity ${ended}`} />
              {model.equity.map((table) => (
                <Equity key={table.year} table={table} currency={model.currency} />
              ))}
            </>
          )}
          {tab === "cashFlow" && (
            <>
              <Heading model={model} title={`Statement of cash flows ${ended}`} />
              <Statement model={model} rows={model.cashFlow} />
            </>
          )}
          {tab === "schedules" && (
            <>
              <Heading model={model} title={`Schedules to the financial statements ${ended}`} />
              <Statement model={model} rows={[]} withNote={false} />
              {model.schedules.map((schedule) => (
                <ScheduleView key={schedule.number} schedule={schedule} model={model} />
              ))}
            </>
          )}
        </div>
      </article>
    </div>
  )
}

function Heading({ model, title }: { model: ReportModel; title: string }) {
  return (
    <header className="mb-5">
      <p className="font-bold">{model.companyName}</p>
      <p className="font-bold uppercase">{title}</p>
    </header>
  )
}

function YearHead({ model, withNote }: { model: ReportModel; withNote: boolean }) {
  const years = [model.year, ...(model.priorYear ? [model.priorYear] : [])]
  return (
    <thead>
      <tr className="align-bottom">
        <th className="border-b-[3px] border-black" />
        <th className="w-14 border-b-[3px] border-black pb-1 text-center font-bold">{withNote ? "Note" : ""}</th>
        {years.map((year) => (
          <th key={year} className="w-32 pl-2">
            <span className="block bg-black py-1.5 text-center font-bold text-white">{year}</span>
          </th>
        ))}
      </tr>
      <tr>
        <th />
        <th />
        {years.map((year) => (
          <th key={year} className="pl-2 pt-1 pb-2 text-center font-bold">
            {model.currency}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function Amount({ value, kind }: { value: number | null; kind?: Row["kind"] }) {
  return (
    <td className="w-32 pl-2 align-bottom">
      <span
        className={cn(
          "block pr-1 text-right tabular-nums",
          kind === "subtotal" && "border-y border-dashed border-black font-bold",
          kind === "total" && "border-t border-b-[3px] border-double border-black font-bold"
        )}
      >
        {fmt(value)}
      </span>
    </td>
  )
}

function Statement({ model, rows, withNote = true, indent = false }: { model: ReportModel; rows: Row[]; withNote?: boolean; indent?: boolean }) {
  return (
    <table className="w-full border-collapse">
      {!indent && <YearHead model={model} withNote={withNote} />}
      <tbody>
        {rows.map((row, i) => {
          if (row.kind === "spacer")
            return (
              <tr key={i} aria-hidden>
                <td className="h-2" colSpan={4} />
              </tr>
            )
          const showAmounts = row.kind !== "section" && !(row.kind === "heading" && row.current === null)
          return (
            <tr key={i} className={cn(row.kind && "font-bold")}>
              <td className={cn("py-[3px] pr-3", indent && "pl-8", (row.kind === "section" || row.kind === "heading") && "pt-3")}>
                <span className={cn("block", row.kind === "total" && "border-y border-black")}>{row.label}</span>
              </td>
              <td className={cn("text-center", indent ? "w-14" : "")}>{withNote && row.note ? row.note : ""}</td>
              {showAmounts ? (
                <>
                  <Amount value={row.current} kind={row.kind} />
                  {model.priorYear && <Amount value={row.prior} kind={row.kind} />}
                </>
              ) : (
                <>
                  <td className={indent ? "w-32" : ""} />
                  {model.priorYear && <td className={indent ? "w-32" : ""} />}
                </>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ScheduleView({ schedule, model }: { schedule: Schedule; model: ReportModel }) {
  return (
    <section className="mt-5">
      <h3 className="flex gap-4 font-bold">
        <span className="w-4">{schedule.number}</span>
        {schedule.title}
      </h3>
      {schedule.paragraphs?.map((text, i) => (
        <p key={i} className="mt-1 pl-8">
          {text}
        </p>
      ))}
      {schedule.table && (
        <table className="mt-2 ml-8 w-[calc(100%-2rem)] border-collapse">
          <thead>
            <tr className="border-b border-black">
              {schedule.table.head.map((cell, i) => (
                <th key={i} className={cn("py-1 font-bold", schedule.table!.numeric.includes(i) ? "text-right" : "text-left")}>
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedule.table.body.map((cells, r) => {
              const total = schedule.table!.totalLast && r === schedule.table!.body.length - 1
              return (
                <tr key={r} className={cn(total && "border-y border-black font-bold")}>
                  {cells.map((cell, i) => (
                    <td key={i} className={cn("py-1", schedule.table!.numeric.includes(i) && "text-right tabular-nums")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {schedule.rows && <Statement model={model} rows={schedule.rows} withNote={false} indent />}
    </section>
  )
}

function Equity({ table, currency }: { table: EquityTable; currency: string }) {
  return (
    <table className="mb-8 w-full border-collapse">
      <thead>
        <tr className="align-bottom">
          <th />
          {table.columns.map((column) => (
            <th key={column} className="w-28 px-1 text-center font-bold">
              {column}
            </th>
          ))}
        </tr>
        <tr className="border-b border-black">
          <th className="py-1 text-left font-bold">{table.year}</th>
          {table.columns.map((column) => (
            <th key={column} className="py-1 text-center font-bold">
              {currency}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.lines.map((line, i) => (
          <tr key={i} className={cn(line.kind && "font-bold")}>
            <td className="py-2 pr-3">{line.label}</td>
            {line.values.map((value, j) => (
              <td key={j} className="pl-2">
                <span className={cn("block text-right tabular-nums", line.kind && "border-t border-b-[3px] border-double border-black")}>{fmt(value)}</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
