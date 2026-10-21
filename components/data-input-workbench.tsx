"use client"

import { useEffect, useId, useRef, useState } from "react"
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  ListChecks,
  Loader2,
  Pencil,
  PenLine,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react"
import { MappingWorkbench } from "@/components/mapping-workbench"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ledgerHeads } from "@/lib/ledger-heads"
import {
  parseImportSheet,
  readTrialBalance,
  type ImportSheet,
} from "@/lib/import-trial-balance"
import {
  createLedgerRow,
  formatAmount,
  parseAmount,
  suggestMapping,
  type LedgerRow,
} from "@/lib/trial-balance"
import { cn } from "@/lib/utils"
import { suggestSchedule } from "@/lib/financial-statements"

const PAGE_SIZE = 15

const EMPTY_ROWS: LedgerRow[] = []

export function DataInputWorkbench({
  initialRows = EMPTY_ROWS,
  onRowsChange,
}: {
  initialRows?: LedgerRow[]
  onRowsChange?: (rows: LedgerRow[]) => void
}) {
  const ledgerListId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<"upload" | "manual" | null>(null)
  const [rows, setRows] = useState<LedgerRow[]>(initialRows)
  useEffect(() => {
    onRowsChange?.(rows)
  }, [rows, onRowsChange])
  const [manual, setManual] = useState({ ledgerName: "", amount: "" })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [source, setSource] = useState("")
  const [importMode, setImportMode] = useState<"replace" | "append">("append")
  const [sheets, setSheets] = useState<ImportSheet[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [pendingFilename, setPendingFilename] = useState("")
  const [tab, setTab] = useState("preview")
  const [page, setPage] = useState(1)
  const total =
    rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100
  const manualAmount = parseAmount(manual.amount)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const visibleRows = rows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )
  const reviewed = rows.filter((row) => row.confidence === "Reviewed").length

  function commitImport(sheet: ImportSheet, filename: string) {
    const parsed = parseImportSheet(sheet)
    const imported = parsed.entries.map((entry) => ({
      ...createLedgerRow(entry),
      scheduleKey: suggestSchedule(entry.ledgerName, entry.amount),
    }))
    setRows((current) =>
      importMode === "append" ? [...current, ...imported] : imported
    )
    setSource(filename)
    setNotice(
      `${imported.length} ledgers imported from ${filename}.${parsed.skipped ? ` ${parsed.skipped} rows with missing or invalid names or amounts were skipped.` : ""}${parsed.totalsSkipped ? ` ${parsed.totalsSkipped} total rows excluded.` : ""}`
    )
    setSheets([])
    setEditingId(null)
    setManual({ ledgerName: "", amount: "" })
    setError("")
    setPage(1)
    setTab("preview")
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
      setError(
        cause instanceof Error
          ? cause.message
          : "We could not read this file. Try the Excel template."
      )
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  function addManualRow(event: React.FormEvent) {
    event.preventDefault()
    if (!manual.ledgerName.trim() || manualAmount === null) return
    const entry = { ledgerName: manual.ledgerName.trim(), amount: manualAmount }
    if (editingId) {
      setRows((current) =>
        current.map((row) =>
          row.id === editingId
            ? {
                ...row,
                ...entry,
                scheduleKey:
                  row.ledgerName === entry.ledgerName
                    ? row.scheduleKey
                    : suggestSchedule(entry.ledgerName, entry.amount),
                ...(row.ledgerName === entry.ledgerName
                  ? {}
                  : suggestMapping(entry.ledgerName)),
              }
            : row
        )
      )
      setNotice(`${entry.ledgerName} updated.`)
    } else {
      setRows((current) => [
        ...current,
        {
          ...createLedgerRow(entry),
          scheduleKey: suggestSchedule(entry.ledgerName, entry.amount),
        },
      ])
      setPage(Math.ceil((rows.length + 1) / PAGE_SIZE))
      setNotice(`${entry.ledgerName} added.`)
    }
    setManual({ ledgerName: "", amount: "" })
    setEditingId(null)
    setTab("preview")
    nameInput.current?.focus()
  }

  function editRow(row: LedgerRow) {
    setMode("manual")
    setEditingId(row.id)
    setManual({ ledgerName: row.ledgerName, amount: String(row.amount) })
    requestAnimationFrame(() => {
      nameInput.current?.focus()
      nameInput.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  return (
    <TooltipProvider>
      <div className="space-y-7">
        <div
          className="grid gap-4 sm:grid-cols-2"
          aria-label="Trial balance entry method"
        >
          {(
            [
              {
                value: "upload",
                title: "Upload trial balance",
                subtitle: "XLSX, CSV or PDF",
                icon: UploadCloud,
                color: "bg-emerald-50 text-emerald-800",
              },
              {
                value: "manual",
                title: "Enter it manually",
                subtitle: "Ledger name & amount",
                icon: PenLine,
                color: "bg-amber-50 text-amber-800",
              },
            ] as const
          ).map((option) => {
            const Icon = option.icon
            const selected = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => {
                  setMode(option.value)
                  setError("")
                }}
                className={cn(
                  "group relative flex min-h-44 min-w-0 items-center gap-5 rounded-lg border bg-white p-6 text-left shadow-sm transition-[border-color,box-shadow] hover:border-primary/60 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-60 sm:p-7",
                  selected && "border-emerald-700 ring-1 ring-emerald-700"
                )}
              >
                <span
                  className={cn(
                    "flex size-14 shrink-0 items-center justify-center rounded-lg",
                    option.color
                  )}
                >
                  <Icon className="size-7" strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold sm:text-xl">
                    {option.title}
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {option.subtitle}
                  </span>
                </span>
                <span
                  className={cn(
                    "absolute right-4 top-4",
                    selected ? "text-emerald-700" : "text-muted-foreground"
                  )}
                >
                  {selected ? (
                    <CheckCircle2 className="size-5" />
                  ) : (
                    <ArrowRight className="size-5" />
                  )}
                </span>
              </button>
            )
          })}
        </div>

        {mode === "upload" && (
          <section
            aria-label="Upload trial balance file"
            className="space-y-4 border-t pt-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Upload trial balance</h2>
              <Button asChild variant="outline" size="sm">
                <a
                  href="/templates/trial-balance-template.xlsx"
                  download="Trial Balance Template.xlsx"
                >
                  <ArrowDownToLine className="size-4" />
                  Download template
                </a>
              </Button>
            </div>
            <div className="flex gap-3 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
              <AlertCircle className="mt-1 size-4 shrink-0" />
              <p>
                Uploaded data may not be accurate. Review the preview and
                account mapping. For more accurate imports, use the downloadable
                template.
              </p>
            </div>
            {rows.length > 0 && (
              <fieldset
                disabled={busy}
                className="flex flex-wrap gap-x-5 gap-y-2 text-sm"
              >
                <legend className="mb-2 font-medium">
                  Import into this trial balance
                </legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={importMode === "append"}
                    onChange={() => setImportMode("append")}
                    className="accent-emerald-700"
                  />
                  Add to existing ledgers
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="import-mode"
                    checked={importMode === "replace"}
                    onChange={() => setImportMode("replace")}
                    className="accent-emerald-700"
                  />
                  Replace all {rows.length} ledgers
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
                "flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-white px-5 py-7 text-center transition-colors hover:border-emerald-700 hover:bg-emerald-50/40 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-wait",
                dragging && "border-emerald-700 bg-emerald-50"
              )}
            >
              {busy ? (
                <Loader2 className="mb-1 size-7 animate-spin text-emerald-700" />
              ) : (
                <UploadCloud className="mb-1 size-7 text-emerald-700" />
              )}
              <span className="font-medium">
                {busy
                  ? "Reading your trial balance..."
                  : "Choose a file or drop it here"}
              </span>
              <span className="text-xs text-muted-foreground">
                XLSX, CSV or PDF · Up to 20 MB
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".xlsx,.csv,.pdf"
              aria-label="Trial balance file"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
            {sheets.length > 0 && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="worksheet">Worksheet</Label>
                  <select
                    id="worksheet"
                    className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"
                    value={sheetIndex}
                    onChange={(event) =>
                      setSheetIndex(Number(event.target.value))
                    }
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
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Could not read this worksheet."
                      )
                    }
                  }}
                >
                  Import worksheet
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            )}
            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 break-words text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}
          </section>
        )}

        {mode === "manual" && (
          <section
            aria-label="Manual trial balance entry"
            className="space-y-4 border-t pt-6"
          >
            <h2 className="text-lg font-semibold">
              {editingId ? "Edit ledger" : "Manual trial balance entry"}
            </h2>
            <form
              onSubmit={addManualRow}
              className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.5fr)] xl:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)_auto] xl:items-end"
            >
              <div className="min-w-0 space-y-2">
                <Label htmlFor="ledger-name">Name of ledger</Label>
                <Input
                  ref={nameInput}
                  id="ledger-name"
                  list={ledgerListId}
                  autoComplete="off"
                  placeholder="Select or enter a ledger"
                  className="h-11 bg-white"
                  value={manual.ledgerName}
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      ledgerName: event.target.value,
                    }))
                  }
                />
                <datalist id={ledgerListId}>
                  {ledgerHeads.map((ledger) => (
                    <option key={ledger.name} value={ledger.name} />
                  ))}
                </datalist>
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="ledger-amount">Amount</Label>
                <Input
                  id="ledger-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-11 bg-white font-mono"
                  value={manual.amount}
                  aria-invalid={Boolean(manual.amount && manualAmount === null)}
                  aria-describedby={
                    manual.amount && manualAmount === null
                      ? "amount-error"
                      : undefined
                  }
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
                <Button
                  type="submit"
                  className="h-11 flex-1 bg-emerald-800 hover:bg-emerald-900"
                  disabled={!manual.ledgerName.trim() || manualAmount === null}
                >
                  {editingId ? (
                    <Check className="size-4" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {editingId ? "Save ledger" : "Add ledger"}
                </Button>
                {editingId && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => {
                      setEditingId(null)
                      setManual({ ledgerName: "", amount: "" })
                    }}
                  >
                    <X className="size-4" />
                    Cancel
                  </Button>
                )}
              </div>
            </form>
            {manual.amount && manualAmount === null && (
              <p id="amount-error" className="text-sm text-destructive">
                Enter a valid amount, such as 1,250.00 or -500.00.
              </p>
            )}
          </section>
        )}

        <p
          role="status"
          aria-live="polite"
          className={cn(
            "break-words text-sm text-muted-foreground",
            !notice && "sr-only"
          )}
        >
          {notice}
        </p>

        {(mode || rows.length > 0) && (
          <section
            aria-label="Trial balance review"
            className="min-w-0 space-y-5 border-t pt-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Trial balance review</h2>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>{rows.length} ledgers</span>
                <span>
                  {reviewed} of {rows.length} mappings reviewed
                </span>
              </div>
            </div>
            {!rows.length ? (
              <div className="flex min-h-44 flex-col items-center justify-center border-y border-dashed py-8 text-center">
                <FileSpreadsheet className="mb-3 size-7 text-muted-foreground" />
                <p className="font-medium">No ledgers added yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "manual"
                    ? "Your trial balance is empty."
                    : "No trial balance imported."}
                </p>
              </div>
            ) : (
              <>
                {source && (
                  <p className="flex items-start gap-2 text-sm text-amber-800">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    This trial balance includes uploaded data. Verify amounts
                    against the original file.
                  </p>
                )}
                <Tabs
                  value={tab}
                  onValueChange={setTab}
                  className="min-w-0 flex-col gap-5"
                >
                  <TabsList className="h-11 max-w-full border bg-white p-1">
                    <TabsTrigger
                      value="preview"
                      className="h-full gap-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                    >
                      <FileSpreadsheet className="size-4" />
                      Preview
                    </TabsTrigger>
                    <TabsTrigger
                      value="mapping"
                      className="h-full gap-2 px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                    >
                      <ListChecks className="size-4" />
                      Account mapping
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="preview" className="min-w-0">
                    <div className="overflow-hidden rounded-lg border bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12 pl-4">#</TableHead>
                            <TableHead>Name of ledger</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="w-24">
                              <span className="sr-only">Actions</span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleRows.map((row, index) => (
                            <TableRow key={row.id}>
                              <TableCell className="pl-4 text-xs text-muted-foreground">
                                {(currentPage - 1) * PAGE_SIZE + index + 1}
                              </TableCell>
                              <TableCell className="min-w-36 max-w-96 whitespace-normal break-words font-medium">
                                {row.ledgerName}
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {formatAmount(row.amount)}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-1">
                                  <IconAction
                                    label={`Edit ${row.ledgerName}`}
                                    onClick={() => editRow(row)}
                                  >
                                    <Pencil className="size-4" />
                                  </IconAction>
                                  <IconAction
                                    label={`Remove ${row.ledgerName}`}
                                    onClick={() => {
                                      setRows((current) =>
                                        current.filter(
                                          (item) => item.id !== row.id
                                        )
                                      )
                                      if (editingId === row.id) {
                                        setEditingId(null)
                                        setManual({
                                          ledgerName: "",
                                          amount: "",
                                        })
                                      }
                                      setNotice(`${row.ledgerName} removed.`)
                                    }}
                                  >
                                    <Trash2 className="size-4" />
                                  </IconAction>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-secondary/70 font-semibold">
                            <TableCell />
                            <TableCell>Total of all ledgers</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatAmount(total)}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </TabsContent>
                  <TabsContent value="mapping" className="min-w-0">
                    <MappingWorkbench
                      rows={visibleRows}
                      onScheduleChange={(id, scheduleKey) =>
                        setRows((current) =>
                          current.map((row) =>
                            row.id === id ? { ...row, scheduleKey } : row
                          )
                        )
                      }
                      onChange={(id, category) =>
                        setRows((current) =>
                          current.map((row) =>
                            row.id === id
                              ? {
                                  ...row,
                                  category,
                                  confidence: "Reviewed",
                                  rationale: "Category selected during review.",
                                }
                              : row
                          )
                        )
                      }
                      onConfirm={() => {
                        const ids = new Set(visibleRows.map((row) => row.id))
                        setRows((current) =>
                          current.map((row) =>
                            ids.has(row.id) && row.category
                              ? {
                                  ...row,
                                  confidence: "Reviewed",
                                  rationale:
                                    "Suggested category accepted during review.",
                                }
                              : row
                          )
                        )
                      }}
                    />
                  </TabsContent>
                </Tabs>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {(currentPage - 1) * PAGE_SIZE + 1}-
                    {Math.min(currentPage * PAGE_SIZE, rows.length)} of{" "}
                    {rows.length} ledgers
                  </span>
                  <div className="flex items-center gap-2">
                    <IconAction
                      label="Previous page"
                      disabled={currentPage === 1}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      <ChevronLeft className="size-4" />
                    </IconAction>
                    <span className="min-w-16 text-center text-sm">
                      {currentPage} / {pages}
                    </span>
                    <IconAction
                      label="Next page"
                      disabled={currentPage === pages}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      <ChevronRight className="size-4" />
                    </IconAction>
                  </div>
                  {tab === "preview" && (
                    <Button variant="outline" onClick={() => setTab("mapping")}>
                      Review account mapping
                      <ArrowRight className="size-4" />
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </TooltipProvider>
  )
}

function IconAction({
  label,
  children,
  ...props
}: {
  label: string
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
