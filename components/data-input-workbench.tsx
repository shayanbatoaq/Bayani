"use client"

import { useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  PenLine,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { categoryOf, scheduleLines, type ScheduleKey } from "@/lib/financial-statements"
import {
  parseImportSheet,
  readTrialBalance,
  type ImportSheet,
} from "@/lib/import-trial-balance"
import {
  choiceLabel,
  choicesFor,
  interpretImport,
  ledgerHeads,
  resolveSchedule,
  toPlain,
  toSigned,
  type CustomHead,
  type Side,
} from "@/lib/ledger-heads"
import { createLedgerRow, formatAmount, parseAmount, type LedgerRow } from "@/lib/trial-balance"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 25
const NEW_HEAD = "__new__"

/** Report lines grouped by statement category, for the "Reported under" pickers. */
const lineGroups = (() => {
  const groups = new Map<string, { key: ScheduleKey; label: string }[]>()
  for (const line of scheduleLines) {
    const info = categoryOf(line.key)!
    const name = `${info.statement === "BS" ? "Balance sheet" : "Profit & loss"} · ${info.category}`
    const label =
      line.key === "taxReceivable"
        ? "VAT / duties receivable"
        : line.key === "taxPayable"
          ? "VAT / duties payable"
          : line.key === "shareholder"
            ? "Shareholders' current account"
            : line.key === "endOfService"
              ? "Employees' end of service benefits"
              : line.label
    groups.set(name, [...(groups.get(name) ?? []), { key: line.key, label }])
  }
  return [...groups.entries()]
})()

export function ReportLineSelect({
  value,
  onChange,
  id,
  label,
  className,
}: {
  value: string
  onChange: (key: string) => void
  id?: string
  label: string
  className?: string
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-9 w-full rounded-md border bg-white px-2 text-sm",
        !value && "border-amber-500 bg-amber-50",
        className
      )}
    >
      <option value="">Select where to report</option>
      {lineGroups.map(([group, lines]) => (
        <optgroup key={group} label={group}>
          {lines.map((line) => (
            <option key={line.key} value={line.key}>
              {line.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function DataInputWorkbench({
  rows,
  onRowsChange,
  customHeads,
  onAddCustomHead,
  entryMode = "closing",
}: {
  rows: LedgerRow[]
  onRowsChange: (rows: LedgerRow[]) => void
  customHeads: CustomHead[]
  onAddCustomHead: (head: CustomHead) => Promise<void>
  /** In movement entry, depreciation is paired with accumulated depreciation automatically. */
  entryMode?: "closing" | "movement"
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const amountInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<"upload" | "manual" | null>(rows.length ? null : null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [importMode, setImportMode] = useState<"replace" | "append">("replace")
  const [sheets, setSheets] = useState<ImportSheet[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [pendingFilename, setPendingFilename] = useState("")
  const [page, setPage] = useState(1)
  const [onlyUnmapped, setOnlyUnmapped] = useState(false)
  // manual entry
  const [head, setHead] = useState("")
  const [amount, setAmount] = useState("")
  const [choice, setChoice] = useState<Side | 0>(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newHead, setNewHead] = useState({ name: "", scheduleKey: "" })
  const [savingHead, setSavingHead] = useState(false)

  const parsedAmount = parseAmount(amount)
  // Signed amounts net to zero when the figures balance.
  const difference = rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100
  const headChoices = head && head !== NEW_HEAD ? choicesFor(head) : null
  const unmapped = rows.filter((row) => !row.scheduleKey).length
  const filtered = onlyUnmapped ? rows.filter((row) => !row.scheduleKey) : rows
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const headOptions = useMemo(() => {
    const standard = new Set(ledgerHeads.map((h) => h.name.toLowerCase()))
    return {
      bs: ledgerHeads.filter((h) => h.statement === "BS"),
      pl: ledgerHeads.filter((h) => h.statement === "P&L"),
      custom: customHeads.filter((h) => !standard.has(h.name.toLowerCase())),
    }
  }, [customHeads])

  function withSchedule(entry: { ledgerName: string; amount: number }): LedgerRow {
    return { ...createLedgerRow(entry), scheduleKey: resolveSchedule(entry.ledgerName, entry.amount, customHeads) }
  }

  function commitImport(sheet: ImportSheet, filename: string) {
    const parsed = parseImportSheet(sheet)
    // The template lists every head; blank or zero amounts are not balances.
    const entries = parsed.entries.filter((entry) => Math.round(entry.amount * 100) !== 0)
    const interpreted = interpretImport(entries, customHeads)
    const imported = interpreted.rows.map((entry) => ({ ...createLedgerRow(entry), scheduleKey: entry.scheduleKey }))
    onRowsChange(importMode === "append" ? [...rows, ...imported] : imported)
    const zero = parsed.entries.length - entries.length
    const resolved = interpreted.rows
      .filter((row) => interpreted.resolved.includes(row.ledgerName))
      .map((row) => `${row.ledgerName}: “${choiceLabel(row.ledgerName, row.amount)}”`)
    setNotice(
      `${imported.length} balances imported from ${filename}.${zero + parsed.skipped ? ` ${zero + parsed.skipped} heads left blank were ignored.` : ""}${resolved.length ? ` Set so your figures balance: ${resolved.join(", ")}. Change it under Type if that is wrong.` : ""}`
    )
    setSheets([])
    setError("")
    setPage(1)
    setMode(null)
  }

  async function handleFile(file: File) {
    if (busy) return
    setBusy(true)
    setError("")
    setNotice("")
    setSheets([])
    try {
      const loaded = await readTrialBalance(file)
      if (!loaded.length) throw new Error("This workbook has no worksheets.")
      if (loaded.length > 1) {
        setSheets(loaded)
        setSheetIndex(0)
        setPendingFilename(file.name)
      } else commitImport(loaded[0], file.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not read this file. Use the template.")
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  function addManual(event: React.FormEvent) {
    event.preventDefault()
    if (!head || head === NEW_HEAD || parsedAmount === null || parsedAmount === 0) return
    if (headChoices && !choice) return
    const usualKey = resolveSchedule(head, 1, customHeads)
    const signed = toSigned(head, parsedAmount, usualKey, customHeads, choice || undefined)
    if (editingId) {
      onRowsChange(
        rows.map((row) =>
          row.id === editingId
            ? {
                ...row,
                ledgerName: head,
                amount: signed,
                scheduleKey:
                  row.ledgerName === head && !/vat control/i.test(head)
                    ? row.scheduleKey
                    : resolveSchedule(head, signed, customHeads),
              }
            : row
        )
      )
      setNotice(`${head} updated.`)
    } else {
      const added = withSchedule({ ledgerName: head, amount: signed })
      const next = [...rows, added]
      let paired = ""
      if (entryMode === "movement" && added.scheduleKey === "depreciation") {
        // The charge reduces the assets' book value: credit accumulated depreciation by the same amount.
        const at = next.findIndex((row) => row.scheduleKey === "ppe" && /depreciation|allowance|accumulated/i.test(row.ledgerName))
        if (at >= 0) next[at] = { ...next[at], amount: Math.round((next[at].amount - signed) * 100) / 100 }
        else next.push({ ...createLedgerRow({ ledgerName: "Allowance for Depreciation", amount: -signed }), scheduleKey: "ppe" })
        paired = ` Accumulated depreciation (Allowance for Depreciation) increased by AED ${formatAmount(Math.abs(signed))} to match.`
      }
      onRowsChange(next)
      setNotice(`${head} added.${paired}`)
      setPage(Math.ceil((filtered.length + 1) / PAGE_SIZE))
    }
    setEditingId(null)
    setAmount("")
    setHead("")
    setChoice(0)
  }

  async function saveNewHead() {
    const name = newHead.name.trim()
    if (name.length < 2 || !newHead.scheduleKey) return
    setSavingHead(true)
    try {
      await onAddCustomHead({ name, scheduleKey: newHead.scheduleKey })
      setHead(name)
      setNewHead({ name: "", scheduleKey: "" })
      requestAnimationFrame(() => amountInput.current?.focus())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the head.")
    } finally {
      setSavingHead(false)
    }
  }

  function editRow(row: LedgerRow) {
    setMode("manual")
    setEditingId(row.id)
    setHead(row.ledgerName)
    setAmount(String(toPlain(row.ledgerName, row.amount, row.scheduleKey ?? "", customHeads)))
    setChoice(choicesFor(row.ledgerName) ? (Math.sign(row.amount) as Side) : 0)
    requestAnimationFrame(() => amountInput.current?.scrollIntoView({ behavior: "smooth", block: "center" }))
  }

  const knownHead =
    head && head !== NEW_HEAD
      ? ledgerHeads.some((h) => h.name === head) || customHeads.some((h) => h.name === head)
      : true

  return (
    <div className="space-y-7">
      <div className="grid gap-4 sm:grid-cols-2" aria-label="Trial balance entry method">
        {(
          [
            { value: "upload", title: "Upload template", subtitle: "Fill the trial balance template and upload it (XLSX or CSV)", icon: UploadCloud, tone: "bg-emerald-50 text-emerald-800" },
            { value: "manual", title: "Enter manually", subtitle: "Pick each head from the list and enter its balance", icon: PenLine, tone: "bg-amber-50 text-amber-800" },
          ] as const
        ).map(({ value, title, subtitle, icon: Icon, tone }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            disabled={busy}
            onClick={() => {
              setMode(mode === value ? null : value)
              setError("")
            }}
            className={cn(
              "flex min-h-28 items-center gap-5 rounded-xl border bg-white p-5 text-left shadow-sm transition-[border-color,box-shadow] hover:border-primary/60 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary",
              mode === value && "border-emerald-700 ring-1 ring-emerald-700"
            )}
          >
            <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-lg", tone)}>
              <Icon className="size-6" strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold">{title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{subtitle}</span>
            </span>
            {mode === value ? <CheckCircle2 className="size-5 text-emerald-700" /> : <ArrowRight className="size-5 text-muted-foreground" />}
          </button>
        ))}
      </div>

      {mode === "upload" && (
        <section aria-label="Upload trial balance template" className="space-y-4 rounded-xl border bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Enter every amount as a positive number and leave heads you don&apos;t use blank. FinScope
              works out how each one is reported.
            </p>
            <Button asChild variant="outline" size="sm">
              <a href="/templates/trial-balance-template.xlsx" download="Trial Balance Template.xlsx">
                <ArrowDownToLine className="size-4" />
                Download template
              </a>
            </Button>
          </div>
          {rows.length > 0 && (
            <fieldset disabled={busy} className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <legend className="mb-2 font-medium">This year already has {rows.length} balances</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="import-mode" checked={importMode === "replace"} onChange={() => setImportMode("replace")} className="accent-emerald-700" />
                Replace them
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="import-mode" checked={importMode === "append"} onChange={() => setImportMode("append")} className="accent-emerald-700" />
                Add to them
              </label>
            </fieldset>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              if (!busy) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              const file = event.dataTransfer.files[0]
              if (file) void handleFile(file)
            }}
            className={cn(
              "flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-5 py-7 text-center transition-colors hover:border-emerald-700 hover:bg-emerald-50/40 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-wait",
              dragging && "border-emerald-700 bg-emerald-50"
            )}
          >
            {busy ? <Loader2 className="size-7 animate-spin text-emerald-700" /> : <UploadCloud className="size-7 text-emerald-700" />}
            <span className="font-medium">{busy ? "Reading the file..." : "Choose the completed template or drop it here"}</span>
            <span className="text-xs text-muted-foreground">XLSX or CSV · up to 20 MB</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept=".xlsx,.csv"
            aria-label="Trial balance file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          {sheets.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="worksheet">Worksheet</Label>
                <select
                  id="worksheet"
                  className="h-10 rounded-md border bg-white px-3 text-sm"
                  value={sheetIndex}
                  onChange={(event) => setSheetIndex(Number(event.target.value))}
                >
                  {sheets.map((sheet, index) => (
                    <option key={index} value={index}>
                      {sheet.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => {
                  try {
                    commitImport(sheets[sheetIndex], pendingFilename)
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Could not read this worksheet.")
                  }
                }}
              >
                Import worksheet
              </Button>
            </div>
          )}
        </section>
      )}

      {mode === "manual" && (
        <section aria-label="Manual entry" className="space-y-4 rounded-xl border bg-white p-5">
          <form onSubmit={addManual} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_auto] md:items-end">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="manual-head">Head</Label>
              <select
                id="manual-head"
                className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                value={knownHead ? head : head}
                onChange={(event) => {
                  setHead(event.target.value)
                  setChoice(0)
                }}
              >
                <option value="">Select a head</option>
                {!knownHead && <option value={head}>{head}</option>}
                <optgroup label="Balance sheet">
                  {headOptions.bs.map((h) => (
                    <option key={h.name}>{h.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Profit & loss">
                  {headOptions.pl.map((h) => (
                    <option key={h.name}>{h.name}</option>
                  ))}
                </optgroup>
                {headOptions.custom.length > 0 && (
                  <optgroup label="Your heads">
                    {headOptions.custom.map((h) => (
                      <option key={h.name}>{h.name}</option>
                    ))}
                  </optgroup>
                )}
                <option value={NEW_HEAD}>+ Add new head…</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-amount">Amount (AED)</Label>
              <Input
                ref={amountInput}
                id="manual-amount"
                inputMode="decimal"
                placeholder="0.00"
                className="h-10 font-mono"
                value={amount}
                aria-invalid={Boolean(amount && parsedAmount === null)}
                onChange={(event) => setAmount(event.target.value)}
              />
              {entryMode === "movement" && (
                <p className="text-xs text-muted-foreground">Increase in the year. Enter a decrease as a negative, e.g. -5000.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="h-10 bg-emerald-800 hover:bg-emerald-900" disabled={!head || head === NEW_HEAD || !parsedAmount || Boolean(headChoices && !choice)}>
                {editingId ? <Check className="size-4" /> : <Plus className="size-4" />}
                {editingId ? "Update" : "Add"}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => {
                    setEditingId(null)
                    setHead("")
                    setAmount("")
                    setChoice(0)
                  }}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          </form>
          {amount && parsedAmount === null && (
            <p className="text-sm text-destructive">Enter a valid amount, such as 1,250.00.</p>
          )}
          {headChoices && (
            <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <legend className="mb-2 font-medium">Which way is this balance?</legend>
              {headChoices.map((option) => (
                <label key={option.label} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="balance-choice"
                    className="accent-emerald-700"
                    checked={choice === option.side}
                    onChange={() => setChoice(option.side)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          )}
          {head && head !== NEW_HEAD && (
            <HeadHint head={head} customHeads={customHeads} side={choice || (headChoices ? headChoices[0].side : 1)} />
          )}
          {head === NEW_HEAD && (
            <div className="grid gap-3 rounded-lg border border-dashed p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="new-head-name">New head name</Label>
                <Input
                  id="new-head-name"
                  value={newHead.name}
                  placeholder="e.g. Staff accommodation"
                  onChange={(event) => setNewHead((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-head-line">Report it under</Label>
                <ReportLineSelect
                  id="new-head-line"
                  label="Report new head under"
                  value={newHead.scheduleKey}
                  onChange={(scheduleKey) => setNewHead((current) => ({ ...current, scheduleKey }))}
                />
              </div>
              <Button type="button" onClick={saveNewHead} disabled={savingHead || newHead.name.trim().length < 2 || !newHead.scheduleKey}>
                {savingHead ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add head
              </Button>
              <p className="text-xs text-muted-foreground md:col-span-3">
                New heads are saved to this company and appear in the list for every year.
              </p>
            </div>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className={cn("text-sm text-muted-foreground", !notice && "sr-only")}>
        {notice}
      </p>

      {rows.length > 0 && (
        <section aria-label="Trial balance overview" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Trial balance overview</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{rows.length} balances</span>
              {unmapped > 0 && (
                <label className="flex items-center gap-2 text-amber-800">
                  <input
                    type="checkbox"
                    className="accent-amber-600"
                    checked={onlyUnmapped}
                    onChange={(event) => {
                      setOnlyUnmapped(event.target.checked)
                      setPage(1)
                    }}
                  />
                  Show {unmapped} to classify
                </label>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Each balance is classified automatically. Change “Reported under” to report it somewhere else.
          </p>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">#</TableHead>
                  <TableHead>Head</TableHead>
                  <TableHead className="text-right">Amount (AED)</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Statement</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="min-w-56">Reported under</TableHead>
                  <TableHead className="w-20">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const info = categoryOf(row.scheduleKey ?? "")
                  const options = choicesFor(row.ledgerName)
                  const plain = toPlain(row.ledgerName, row.amount, row.scheduleKey ?? "", customHeads)
                  return (
                    <TableRow key={row.id} className={cn(!info && "bg-amber-50/60")}>
                      <TableCell className="pl-4 text-xs text-muted-foreground">{rows.indexOf(row) + 1}</TableCell>
                      <TableCell className="min-w-40 max-w-72 whitespace-normal break-words font-medium">{row.ledgerName}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {plain < 0 ? (
                          <span className="text-amber-800" title="Opposite of the usual balance for this head, e.g. an overdrawn bank">
                            ({formatAmount(-plain)})
                          </span>
                        ) : (
                          formatAmount(plain)
                        )}
                      </TableCell>
                      <TableCell className="min-w-56">
                        {options ? (
                          <select
                            aria-label={`Type for ${row.ledgerName}`}
                            className="h-9 w-full rounded-md border bg-white px-2 text-sm"
                            value={Math.sign(row.amount)}
                            onChange={(event) => {
                              const side = Number(event.target.value) as Side
                              const amount = Math.abs(row.amount) * side
                              const vatLine = row.scheduleKey === "taxReceivable" || row.scheduleKey === "taxPayable"
                              onRowsChange(
                                rows.map((item) =>
                                  item.id === row.id
                                    ? { ...item, amount, scheduleKey: vatLine ? resolveSchedule(row.ledgerName, amount, customHeads) : item.scheduleKey }
                                    : item
                                )
                              )
                            }}
                          >
                            {options.map((option) => (
                              <option key={option.label} value={option.side}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {info ? (
                          <span className={cn("rounded px-2 py-0.5 text-xs font-medium", info.statement === "BS" ? "bg-sky-50 text-sky-800" : "bg-violet-50 text-violet-800")}>
                            {info.statement === "BS" ? "Balance sheet" : "P&L"}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-800">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{info?.category ?? <span className="text-amber-800">Needs classification</span>}</TableCell>
                      <TableCell>
                        <ReportLineSelect
                          label={`Reported under for ${row.ledgerName}`}
                          value={row.scheduleKey ?? ""}
                          onChange={(scheduleKey) =>
                            onRowsChange(
                              rows.map((item) =>
                                item.id === row.id
                                  ? {
                                      ...item,
                                      scheduleKey,
                                      // Heads FinScope doesn't know take their direction from where they are reported.
                                      amount: options
                                        ? item.amount
                                        : toSigned(item.ledgerName, plain, scheduleKey, customHeads),
                                    }
                                  : item
                              )
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${row.ledgerName}`} onClick={() => editRow(row)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${row.ledgerName}`}
                            onClick={() => {
                              onRowsChange(rows.filter((item) => item.id !== row.id))
                              setNotice(`${row.ledgerName} removed.`)
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {difference === 0 ? (
            <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
              <CheckCircle2 className="size-4" /> Your figures balance.
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-medium">Your figures are out by AED {formatAmount(Math.abs(difference))}.</span> Usually a
                balance is missing or entered twice, or a head under Type is set the wrong way.
              </span>
            </p>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-16 text-center text-sm">
                {currentPage} / {pages}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function HeadHint({ head, customHeads, side }: { head: string; customHeads: CustomHead[]; side: Side }) {
  const key = resolveSchedule(head, side, customHeads)
  const info = categoryOf(key)
  if (!info) return <p className="text-sm text-amber-800">This head needs classifying after it is added.</p>
  const line = scheduleLines.find((item) => item.key === key)!
  return (
    <p className="text-sm text-muted-foreground">
      Reported in the {info.statement === "BS" ? "balance sheet" : "profit & loss"} under {info.category} · {line.label}.
      {!choicesFor(head) && " Enter a negative amount only if the balance is the opposite of usual, such as an overdrawn bank."}
    </p>
  )
}
