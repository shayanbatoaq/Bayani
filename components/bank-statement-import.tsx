"use client"

import { useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, FileText, KeyRound, Landmark, Loader2, Search, ShieldCheck, Trash2, UploadCloud, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  CATEGORIES,
  DEFAULT_RATES,
  HEAD_PREFIX,
  categoriseAccounts,
  categoryByKey,
  headCategory,
  markReversals,
  patternOf,
  type CategorisedTransaction,
  type Category,
  type LearnedRule,
} from "@/lib/bank-categories"
import { StatementPasswordError, readStatementFile } from "@/lib/bank-reader"
import type { BankAccount, ParsedStatement } from "@/lib/bank-statement"
import { formatLongDate } from "@/lib/company"
import { categoryOf, scheduleLines } from "@/lib/financial-statements"
import { ledgerHeads, type CustomHead } from "@/lib/ledger-heads"
import { cn } from "@/lib/utils"

type Loaded = {
  id: string
  file: File
  name: string
  status: "reading" | "done" | "error" | "password"
  parsed?: ParsedStatement
  error?: string
  password?: string
}
export type StatementRows = {
  ledgerName: string
  amount: number
  scheduleKey: string
}[]

const money = (n: number, digits = 2) =>
  (Math.round(n * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
const VAT_SCOPE = new Set(["sales", "purchases", "rent", "utilities", "professional", "marketing", "software", "travel", "vehicle", "meals", "office", "otherExpense", "assets"])
const OPENING_SOURCES = [
  {
    key: "retained",
    label: "Profits of earlier years",
    ledgerName: "Retained Earnings",
    scheduleKey: "retained",
  },
  {
    key: "capital",
    label: "Share capital paid in",
    ledgerName: "Share Capital",
    scheduleKey: "capital",
  },
  {
    key: "owner",
    label: "Owner's current account",
    ledgerName: "Current Account",
    scheduleKey: "shareholder",
  },
  {
    key: "loan",
    label: "A loan",
    ledgerName: "Long Term Liabilities",
    scheduleKey: "longTermLiabilities",
  },
] as const

/**
 * Upload bank statements, check them against their running balances, sort every line
 * into a head and send the totals to the data input.
 */
export function BankStatementImport({
  companyName,
  period,
  entryMode,
  vatRegistered,
  learned,
  onSaveRules,
  onApply,
  hasRows,
  customHeads,
  onAddHead,
}: {
  companyName: string
  period: { start: string; end: string }
  entryMode: "closing" | "movement"
  vatRegistered: boolean
  learned: LearnedRule[]
  onSaveRules: (rules: LearnedRule[]) => Promise<void>
  onApply: (rows: StatementRows, mode: "replace" | "append", summary: string) => Promise<void> | void
  hasRows: boolean
  customHeads: CustomHead[]
  onAddHead: (head: CustomHead) => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Loaded[]>([])
  const [dragging, setDragging] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [sessionRules, setSessionRules] = useState<Record<string, string>>({})
  const [rates, setRates] = useState<Record<string, number>>(DEFAULT_RATES)
  const [vatIncluded, setVatIncluded] = useState(vatRegistered)
  const [openingSource, setOpeningSource] = useState<(typeof OPENING_SOURCES)[number]["key"]>("retained")
  const [view, setView] = useState<string>("review")
  const [query, setQuery] = useState("")
  const [importMode, setImportMode] = useState<"replace" | "append">("replace")
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState("")
  const [shown, setShown] = useState(60)

  // Every head of the trial balance list (standard and the company's own) can be chosen for a line.
  const heads = useMemo(() => {
    const seen = new Set<string>()
    const list: Category[] = []
    for (const head of [...ledgerHeads.map((h) => ({ name: h.name, scheduleKey: h.scheduleKey })), ...customHeads]) {
      if (!head.scheduleKey || head.scheduleKey === "auto" || head.scheduleKey === "bank" || seen.has(head.name.toLowerCase())) continue
      seen.add(head.name.toLowerCase())
      list.push(headCategory(head, categoryOf(head.scheduleKey)?.statement))
    }
    return list
  }, [customHeads])
  const catOf = (key: string) => categoryByKey.get(key) ?? heads.find((h) => h.key === key)

  async function read(entry: Loaded) {
    setFiles((list) => list.map((f) => (f.id === entry.id ? { ...f, status: "reading", error: undefined } : f)))
    try {
      const parsed = await readStatementFile(entry.file, entry.password)
      setFiles((list) => list.map((f) => (f.id === entry.id ? { ...f, status: "done", parsed } : f)))
    } catch (cause) {
      if (cause instanceof StatementPasswordError)
        setFiles((list) =>
          list.map((f) =>
            f.id === entry.id
              ? {
                  ...f,
                  status: "password",
                  error: cause.wrong ? "That password did not open the file." : undefined,
                }
              : f,
          ),
        )
      else
        setFiles((list) =>
          list.map((f) =>
            f.id === entry.id
              ? {
                  ...f,
                  status: "error",
                  error: cause instanceof Error ? cause.message : "Could not read this file.",
                }
              : f,
          ),
        )
    }
  }

  function add(list: FileList | File[]) {
    const entries = [...list].slice(0, 24).map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      status: "reading" as const,
    }))
    setFiles((current) => [...current, ...entries])
    entries.forEach((entry) => void read(entry))
  }

  const accounts = useMemo(
    () =>
      files.flatMap((f) =>
        (f.parsed?.accounts ?? []).map((account) => ({
          account,
          bank: f.parsed!.bank,
          file: f.name,
        })),
      ),
    [files],
  )

  const all = useMemo(() => {
    const list: (CategorisedTransaction & {
      bank: string
      accountKey: string
      inPeriod: boolean
    })[] = []
    for (const { account, bank } of accounts) {
      for (const t of categoriseAccounts([account], { companyName, learned }))
        list.push({
          ...t,
          bank,
          accountKey: account.key,
          inPeriod: t.date >= period.start && t.date <= period.end,
        })
    }
    // Same amount leaving one uploaded account and arriving in another within three days: an internal transfer.
    const open = list.filter((t) => t.category === "review" || t.category === "sales" || t.category === "purchases")
    for (const t of open) {
      if (t.amount >= 0) continue
      const match = open.find(
        (u) =>
          u.accountKey !== t.accountKey &&
          u.currency === t.currency &&
          Math.abs(u.amount + t.amount) < 0.01 &&
          Math.abs(Date.parse(u.date) - Date.parse(t.date)) <= 3 * 86400000 &&
          u.category !== "transfer",
      )
      if (match) {
        t.category = "transfer"
        match.category = "transfer"
        t.source = match.source = "rule"
      }
    }
    return markReversals(list)
  }, [accounts, companyName, learned, period.start, period.end])

  const effective = (t: (typeof all)[number]) => overrides[t.id] ?? sessionRules[patternOf(t.description)] ?? t.category
  const inPeriod = all.filter((t) => t.inPeriod)
  const outside = all.length - inPeriod.length
  const reviewCount = inPeriod.filter((t) => effective(t) === "review").length

  function setCategory(t: (typeof all)[number], category: string, similar: boolean) {
    setOverrides((o) => ({ ...o, [t.id]: category }))
    const pattern = patternOf(t.description)
    if (similar && pattern) setSessionRules((r) => ({ ...r, [pattern]: category }))
  }

  /* ---- per-account period figures ---- */
  const accountFigures = accounts.map(({ account, bank, file }) => {
    const before = account.transactions.filter((t) => t.date < period.start).reduce((s, t) => s + t.amount, 0)
    const within = account.transactions.filter((t) => t.date >= period.start && t.date <= period.end)
    const opening = (account.opening ?? 0) + before
    const closing = opening + within.reduce((s, t) => s + t.amount, 0)
    return { account, bank, file, opening, closing, count: within.length }
  })
  const currencies = [...new Set(accounts.map((a) => a.account.currency))]
  const rate = (c: string) => (c === "AED" ? 1 : (rates[c] ?? 0))
  const openingAed = accountFigures.reduce((s, a) => s + a.opening * rate(a.account.currency), 0)
  const closingAed = accountFigures.reduce((s, a) => s + a.closing * rate(a.account.currency), 0)
  const coverage = coverageOf(
    accounts.map((a) => a.account),
    period,
  )

  /* ---- totals by head ---- */
  const totals = new Map<string, { amount: number; count: number }>()
  for (const t of inPeriod) {
    const key = effective(t)
    const entry = totals.get(key) ?? { amount: 0, count: 0 }
    entry.amount += t.amount * rate(t.currency)
    entry.count++
    totals.set(key, entry)
  }
  const counted = (t: (typeof all)[number]) => !["transfer", "reversed"].includes(effective(t))
  const moneyIn = inPeriod.filter((t) => t.amount > 0 && counted(t)).reduce((s, t) => s + t.amount * rate(t.currency), 0)
  const moneyOut = inPeriod.filter((t) => t.amount < 0 && counted(t)).reduce((s, t) => s + t.amount * rate(t.currency), 0)

  function buildRows() {
    const out = new Map<string, { ledgerName: string; amount: number; scheduleKey: string }>()
    const push = (ledgerName: string, scheduleKey: string, amount: number) => {
      const key = `${ledgerName}|${scheduleKey}`
      const entry = out.get(key) ?? { ledgerName, scheduleKey, amount: 0 }
      entry.amount += amount
      out.set(key, entry)
    }
    for (const [key, total] of totals) {
      const category = catOf(key)
      if (!category?.ledgerName) continue
      let amount = total.amount
      if (vatIncluded && VAT_SCOPE.has(key)) {
        const net = amount / 1.05
        push("VAT Control", "taxPayable", -(amount - net))
        amount = net
      }
      push(category.ledgerName, category.scheduleKey, -amount)
    }
    // Lines still under review are left in the bank so the figures balance; they are reported in the summary.
    const pending = (totals.get("review")?.amount ?? 0) + (totals.get("reversed")?.amount ?? 0)
    if (Math.abs(pending) > 0.004) push("Suspense (bank lines under review)", "otherPayables", -pending)
    if (entryMode === "movement") push("Bank", "bank", closingAed - openingAed)
    else {
      push("Bank", "bank", closingAed)
      const source = OPENING_SOURCES.find((s) => s.key === openingSource)!
      if (Math.abs(openingAed) > 0.004) push(source.ledgerName, source.scheduleKey, -openingAed)
    }
    const rows = [...out.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 })).filter((r) => r.amount !== 0)
    // Rounding each head to fils can leave a fils or two; it goes to the largest income or expense head.
    const residual = Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100
    if (residual !== 0 && Math.abs(residual) < 1) {
      const target = rows.filter((r) => r.ledgerName !== "Bank").sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0]
      if (target) target.amount = Math.round((target.amount - residual) * 100) / 100
    }
    return rows
  }

  async function apply() {
    setApplying(true)
    setError("")
    try {
      const rules = new Map(learned.map((r) => [r.pattern, r.category]))
      for (const [pattern, category] of Object.entries(sessionRules)) rules.set(pattern, category)
      for (const t of inPeriod) {
        const chosen = overrides[t.id]
        const pattern = patternOf(t.description)
        if (chosen && pattern && chosen !== "review") rules.set(pattern, chosen)
      }
      const merged = [...rules.entries()].map(([pattern, category]) => ({ pattern, category })).slice(-3000)
      if (merged.length !== learned.length || merged.some((r, i) => learned[i]?.pattern !== r.pattern || learned[i]?.category !== r.category)) await onSaveRules(merged)
      const rows = buildRows()
      const summary = `${inPeriod.length} bank lines from ${accounts.length} account${accounts.length === 1 ? "" : "s"} added as ${rows.length} balances.${reviewCount ? ` ${reviewCount} lines still under review are held in "Suspense (bank lines under review)".` : ""}${outside ? ` ${outside} lines outside ${formatLongDate(period.start)} – ${formatLongDate(period.end)} were left out.` : ""}`
      await onApply(rows, importMode, summary)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the figures.")
    } finally {
      setApplying(false)
    }
  }

  const visible = inPeriod
    .filter((t) => (view === "all" ? true : effective(t) === view))
    .filter((t) => !query || `${t.description} ${t.amount}`.toLowerCase().includes(query.toLowerCase()))
  const ready = files.length > 0 && files.every((f) => f.status === "done" || f.status === "error")

  return (
    <section aria-label="Upload bank statements" className="space-y-5">
      <div className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold">Bank statements</h3>
            <p className="text-sm text-muted-foreground">
              Upload every statement for {formatLongDate(period.start)} – {formatLongDate(period.end)}: all months and all accounts. PDF from online banking, Excel or CSV. Files
              are read on this device and are not uploaded.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            add(e.dataTransfer.files)
          }}
          className={cn("choice w-full", dragging && "choice-over")}
          style={{ minHeight: "9rem" }}
        >
          <UploadCloud className="size-7 text-[var(--cobalt)]" />
          <span className="font-medium">Choose statements or drop them here</span>
          <span className="text-xs text-muted-foreground">PDF, XLSX or CSV · several files at once · up to 30 MB each</span>
        </button>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.xlsx,.csv"
          aria-label="Bank statement files"
          onChange={(e) => e.target.files && add(e.target.files)}
        />

        {files.length > 0 && (
          <ul className="space-y-2">
            {files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                onPassword={(password) => {
                  const next = { ...f, password }
                  setFiles((list) => list.map((x) => (x.id === f.id ? next : x)))
                  void read(next)
                }}
                onRemove={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
              />
            ))}
          </ul>
        )}
      </div>

      {accounts.length > 0 && (
        <>
          <div className="panel space-y-4 p-5">
            <h3 className="flex items-center gap-2 font-display font-semibold">
              <ShieldCheck className="size-4 text-[var(--lagoon)]" /> Statement check
            </h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {accountFigures.map(({ account, bank, file, opening, closing, count }) => (
                <AccountCard key={account.key} account={account} bank={bank} file={file} opening={opening} closing={closing} count={count} />
              ))}
            </div>
            {coverage.missing.length > 0 && (
              <p className="note note-warning text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  No statement lines for {coverage.missing.join(", ")}. If the accounts were used in those months, upload those statements too; otherwise the year&apos;s totals
                  will be understated.
                </span>
              </p>
            )}
            {outside > 0 && inPeriod.length > 0 && <p className="text-xs text-muted-foreground">{outside} lines dated outside the financial year are not counted.</p>}
            {all.length > 0 && inPeriod.length === 0 && (
              <p className="note note-alert text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  None of these lines fall in {formatLongDate(period.start)} – {formatLongDate(period.end)}. Pick the year the statements belong to above, or upload the statements
                  for this year.
                </span>
              </p>
            )}
            {currencies.some((c) => c !== "AED") && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-muted-foreground">Rates to AED (change to the rates you use):</span>
                {currencies
                  .filter((c) => c !== "AED")
                  .map((c) => (
                    <label key={c} className="flex items-center gap-1.5">
                      <span className="font-medium">1 {c} =</span>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        className="h-9 w-24 rounded-lg border bg-white px-2 text-sm"
                        value={rates[c] ?? ""}
                        onChange={(e) =>
                          setRates((r) => ({
                            ...r,
                            [c]: Number(e.target.value),
                          }))
                        }
                      />
                      <span className="text-muted-foreground">AED</span>
                    </label>
                  ))}
              </div>
            )}
          </div>

          {inPeriod.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Money in" value={moneyIn} tone="text-[#0d7d73]" />
                <Stat label="Money out" value={moneyOut} tone="text-[#b42318]" />
                <div className={cn("panel p-4", reviewCount ? "ring-1 ring-[var(--saffron)]" : "")}>
                  <p className="text-xs text-muted-foreground">Lines to review</p>
                  <p className="mt-1 font-display text-xl font-semibold">{reviewCount}</p>
                  <p className="text-xs text-muted-foreground">of {inPeriod.length} in the year</p>
                </div>
              </div>

              <div className="panel space-y-4 p-5">
                <h3 className="font-display font-semibold">How the money is classified</h3>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {[...totals.entries()]
                    .sort((a, b) => Math.abs(b[1].amount) - Math.abs(a[1].amount))
                    .map(([key, total]) => {
                      const category = catOf(key)
                      return (
                        <button key={key} type="button" onClick={() => setView(key)} className={cn("tile text-left", view === key && "tile-active")}>
                          <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            {category?.group ?? ""}
                            <span>{total.count} lines</span>
                          </span>
                          <span className="mt-1 block text-sm font-semibold">{category?.label ?? key}</span>
                          <span className={cn("block font-display text-lg tabular-nums", total.amount < 0 ? "text-[#b42318]" : "text-[#0d7d73]")}>AED {money(total.amount)}</span>
                        </button>
                      )
                    })}
                </div>
              </div>

              <div className="panel space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div role="tablist" aria-label="Show lines" className="track">
                    <button type="button" role="tab" aria-selected={view === "review"} className="track-item" onClick={() => setView("review")}>
                      Under review ({reviewCount})
                    </button>
                    <button type="button" role="tab" aria-selected={view === "all"} className="track-item" onClick={() => setView("all")}>
                      All lines ({inPeriod.length})
                    </button>
                    {view !== "review" && view !== "all" && (
                      <button type="button" role="tab" aria-selected className="track-item">
                        {catOf(view)?.label}
                      </button>
                    )}
                  </div>
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      className="h-10 w-64 max-w-full rounded-xl border bg-white pl-9 pr-3 text-sm"
                      placeholder="Search description or amount"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      aria-label="Search lines"
                    />
                  </label>
                </div>
                {view === "review" && reviewCount > 0 && (
                  <p className="note note-info text-sm">
                    <Wand2 className="mt-0.5 size-4 shrink-0" />
                    <span>Choose what each line is. The choice is applied to every line from the same payer or payee, and remembered for your next statements.</span>
                  </p>
                )}
                {visible.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">{view === "review" ? "Nothing left to review." : "No lines."}</p>
                ) : (
                  <ul className="divide-y rounded-2xl border">
                    {visible.slice(0, shown).map((t) => (
                      <TransactionRow
                        key={t.id}
                        t={t}
                        category={effective(t)}
                        heads={heads}
                        catOf={catOf}
                        onChange={(category) => setCategory(t, category, true)}
                        onAddHead={async (head) => {
                          await onAddHead(head)
                          setCategory(t, `${HEAD_PREFIX}${head.name}`, true)
                        }}
                      />
                    ))}
                  </ul>
                )}
                {visible.length > shown && (
                  <Button variant="outline" size="sm" onClick={() => setShown((n) => n + 100)}>
                    Show more ({visible.length - shown} more)
                  </Button>
                )}
              </div>

              <div className="panel space-y-4 p-5">
                <h3 className="font-display font-semibold">Add to the data input</h3>
                {vatRegistered || vatIncluded ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 accent-[var(--cobalt)]" checked={vatIncluded} onChange={(e) => setVatIncluded(e.target.checked)} />
                    <span>
                      Amounts include 5% VAT. Sales and standard-rated expenses are shown net, and the VAT goes to VAT Control. Salaries, bank charges, government fees, insurance
                      and interest are left as they are.
                    </span>
                  </label>
                ) : null}
                {entryMode === "closing" && Math.abs(openingAed) > 0.5 && (
                  <label className="block text-sm">
                    <span className="text-muted-foreground">
                      The accounts held AED {money(openingAed)} at {formatLongDate(period.start)}. Where did that money come from?
                    </span>
                    <select
                      className="mt-1.5 h-10 w-full max-w-sm rounded-xl border bg-white px-3 text-sm"
                      value={openingSource}
                      onChange={(e) => setOpeningSource(e.target.value as typeof openingSource)}
                    >
                      {OPENING_SOURCES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="text-xs text-muted-foreground">
                  Bank statements show cash only. After adding, enter what customers owed you and what you owed suppliers at year end, stock, and the value of equipment, so the
                  statements are complete.
                </p>
                {hasRows && (
                  <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                    <legend className="mb-2 font-medium">This year already has balances</legend>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="statement-mode" checked={importMode === "replace"} onChange={() => setImportMode("replace")} className="accent-[var(--cobalt)]" />
                      Replace them
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="statement-mode" checked={importMode === "append"} onChange={() => setImportMode("append")} className="accent-[var(--cobalt)]" />
                      Add to them
                    </label>
                  </fieldset>
                )}
                {error && <p className="note note-alert text-sm">{error}</p>}
                <Button onClick={apply} disabled={applying || !ready || inPeriod.length === 0}>
                  {applying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Add {inPeriod.length} lines to {new Date(period.end).getUTCFullYear()}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-xl font-semibold tabular-nums", tone)}>AED {money(value, 0)}</p>
      <p className="text-xs text-muted-foreground">excluding transfers between your accounts</p>
    </div>
  )
}

function FileRow({ file, onPassword, onRemove }: { file: Loaded; onPassword: (password: string) => void; onRemove: () => void }) {
  const [password, setPassword] = useState("")
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border bg-secondary/30 px-3 py-2 text-sm">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
      {file.status === "reading" && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading
        </span>
      )}
      {file.status === "done" && file.parsed && (
        <span className={cn("text-xs", file.parsed.accounts.length ? "text-[#0d7d73]" : "text-[#b42318]")}>
          {file.parsed.accounts.length
            ? `${file.parsed.bank} · ${file.parsed.accounts.reduce((t, a) => t + a.transactions.length, 0)} lines`
            : (file.parsed.warnings[0] ?? "No transactions found")}
        </span>
      )}
      {file.status === "error" && <span className="text-xs text-[#b42318]">{file.error}</span>}
      {file.status === "password" && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) onPassword(password)
          }}
        >
          <KeyRound className="size-4 text-[var(--saffron)]" />
          <input
            type="password"
            autoComplete="off"
            className="h-8 w-40 rounded-lg border bg-white px-2 text-sm"
            placeholder="PDF password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label={`Password for ${file.name}`}
          />
          <Button type="submit" size="sm">
            Open
          </Button>
          {file.error && <span className="text-xs text-[#b42318]">{file.error}</span>}
        </form>
      )}
      <button type="button" onClick={onRemove} className="rounded-lg p-1 text-muted-foreground hover:bg-secondary" aria-label={`Remove ${file.name}`}>
        <Trash2 className="size-4" />
      </button>
    </li>
  )
}

function AccountCard({ account, bank, file, opening, closing, count }: { account: BankAccount; bank: string; file: string; opening: number; closing: number; count: number }) {
  const statedOk = account.statedClosing === null || Math.abs(account.statedClosing - (account.closing ?? 0)) < 0.02
  const ok = account.mismatches === 0 && statedOk
  return (
    <div className={cn("min-w-0 rounded-2xl border p-4", ok ? "bg-[var(--lagoon-wash)]/50" : "bg-[#fdecec]/60")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-white", ok ? "bg-[var(--lagoon)]" : "bg-[#e5484d]")}>
          <Landmark className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {bank} · {account.currency}
            {account.account ? <span className="font-normal text-muted-foreground"> · …{account.account.slice(-4)}</span> : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {file} · {account.from ? `${formatLongDate(account.from)} – ${formatLongDate(account.to)}` : "no transactions"}
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Opening (year)</dt>
          <dd className="font-semibold tabular-nums">{money(opening)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Closing (year)</dt>
          <dd className="font-semibold tabular-nums">{money(closing)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Lines in year</dt>
          <dd className="font-semibold tabular-nums">{count}</dd>
        </div>
      </dl>
      <p className={cn("mt-3 flex items-start gap-1.5 text-xs", ok ? "text-[#0b4d47]" : "text-[#7a1c14]")}>
        {ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <AlertTriangle className="mt-px size-3.5 shrink-0" />}
        {ok
          ? `Every line agrees with the running balance${account.statedClosing !== null ? " and the closing balance printed on the statement" : ""}.`
          : account.mismatches
            ? `${account.mismatches} line${account.mismatches === 1 ? "" : "s"} did not agree with the running balance. Check them in All lines (marked).`
            : `The closing balance on the statement (${money(account.statedClosing ?? 0)}) differs from the lines read (${money(account.closing ?? 0)}).`}
      </p>
    </div>
  )
}

const NEW_HEAD = "__new_head__"
const REPORT_UNDER = scheduleLines.filter((line) => !["bank", "cash"].includes(line.key))

function TransactionRow({
  t,
  category,
  heads,
  catOf,
  onChange,
  onAddHead,
}: {
  t: CategorisedTransaction & { bank: string }
  category: string
  heads: Category[]
  catOf: (key: string) => Category | undefined
  onChange: (category: string) => void
  onAddHead: (head: CustomHead) => Promise<void>
}) {
  const current = catOf(category)
  const suggested = catOf(t.suggested)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [under, setUnder] = useState(t.amount >= 0 ? "otherIncome" : "otherExpenses")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const known = new Set(CATEGORIES.map((c) => c.key))
  return (
    <li className="grid gap-2 px-3 py-2.5 text-sm sm:grid-cols-[6.5rem_1fr_8rem_14rem] sm:items-center">
      <span className="text-xs text-muted-foreground tabular-nums">{formatLongDate(t.date)}</span>
      <span className="min-w-0">
        <span className="line-clamp-2 break-words">{t.description}</span>
        <span className="text-[11px] text-muted-foreground">
          {t.bank} · {t.currency}
          {t.issue ? <span className="ml-1 text-[#b42318]">· {t.issue}</span> : null}
        </span>
      </span>
      <span className={cn("font-semibold tabular-nums sm:text-right", t.amount < 0 ? "text-[#b42318]" : "text-[#0d7d73]")}>{money(t.amount)}</span>
      <span className="relative">
        <select
          aria-label={`Category for ${t.description}`}
          className={cn("h-9 w-full appearance-none rounded-lg border bg-white pl-2.5 pr-8 text-sm", category === "review" && "border-[var(--saffron)] bg-[var(--saffron-wash)]")}
          value={category}
          onChange={(e) => {
            if (e.target.value === NEW_HEAD) {
              setAdding(true)
              return
            }
            onChange(e.target.value)
          }}
        >
          {category === "review" && suggested && <option value={t.suggested}>Suggested: {suggested.label}</option>}
          <optgroup label="Categories">
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Trial balance heads">
            {heads.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
            {!known.has(category) && !heads.some((h) => h.key === category) && <option value={category}>{current?.label ?? category.replace(HEAD_PREFIX, "")}</option>}
          </optgroup>
          <option value={NEW_HEAD}>+ Add a new head…</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        {current && category !== "review" && <span className="sr-only">{current.hint}</span>}
      </span>
      {adding && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-secondary/40 p-3 sm:col-span-4"
          onSubmit={async (e) => {
            e.preventDefault()
            const head = name.trim()
            if (head.length < 2) {
              setError("Enter a name of at least 2 letters.")
              return
            }
            setSaving(true)
            setError("")
            try {
              await onAddHead({ name: head, scheduleKey: under })
              setAdding(false)
              setName("")
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not add the head.")
            } finally {
              setSaving(false)
            }
          }}
        >
          <label className="min-w-48 flex-1 text-xs">
            <span className="text-muted-foreground">New head</span>
            <input autoFocus className="mt-1 h-9 w-full rounded-lg border bg-white px-2.5 text-sm" maxLength={120} placeholder="e.g. Subcontractor charges" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="min-w-48 flex-1 text-xs">
            <span className="text-muted-foreground">Reported under</span>
            <select className="mt-1 h-9 w-full rounded-lg border bg-white px-2.5 text-sm" value={under} onChange={(e) => setUnder(e.target.value)}>
              {REPORT_UNDER.map((line) => (
                <option key={line.key} value={line.key}>
                  {line.label} ({categoryOf(line.key)?.statement === "BS" ? "balance sheet" : "profit & loss"})
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Add head
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <p className="basis-full text-[11px] text-muted-foreground">The head is added to your trial balance list and used for this line and every line from the same payer or payee.</p>
          {error && <p className="basis-full text-xs text-[#b42318]">{error}</p>}
        </form>
      )}
    </li>
  )
}

function coverageOf(accounts: BankAccount[], period: { start: string; end: string }) {
  const months: string[] = []
  const start = new Date(`${period.start}T00:00:00Z`)
  const end = new Date(`${period.end}T00:00:00Z`)
  for (let d = new Date(start); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7))
  const seen = new Set(accounts.flatMap((a) => a.transactions.map((t) => t.date.slice(0, 7))))
  const label = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
  const missing = months.filter((m) => !seen.has(m)).map(label)
  return { missing: missing.length === months.length ? [] : missing, months }
}
