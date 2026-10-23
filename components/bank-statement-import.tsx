"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  CloudUpload,
  FileText,
  KeyRound,
  Landmark,
  Link2,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  Unlink,
  UploadCloud,
  Wand2,
} from "lucide-react"

import { HeadPicker, Modal, SPREADABLE, SpreadChoice } from "@/components/books-shared"
import { InvoiceForm } from "@/components/invoices-workbench"
import type { Company } from "@/lib/company"
import { Button } from "@/components/ui/button"
import type { Books, BooksAction } from "@/lib/books"
import { linkedLine, matchCandidates, sameLine, type LineLink, type MatchCandidate } from "@/lib/books-engine"
import { fetchSeries, rateOn, round2, type RateSeries } from "@/lib/fx"
import { chargesWithVatLine, lawVat, splitVat, type VatAnswer } from "@/lib/vat-rules"
import {
  CATEGORIES,
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
import type { BankSession } from "@/lib/bank-session"
import { mergeStatements, type BankAccount, type MergedAccount, type ParsedStatement } from "@/lib/bank-statement"
import { formatLongDate } from "@/lib/company"
import { categoryOf, scheduleLines } from "@/lib/financial-statements"
import { ledgerHeads, type CustomHead } from "@/lib/ledger-heads"
import { cn } from "@/lib/utils"

type Loaded = {
  id: string
  /** Absent for statements restored from an earlier visit (only their lines are kept). */
  file?: File
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
  sessionKey,
  customHeads,
  onAddHead,
  baseCurrency = "AED",
  company,
}: {
  /** The company, for invoices made from receipts. */
  company?: Company
  /** Everything is converted into this currency, at the rate shown. */
  baseCurrency?: string
  companyName: string
  period: { start: string; end: string }
  entryMode: "closing" | "movement"
  vatRegistered: boolean
  learned: LearnedRule[]
  onSaveRules: (rules: LearnedRule[]) => Promise<void>
  /** Puts the statement balances into the trial balance (replacing earlier statement balances only). */
  onApply: (rows: StatementRows, summary: string, close: boolean) => Promise<void> | void
  /** Where the lines and choices are saved as the user works. */
  sessionKey: { companyId: string; year: number }
  customHeads: CustomHead[]
  onAddHead: (head: CustomHead) => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Loaded[]>([])
  const [dragging, setDragging] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [sessionRules, setSessionRules] = useState<Record<string, string>>({})
  /** Rates the user typed (units of the base currency per unit), replacing the daily rates for that currency. */
  const [rates, setRates] = useState<Record<string, number>>({})
  const [series, setSeries] = useState<Record<string, RateSeries | "failed">>({})
  const [vatChoices, setVatChoices] = useState<Record<string, VatAnswer>>({})
  const [vatRules, setVatRules] = useState<Record<string, VatAnswer>>({})
  const [invoiceFor, setInvoiceFor] = useState<Line | null>(null)
  const [partyRules, setPartyRules] = useState<Record<string, string>>({})
  const [openingSource, setOpeningSource] = useState<(typeof OPENING_SOURCES)[number]["key"]>("retained")
  const [view, setView] = useState<string>("review")
  const [query, setQuery] = useState("")
  const [restoring, setRestoring] = useState(true)
  const [appliedAt, setAppliedAt] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState("")
  const [shown, setShown] = useState(60)
  const [books, setBooks] = useState<Books | null>(null)
  const booksRevision = useRef(0)
  const [prompt, setPrompt] = useState<{ t: Line; category: string; kind: "prepaid" | "asset" } | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

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

  /* ---- invoices, bills and schedules: statement lines can settle them ---- */
  useEffect(() => {
    let cancelled = false
    fetch(`/api/books?companyId=${sessionKey.companyId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.books) return
        booksRevision.current = data.books.revision
        setBooks(data.books)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionKey.companyId])
  async function booksChange(action: BooksAction): Promise<Books> {
    const response = await fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: sessionKey.companyId, revision: booksRevision.current, change: action }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "Could not save.")
    booksRevision.current = data.books.revision
    setBooks(data.books)
    return data.books
  }

  /* ---- saved work: restored on arrival, saved as the user works ---- */
  const sessionUrl = `/api/bank-statements?companyId=${sessionKey.companyId}&year=${sessionKey.year}`
  useEffect(() => {
    let cancelled = false
    fetch(sessionUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { session?: BankSession | null }) => {
        if (cancelled || !data.session) return
        const saved = data.session
        setFiles(saved.files.map((f) => ({ id: f.id, name: f.name, status: "done" as const, parsed: { bank: f.bank, accounts: f.accounts, warnings: f.warnings } })))
        setOverrides(saved.overrides)
        setSessionRules(saved.sessionRules)
        if (saved.version >= 2) setRates(saved.rates)
        setVatChoices(saved.vatChoices)
        setVatRules(saved.vatRules)
        setOpeningSource(saved.openingSource)
        setAppliedAt(saved.appliedAt)
        setView(Object.keys(saved.overrides).length ? "all" : "review")
      })
      .catch(() => {})
      .finally(() => !cancelled && setRestoring(false))
    return () => {
      cancelled = true
    }
  }, [sessionUrl])

  async function clearAll() {
    if (!window.confirm("Remove all uploaded statements and the choices made for this year? Balances already in the trial balance stay.")) return
    await fetch(sessionUrl, { method: "DELETE" }).catch(() => {})
    lastSaved.current = ""
    setFiles([])
    setOverrides({})
    setSessionRules({})
    setAppliedAt(null)
  }

  async function read(entry: Loaded) {
    setFiles((list) => list.map((f) => (f.id === entry.id ? { ...f, status: "reading", error: undefined } : f)))
    try {
      if (!entry.file) return
      const read = await readStatementFile(entry.file, entry.password)
      // Line ids carry the file's id so lines from different statements never share one.
      const parsed = {
        ...read,
        accounts: read.accounts.map((a) => ({ ...a, key: `${entry.id}:${a.key}`, transactions: a.transactions.map((t) => ({ ...t, id: `${entry.id}:${t.id}` })) })),
      }
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
    const known = new Set(files.map((f) => f.name))
    const entries = [...list]
      .filter((file) => !known.has(file.name))
      .slice(0, 24)
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        name: file.name,
        status: "reading" as const,
      }))
    setFiles((current) => [...current, ...entries])
    entries.forEach((entry) => void read(entry))
  }

  // Statements of one account, uploaded in any order, become one account in date order.
  const accounts: MergedAccount[] = useMemo(
    () => mergeStatements(files.flatMap((f) => (f.parsed?.accounts ?? []).map((account) => ({ account, bank: f.parsed!.bank, file: f.name })))),
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

  // A line that pays an invoice or bill, or is spread by a schedule, takes that category.
  const links = useMemo(() => {
    const map = new Map<string, LineLink>()
    if (!books) return map
    for (const t of all) {
      const link = linkedLine(books, t)
      if (link) map.set(t.id, link)
    }
    return map
  }, [books, all])
  const effective = (t: (typeof all)[number]) => links.get(t.id)?.category ?? overrides[t.id] ?? sessionRules[patternOf(t.description)] ?? t.category
  const inPeriod = all.filter((t) => t.inPeriod)
  const outside = all.length - inPeriod.length
  const reviewCount = inPeriod.filter((t) => effective(t) === "review").length
  /** Rent, insurance and licences can be spread; fixed assets need a useful life. */
  function choose(t: (typeof all)[number], category: string) {
    const head = catOf(category)
    if (t.amount < 0 && head && books) {
      if (head.scheduleKey === "ppe" && !/allowance|accumulated/i.test(head.ledgerName)) return setPrompt({ t, category, kind: "asset" })
      if (["rent", "insurance", "tradeLicense"].includes(category) || (category.startsWith(HEAD_PREFIX) && SPREADABLE.test(head.ledgerName)))
        return setPrompt({ t, category, kind: "prepaid" })
    }
    setCategory(t, category, true)
  }

  async function linkPayment(t: (typeof all)[number], c: MatchCandidate) {
    const base = round2(Math.abs(t.amount * lineRate(t)))
    // The payment in the document's currency: the line itself when it is in that currency, else converted at the document's rate.
    const amount = (c.currency ?? baseCurrency) === t.currency ? Math.abs(t.amount) : Math.round((base / (c.rate || 1)) * 100) / 100
    await booksChange({
      action: "payment",
      payment: {
        id: crypto.randomUUID(),
        kind: c.kind,
        docId: c.id,
        date: t.date,
        amount,
        baseAmount: base,
        method: "bankLine",
        bankLine: { id: t.id, date: t.date, amount: t.amount, description: t.description.slice(0, 2000) },
        note: "",
      },
    })
  }

  async function unlink(t: (typeof all)[number]) {
    if (!books) return
    const payment = books.payments.find((p) => p.bankLine && sameLine(p.bankLine, t))
    if (payment) return booksChange({ action: "deletePayment", id: payment.id })
    const schedule = books.schedules.find((x) => x.source.type === "bankLine" && sameLine(x.source.line, t))
    if (schedule && window.confirm("Remove the schedule for this line? Its monthly entries are removed too.")) return booksChange({ action: "deleteSchedule", id: schedule.id })
  }

  function setCategory(t: (typeof all)[number], category: string, similar: boolean) {
    setOverrides((o) => ({ ...o, [t.id]: category }))
    const pattern = patternOf(t.description)
    if (similar && pattern) setSessionRules((r) => ({ ...r, [pattern]: category }))
  }

  /* ---- per-account period figures ---- */
  const accountFigures = accounts.map(({ account, bank, files: names, gaps, duplicates }) => {
    const before = account.transactions.filter((t) => t.date < period.start).reduce((s, t) => s + t.amount, 0)
    const within = account.transactions.filter((t) => t.date >= period.start && t.date <= period.end)
    const opening = (account.opening ?? 0) + before
    const closing = opening + within.reduce((s, t) => s + t.amount, 0)
    return { account, bank, file: names.length > 1 ? `${names.length} statements` : names[0], opening, closing, count: within.length, gaps, duplicates }
  })
  const currencies = [...new Set(accounts.map((a) => a.account.currency))]
  // Daily rates into the base currency for every other currency on the statements.
  const foreign = currencies.filter((c) => c !== baseCurrency)
  const vatAed = vatRegistered && baseCurrency !== "AED" ? ["AED"] : []
  const seriesKey = [...foreign, ...vatAed.map((c) => `>${c}`)].join(",")
  useEffect(() => {
    if (!seriesKey) return
    let cancelled = false
    const from = new Date(`${period.start}T00:00:00Z`)
    from.setUTCDate(from.getUTCDate() - 7)
    const start = from.toISOString().slice(0, 10)
    for (const key of seriesKey.split(",")) {
      const [a, b] = key.startsWith(">") ? [baseCurrency, key.slice(1)] : [key, baseCurrency]
      fetchSeries(a, b, start, period.end)
        .then((r) => !cancelled && setSeries((x) => ({ ...x, [key]: r })))
        .catch(() => !cancelled && setSeries((x) => ({ ...x, [key]: "failed" })))
    }
    return () => {
      cancelled = true
    }
  }, [seriesKey, baseCurrency, period.start, period.end])
  const seriesOf = (c: string) => (typeof series[c] === "object" ? (series[c] as RateSeries) : undefined)
  /** Units of the base currency per unit of `c` on a date: the user's rate, else that day's rate. */
  const rateAt = (c: string, date: string) => (c === baseCurrency ? 1 : rates[c] || rateOn(seriesOf(c), date))
  const lineRate = (t: { currency: string; date: string }) => rateAt(t.currency, t.date)
  const toAed = (amount: number, date: string) => (baseCurrency === "AED" ? amount : amount * (rateOn(seriesOf(">AED"), date) || 0))
  const missingRates = foreign.filter((c) => !rates[c] && (!seriesOf(c) || !Object.keys(seriesOf(c)!.rates).length))
  const matches =
    books && (books.invoices.length || books.bills.length)
      ? inPeriod
          .filter((t) => !links.has(t.id) && !dismissed.has(t.id) && !["transfer", "reversed"].includes(effective(t)))
          .map((t) => ({ t, candidates: matchCandidates(books, { ...t, amount: t.amount * lineRate(t), original: { amount: t.amount, currency: t.currency }, base: baseCurrency }) }))
          .filter((m) => m.candidates.length)
      : []
  // Balances at the rates on the first and last day of the year; lines at the rate of their day.
  const openingAed = accountFigures.reduce((s, a) => s + a.opening * rateAt(a.account.currency, period.start), 0)
  const closingAed = accountFigures.reduce((s, a) => s + a.closing * rateAt(a.account.currency, period.end), 0)
  const coverage = coverageOf(
    accounts.map((a) => a.account),
    period,
  )

  /* ---- VAT on each line ---- */
  const separateVat = useMemo(() => chargesWithVatLine(inPeriod, (t) => effective(t) === "vatPaid"), [inPeriod, overrides, sessionRules, links]) // eslint-disable-line react-hooks/exhaustive-deps
  const learnedVat = useMemo(() => new Map(learned.filter((r) => r.vat).map((r) => [r.pattern, r.vat!])), [learned])
  /** "incl" / "none", or null while the user has not said. */
  const vatOf = (t: (typeof all)[number]): VatAnswer | null => {
    if (!vatRegistered) return "none"
    const category = effective(t)
    const head = catOf(category)
    const law = lawVat(category, head?.scheduleKey ?? "")
    if (law) return law
    if (separateVat.has(t.id)) return "none"
    const pattern = patternOf(t.description)
    return vatChoices[t.id] ?? vatRules[pattern] ?? learnedVat.get(pattern) ?? null
  }
  function setVat(t: (typeof all)[number], answer: VatAnswer) {
    setVatChoices((v) => ({ ...v, [t.id]: answer }))
    const pattern = patternOf(t.description)
    if (pattern) setVatRules((r) => ({ ...r, [pattern]: answer }))
  }
  const isSales = (t: (typeof all)[number]) => {
    const key = effective(t)
    return key === "sales" || (key.startsWith(HEAD_PREFIX) && catOf(key)?.scheduleKey === "sales")
  }
  const unbilledSales = books ? inPeriod.filter((t) => t.amount > 0 && isSales(t) && !links.has(t.id)) : []
  const vatToAnswer = inPeriod.filter((t) => vatOf(t) === null && effective(t) !== "review")
  const vatItems = inPeriod.flatMap((t) => {
    const category = effective(t)
    const base = round2(t.amount * lineRate(t))
    if (category === "vatPaid")
      return [{ id: t.id, date: t.date, description: t.description.slice(0, 300), kind: "input" as const, net: 0, vat: -base, netAed: 0, vatAed: Math.round(-toAed(base, t.date) * 100) / 100 }]
    if (vatOf(t) !== "incl") return []
    const { net, vat } = splitVat(base)
    return [
      {
        id: t.id,
        date: t.date,
        description: t.description.slice(0, 300),
        kind: base > 0 ? ("output" as const) : ("input" as const),
        net: Math.abs(net),
        vat: Math.abs(vat),
        netAed: Math.round(Math.abs(toAed(net, t.date)) * 100) / 100,
        vatAed: Math.round(Math.abs(toAed(vat, t.date)) * 100) / 100,
      },
    ]
  })

  const counted = (t: (typeof all)[number]) => !["transfer", "reversed"].includes(effective(t))
  const moneyIn = inPeriod.filter((t) => t.amount > 0 && counted(t)).reduce((s, t) => s + t.amount * lineRate(t), 0)
  const moneyOut = inPeriod.filter((t) => t.amount < 0 && counted(t)).reduce((s, t) => s + t.amount * lineRate(t), 0)

  function buildRows() {
    const out = new Map<string, { ledgerName: string; amount: number; scheduleKey: string }>()
    const push = (ledgerName: string, scheduleKey: string, amount: number) => {
      const key = `${ledgerName}|${scheduleKey}`
      const entry = out.get(key) ?? { ledgerName, scheduleKey, amount: 0 }
      entry.amount += amount
      out.set(key, entry)
    }
    let pending = 0
    let lines = 0
    for (const t of inPeriod) {
      const key = effective(t)
      // Each line to the fils in the base currency, as the invoices and bills it settles are.
      const amount = round2(t.amount * lineRate(t))
      lines += amount
      if (key === "review" || key === "reversed") {
        pending += amount
        continue
      }
      const category = catOf(key)
      if (!category?.ledgerName) continue
      if (vatOf(t) === "incl") {
        const { net, vat } = splitVat(amount)
        push("VAT Control", "taxPayable", -vat)
        push(category.ledgerName, category.scheduleKey, -net)
      } else push(category.ledgerName, category.scheduleKey, -amount)
    }
    // Foreign currency balances valued at the year-end rate: the change in value is an exchange gain or loss.
    const exchange = Math.round((closingAed - openingAed - lines) * 100) / 100
    if (foreign.length && Math.abs(exchange) >= 0.01) push("Exchange Gain / (Loss)", "exchange", -exchange)
    // Lines still under review are left in the bank so the figures balance; they are reported in the summary.
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

  async function saveRules() {
    const rules = new Map(learned.map((r) => [r.pattern, { ...r }]))
    const put = (pattern: string, patch: Partial<LearnedRule>) => rules.set(pattern, { ...(rules.get(pattern) ?? { pattern, category: "review" }), ...patch })
    for (const [pattern, category] of Object.entries(sessionRules)) put(pattern, { category })
    for (const t of inPeriod) {
      const chosen = overrides[t.id]
      const pattern = patternOf(t.description)
      if (chosen && pattern && chosen !== "review") put(pattern, { category: chosen })
    }
    for (const [pattern, vat] of Object.entries(vatRules)) if (rules.has(pattern) || sessionRules[pattern]) put(pattern, { vat })
    for (const [pattern, party] of Object.entries(partyRules)) put(pattern, { party, category: rules.get(pattern)?.category ?? "sales" })
    const merged = [...rules.values()].filter((r) => r.category !== "review" || r.vat).slice(-3000)
    if (JSON.stringify(merged) !== JSON.stringify(learned)) await onSaveRules(merged)
  }
  // Every choice is remembered for this payer or payee straight away, for later statements and years.
  const rulesSignature = JSON.stringify([sessionRules, vatRules, partyRules])
  const firstRules = useRef(true)
  useEffect(() => {
    if (restoring) return
    if (firstRules.current) {
      firstRules.current = false
      return
    }
    const timer = setTimeout(() => void saveRules().catch(() => {}), 1500)
    return () => clearTimeout(timer)
  }, [rulesSignature, restoring]) // eslint-disable-line react-hooks/exhaustive-deps

  const sessionBody = useMemo(() => {
    if (restoring) return ""
    const session: BankSession = {
      files: files
        .filter((f) => f.status === "done" && f.parsed && f.parsed.accounts.length)
        .map((f) => ({ id: f.id, name: f.name, bank: f.parsed!.bank, warnings: f.parsed!.warnings.slice(0, 10), accounts: f.parsed!.accounts })),
      overrides,
      sessionRules,
      rates,
      vatIncluded: false,
      openingSource,
      appliedAt,
      version: 2,
      vatChoices,
      vatRules,
      vatItems,
    }
    return JSON.stringify(session)
  }, [restoring, files, overrides, sessionRules, rates, openingSource, appliedAt, vatChoices, vatRules, JSON.stringify(vatItems)]) // eslint-disable-line react-hooks/exhaustive-deps
  const lastSaved = useRef("")
  useEffect(() => {
    if (!sessionBody || sessionBody === lastSaved.current) return
    const timer = setTimeout(async () => {
      setSaveState("saving")
      try {
        const response = await fetch(sessionUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: sessionBody })
        if (!response.ok) throw new Error()
        lastSaved.current = sessionBody
        setSaveState("saved")
      } catch {
        setSaveState("error")
      }
    }, 700)
    return () => clearTimeout(timer)
  }, [sessionBody, sessionUrl])
  // Leaving the page with a change not yet saved: send it on the way out.
  const pendingBody = useRef("")
  useEffect(() => {
    pendingBody.current = sessionBody
  }, [sessionBody])
  useEffect(() => {
    const flush = () => {
      const body = pendingBody.current
      if (!body || body === lastSaved.current) return
      fetch(sessionUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000 }).catch(() => {})
    }
    window.addEventListener("pagehide", flush)
    return () => {
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [sessionUrl])

  const summaryText = (count: number) =>
    `${inPeriod.length} bank lines from ${accounts.length} account${accounts.length === 1 ? "" : "s"} are in the trial balance as ${count} balances.${reviewCount ? ` ${reviewCount} lines still under review are held in "Suspense (bank lines under review)".` : ""}${outside ? ` ${outside} lines outside ${formatLongDate(period.start)} – ${formatLongDate(period.end)} were left out.` : ""}`

  async function apply() {
    setApplying(true)
    setError("")
    try {
      await saveRules()
      const rows = buildRows()
      setAppliedAt(new Date().toISOString())
      await onApply(rows, summaryText(rows.length), true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the figures.")
    } finally {
      setApplying(false)
    }
  }

  // Once the statements are in the trial balance, later changes here update it straight away.
  const builtSignature = restoring || !appliedAt || !inPeriod.length ? "" : JSON.stringify(buildRows())
  const lastApplied = useRef("")
  useEffect(() => {
    if (!builtSignature) return
    if (!lastApplied.current) {
      lastApplied.current = builtSignature
      return
    }
    if (builtSignature === lastApplied.current) return
    const timer = setTimeout(() => {
      lastApplied.current = builtSignature
      const rows = JSON.parse(builtSignature) as StatementRows
      void saveRules().catch(() => {})
      void onApply(rows, summaryText(rows.length), false)
    }, 900)
    return () => clearTimeout(timer)
  }, [builtSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = inPeriod
    .filter((t) => (view === "all" ? true : view === "vat" ? vatOf(t) === null && effective(t) !== "review" : effective(t) === view))
    .filter((t) => !query || `${t.description} ${t.amount}`.toLowerCase().includes(query.toLowerCase()))
  const ready = files.length > 0 && files.every((f) => f.status === "done" || f.status === "error")

  return (
    <section aria-label="Upload bank statements" className="space-y-5">
      <div className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold">
              Bank statements
              {saveState !== "idle" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    saveState === "error"
                      ? "bg-[#fdecec] text-[#b42318]"
                      : saveState === "saving"
                        ? "bg-[var(--cobalt-wash)] text-[var(--cobalt)]"
                        : "bg-[var(--lagoon-wash)] text-[#0d7d73]",
                  )}
                >
                  {saveState === "saving" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : saveState === "error" ? (
                    <AlertTriangle className="size-3" />
                  ) : (
                    <CloudUpload className="size-3" />
                  )}
                  {saveState === "saving" ? "Saving" : saveState === "error" ? "Not saved, will retry on next change" : "Saved"}
                </span>
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              Upload every statement for {formatLongDate(period.start)} – {formatLongDate(period.end)}: all months and all accounts. PDF from online banking, Excel or CSV. Files
              are read on this device; the lines and your choices are saved with the company as you work.
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
              {accountFigures.map(({ account, bank, file, opening, closing, count, gaps, duplicates }) => (
                <AccountCard key={account.key} account={account} bank={bank} file={file} opening={opening} closing={closing} count={count} gaps={gaps} duplicates={duplicates} />
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
            {foreign.length > 0 && (
              <div className="space-y-2 rounded-xl border bg-muted/20 p-3 text-sm">
                <p className="font-medium">Converted into {baseCurrency}</p>
                <p className="text-xs text-muted-foreground">
                  Each line uses the rate of its own day (European Central Bank reference rates; AED and the Gulf currencies at their fixed dollar pegs). Balances use the rates on {formatLongDate(period.start)} and {formatLongDate(period.end)}, and the
                  difference goes to Exchange Gain / (Loss). Type a rate to use one rate for every line instead.
                </p>
                {foreign.map((c) => {
                  const sr = seriesOf(c)
                  const state = series[c]
                  return (
                    <div key={c} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="w-12 font-semibold">{c}</span>
                      {state === undefined ? (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" /> Fetching rates
                        </span>
                      ) : sr ? (
                        <span className="text-muted-foreground">
                          1 {c} = {rateAt(c, period.start).toLocaleString("en-US", { maximumFractionDigits: 6 })} {baseCurrency} on {formatLongDate(period.start)} ·{" "}
                          {rateAt(c, period.end).toLocaleString("en-US", { maximumFractionDigits: 6 })} on {formatLongDate(period.end)}
                          {sr.source === "fallback" ? <span className="ml-1 font-medium text-[#b42318]">(approximate: check or type the rate)</span> : sr.source === "peg" ? " (fixed peg)" : " (ECB)"}
                        </span>
                      ) : (
                        <span className="font-medium text-[#b42318]">No rate available: type the rate to use</span>
                      )}
                      <label className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Own rate</span>
                        <input
                          type="number"
                          step="0.000001"
                          min="0"
                          aria-label={`Rate for ${c} in ${baseCurrency}`}
                          className="h-8 w-28 rounded-lg border bg-white px-2 text-sm"
                          value={rates[c] ?? ""}
                          placeholder="daily"
                          onChange={(e) =>
                            setRates((r) => {
                              const next = { ...r }
                              if (e.target.value === "" || !(Number(e.target.value) > 0)) delete next[c]
                              else next[c] = Number(e.target.value)
                              return next
                            })
                          }
                        />
                      </label>
                    </div>
                  )
                })}
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

              {vatRegistered && (vatToAnswer.length > 0 || unbilledSales.length > 0) && (
                <div className="note note-warning items-start text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div className="space-y-1">
                    {vatToAnswer.length > 0 && (
                      <p>
                        <strong>{vatToAnswer.length} line{vatToAnswer.length === 1 ? "" : "s"}</strong> with no matching invoice or bill: say whether each amount includes 5% VAT, so your VAT return is complete.{" "}
                        <button type="button" className="font-semibold underline" onClick={() => setView("vat")}>
                          Show them
                        </button>
                      </p>
                    )}
                    {unbilledSales.length > 0 && (
                      <p>
                        <strong>{unbilledSales.length} receipt{unbilledSales.length === 1 ? "" : "s"}</strong> sorted as sales have no invoice in Bayani. Create the invoice from the line, or mark whether the amount includes VAT.
                      </p>
                    )}
                    <p className="text-xs opacity-80">Salaries, transfers between your accounts, owner and loan movements, government fees and tax payments are settled as no VAT automatically.</p>
                  </div>
                </div>
              )}

              {matches.length > 0 && (
                <MatchPanel matches={matches} onLink={(t, c) => linkPayment(t as (typeof all)[number], c)} onDismiss={(id) => setDismissed((d) => new Set([...d, id]))} />
              )}

              <div className="panel space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div role="tablist" aria-label="Show lines" className="track">
                    <button type="button" role="tab" aria-selected={view === "review"} className="track-item" onClick={() => setView("review")}>
                      Under review ({reviewCount})
                    </button>
                    <button type="button" role="tab" aria-selected={view === "all"} className="track-item" onClick={() => setView("all")}>
                      All lines ({inPeriod.length})
                    </button>
                    {vatRegistered && (
                      <button type="button" role="tab" aria-selected={view === "vat"} className="track-item" onClick={() => setView("vat")}>
                        VAT to answer ({vatToAnswer.length})
                      </button>
                    )}
                    {view !== "review" && view !== "all" && view !== "vat" && (
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
                        link={links.get(t.id)}
                        onUnlink={() => void unlink(t).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not unlink."))}
                        onChange={(category) => choose(t, category)}
                        vat={vatOf(t)}
                        vatAuto={vatRegistered && Boolean(lawVat(effective(t), catOf(effective(t))?.scheduleKey ?? "") || separateVat.has(t.id))}
                        vatRegistered={vatRegistered}
                        onVat={(answer) => setVat(t, answer)}
                        baseCurrency={baseCurrency}
                        rate={lineRate(t)}
                        onCreateInvoice={books && company && t.amount > 0 && !links.get(t.id) && isSales(t) ? () => setInvoiceFor(t) : undefined}
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
                {vatRegistered && (
                  <p className="text-sm text-muted-foreground">
                    VAT in these lines: {money(vatItems.filter((v) => v.kind === "output").reduce((t, v) => t + v.vat, 0))} on income and {money(vatItems.filter((v) => v.kind === "input").reduce((t, v) => t + v.vat, 0))}{" "}
                    on expenses ({baseCurrency}), posted to VAT Control and listed for the VAT return.
                    {vatToAnswer.length > 0 && ` ${vatToAnswer.length} lines without an answer are counted without VAT.`}
                  </p>
                )}
                {missingRates.length > 0 && <p className="note note-alert text-sm">Type the rate for {missingRates.join(", ")} above: lines in that currency cannot be converted into {baseCurrency} without it.</p>}
                {entryMode === "closing" && Math.abs(openingAed) > 0.5 && (
                  <label className="block text-sm">
                    <span className="text-muted-foreground">
                      The accounts held {baseCurrency} {money(openingAed)} at {formatLongDate(period.start)}. Where did that money come from?
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
                <p className="text-xs text-muted-foreground">
                  Statement balances replace only earlier statement balances in the trial balance; balances you entered yourself stay.
                  {appliedAt ? " These lines are already in the trial balance: every change you make here updates it and is saved automatically." : ""}
                </p>
                {error && <p className="note note-alert text-sm">{error}</p>}
                <Button onClick={apply} disabled={applying || !ready || inPeriod.length === 0 || missingRates.length > 0}>
                  {applying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {appliedAt
                    ? `Update the ${new Date(period.end).getUTCFullYear()} trial balance now`
                    : `Add ${inPeriod.length} lines to the ${new Date(period.end).getUTCFullYear()} trial balance`}
                </Button>
                {files.length > 0 && (
                  <Button variant="ghost" onClick={() => void clearAll()}>
                    <Trash2 className="size-4" /> Remove all statements
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
      {invoiceFor && company && books && (
        <Modal title="Create the invoice for this receipt" onClose={() => setInvoiceFor(null)} wide>
          <p className="mb-4 rounded-xl border bg-muted/30 p-3 text-sm">
            {formatLongDate(invoiceFor.date)} · {invoiceFor.description} · <strong>{invoiceFor.currency} {money(invoiceFor.amount)}</strong>
          </p>
          <InvoiceForm
            company={company}
            books={books}
            change={booksChange}
            initial={null}
            prefill={(() => {
              const pattern = patternOf(invoiceFor.description)
              const known = partyRules[pattern] ?? learned.find((r) => r.pattern === pattern)?.party
              const clientId = known && books.clients.some((c) => c.id === known) ? known : undefined
              const gross = Math.abs(invoiceFor.amount)
              const standard = vatRegistered
              return {
                clientId,
                clientName: clientId ? undefined : payerName(invoiceFor.description),
                date: invoiceFor.date,
                currency: invoiceFor.currency,
                lines: [{ id: crypto.randomUUID(), item: "", description: "", quantity: 1, rate: Math.round((standard ? gross / 1.05 : gross) * 100) / 100, vat: standard ? "standard" : "outOfScope" }],
              }
            })()}
            onDone={async (id, invoice) => {
              const t = invoiceFor
              const gross = Math.round(Math.abs(t.amount) * 100) / 100
              const base = round2(Math.abs(t.amount * lineRate(t)))
              await booksChange({
                action: "payment",
                payment: { id: crypto.randomUUID(), kind: "invoice", docId: id, date: t.date, amount: gross, baseAmount: base, method: "bankLine", bankLine: { id: t.id, date: t.date, amount: t.amount, description: t.description.slice(0, 2000) }, note: "" },
              })
              const pattern = patternOf(t.description)
              if (pattern) setPartyRules((r) => ({ ...r, [pattern]: invoice.clientId }))
              setInvoiceFor(null)
            }}
          />
        </Modal>
      )}
      {prompt && (
        <SpreadPrompt
          prompt={prompt}
          amount={Math.abs(prompt.t.amount * lineRate(prompt.t)) / (prompt.kind === "asset" && vatOf(prompt.t as (typeof all)[number]) === "incl" ? 1.05 : 1)}
          label={catOf(prompt.category)?.ledgerName ?? ""}
          onClose={() => setPrompt(null)}
          onFull={() => {
            setCategory(prompt.t as (typeof all)[number], prompt.category, true)
            setPrompt(null)
          }}
          onSpread={async (months, amount) => {
            const head = catOf(prompt.category)!
            const t = prompt.t
            setCategory(t as (typeof all)[number], prompt.category, false)
            await booksChange({
              action: "schedule",
              schedule: {
                id: crypto.randomUUID(),
                kind: prompt.kind === "asset" ? "depreciation" : "prepaid",
                label: `${t.description.slice(0, 120)} (${formatLongDate(t.date)})`,
                ledgerName: prompt.kind === "asset" ? "Depreciation Expense" : head.ledgerName,
                scheduleKey: prompt.kind === "asset" ? "depreciation" : head.scheduleKey,
                amount: Math.round(amount * 100) / 100,
                start: t.date,
                months,
                source: { type: "bankLine", line: { id: t.id, date: t.date, amount: t.amount, description: t.description.slice(0, 2000) } },
              },
            })
            setPrompt(null)
          }}
        />
      )}
    </section>
  )
}

type Line = CategorisedTransaction & { bank: string }

/** The payer's name from a receipt's narrative, as a starting point for a new client. */
function payerName(description: string) {
  const m = description.match(/(?:from|b\/o|by order of|remitter|ordering customer)[:\s]+([A-Z][A-Z0-9&.,' -]{2,60}?)(?:\s+(?:ref|inv|invoice|ac|a\/c|iban|\d{4,})|$)/i)
  const name = (m?.[1] ?? description.replace(/\b(inward|outward|tt|transfer|trf|remittance|credit|ipp|uaefts|aani|swift|ref|payment|received|deposit)\b/gi, " ").replace(/[^A-Za-z&.' -]+/g, " "))
    .replace(/\s+/g, " ")
    .trim()
  return name.slice(0, 80)
}

function MatchPanel({
  matches,
  onLink,
  onDismiss,
}: {
  matches: { t: Line; candidates: MatchCandidate[] }[]
  onLink: (t: Line, c: MatchCandidate) => Promise<void>
  onDismiss: (id: string) => void
}) {
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [choice, setChoice] = useState<Record<string, string>>({})
  return (
    <div className="panel space-y-3 border-[var(--cobalt)]/40 p-5 ring-1 ring-[var(--cobalt)]/30">
      <h3 className="flex items-center gap-2 font-display font-semibold">
        <BellRing className="size-4 text-[var(--cobalt)]" /> Match found: {matches.length} line{matches.length === 1 ? "" : "s"} may settle your invoices or bills
      </h3>
      <p className="text-sm text-muted-foreground">
        Linking marks the invoice or bill paid and posts the line against the receivable or payable instead of sales or expenses, so nothing is counted twice.
      </p>
      {error && <p className="note note-alert text-sm">{error}</p>}
      <ul className="divide-y rounded-2xl border">
        {matches.slice(0, 30).map(({ t, candidates }) => {
          const picked = candidates.find((c) => c.id === choice[t.id]) ?? candidates[0]
          return (
            <li key={t.id} className="grid gap-2 px-3 py-2.5 text-sm lg:grid-cols-[1fr_auto_1.2fr_auto] lg:items-center">
              <span className="min-w-0">
                <span className="line-clamp-1 break-words">{t.description}</span>
                <span className="text-[11px] text-muted-foreground">{formatLongDate(t.date)}</span>
              </span>
              <span className={cn("font-semibold tabular-nums", t.amount < 0 ? "text-[#b42318]" : "text-[#0d7d73]")}>{money(t.amount)}</span>
              <select
                aria-label="Invoice or bill"
                className="h-9 min-w-0 rounded-lg border bg-white px-2 text-sm"
                value={picked.id}
                onChange={(e) => setChoice((c) => ({ ...c, [t.id]: e.target.value }))}
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind === "invoice" ? "Invoice" : "Bill"} {c.number} · {c.party} · due {money(c.due)}
                    {c.reason === "both" ? " (amount and name)" : c.reason === "amount" ? " (same amount)" : " (name)"}
                  </option>
                ))}
              </select>
              <span className="flex gap-1.5">
                <Button
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    setBusy(t.id)
                    setError("")
                    try {
                      await onLink(t, picked)
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Could not link.")
                    } finally {
                      setBusy("")
                    }
                  }}
                >
                  {busy === t.id ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Link
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDismiss(t.id)}>
                  Not this
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SpreadPrompt({
  prompt,
  amount,
  label,
  onClose,
  onFull,
  onSpread,
}: {
  prompt: { t: Line; kind: "prepaid" | "asset" }
  amount: number
  label: string
  onClose: () => void
  onFull: () => void
  onSpread: (months: number, amount: number) => Promise<void>
}) {
  const [months, setMonths] = useState<number | null>(prompt.kind === "asset" ? 60 : 12)
  const [value, setValue] = useState(String(Math.round(amount * 100) / 100))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  return (
    <Modal title={prompt.kind === "asset" ? "Depreciate this asset" : `Expense in full or spread?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="rounded-xl border bg-muted/30 p-3">
          {formatLongDate(prompt.t.date)} · {prompt.t.description} · <strong>{money(prompt.t.amount)}</strong>
        </p>
        <p>
          {prompt.kind === "asset"
            ? "A fixed asset is not an expense when bought: it is depreciated over its useful life. Choose the life, and Bayani posts the depreciation every month."
            : `${label} is usually paid for a period ahead. Spread it over the months it covers, or expense it in full now?`}
        </p>
        <SpreadChoice kind={prompt.kind} months={months} onChange={setMonths} amount={Number(value) || 0} />
        {months && (
          <label className="block">
            <span className="text-xs text-muted-foreground">{prompt.kind === "asset" ? "Cost to depreciate (AED, before VAT)" : "Amount to spread (AED)"}</span>
            <input inputMode="decimal" className="mt-1 h-9 w-40 rounded-lg border px-2" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        {error && <p className="text-[#b42318]">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {prompt.kind === "prepaid" && (
            <Button variant="outline" onClick={onFull}>
              Expense in full
            </Button>
          )}
          <Button
            disabled={!months || saving}
            onClick={async () => {
              setSaving(true)
              setError("")
              try {
                await onSpread(months!, Number(value) || 0)
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not save.")
                setSaving(false)
              }
            }}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {prompt.kind === "asset" ? "Save and depreciate" : months ? `Spread over ${months} months` : "Spread"}
          </Button>
        </div>
      </div>
    </Modal>
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

function AccountCard({
  account,
  bank,
  file,
  opening,
  closing,
  count,
  gaps,
  duplicates,
}: {
  account: BankAccount
  bank: string
  file: string
  opening: number
  closing: number
  count: number
  gaps: MergedAccount["gaps"]
  duplicates: number
}) {
  const statedOk = account.statedClosing === null || Math.abs(account.statedClosing - (account.closing ?? 0)) < 0.02
  const ok = account.mismatches === 0 && statedOk && gaps.length === 0
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
            : gaps.length
              ? `Statements are in date order, but ${gaps.length === 1 ? "one statement does" : `${gaps.length} statements do`} not open where the previous one closed: a statement is probably missing.`
              : `The closing balance on the statement (${money(account.statedClosing ?? 0)}) differs from the lines read (${money(account.closing ?? 0)}).`}
      </p>
      {gaps.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-[#7a1c14]">
          {gaps.map((g) => (
            <li key={`${g.after}-${g.before}`}>
              Closed {money(g.closed)} on {formatLongDate(g.after)}, next opens {money(g.opened)} on {formatLongDate(g.before)}
            </li>
          ))}
        </ul>
      )}
      {duplicates > 0 && <p className="mt-2 text-xs text-muted-foreground">{duplicates} lines appeared in two overlapping statements and were counted once.</p>}
    </div>
  )
}

const REPORT_UNDER = scheduleLines.filter((line) => !["bank", "cash"].includes(line.key))

function TransactionRow({
  t,
  category,
  heads,
  catOf,
  onChange,
  onAddHead,
  link,
  onUnlink,
  vat,
  vatAuto,
  vatRegistered,
  onVat,
  baseCurrency,
  rate,
  onCreateInvoice,
}: {
  vat?: VatAnswer | null
  vatAuto?: boolean
  vatRegistered?: boolean
  onVat?: (answer: VatAnswer) => void
  baseCurrency?: string
  rate?: number
  onCreateInvoice?: () => void
  t: CategorisedTransaction & { bank: string }
  category: string
  heads: Category[]
  catOf: (key: string) => Category | undefined
  onChange: (category: string) => void
  onAddHead: (head: CustomHead) => Promise<void>
  link?: LineLink
  onUnlink?: () => void
}) {
  const current = catOf(category)
  const suggested = catOf(t.suggested)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [under, setUnder] = useState(t.amount >= 0 ? "otherIncome" : "otherExpenses")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
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
      {link ? (
        <span className="flex items-center justify-between gap-2 rounded-lg border border-[var(--lagoon)]/40 bg-[var(--lagoon-wash)] px-2.5 py-1.5 text-xs text-[#0b4d47]">
          <a href={link.href} className="min-w-0 truncate font-medium hover:underline">
            <Link2 className="mr-1 inline size-3.5" />
            {link.label}
          </a>
          <button type="button" aria-label="Unlink" title="Unlink" className="rounded p-0.5 hover:bg-white/60" onClick={onUnlink}>
            <Unlink className="size-3.5" />
          </button>
        </span>
      ) : (
        <HeadPicker
          label={`Category for ${t.description}`}
          className={cn(category === "review" && "[&>button]:border-[var(--saffron)] [&>button]:bg-[var(--saffron-wash)]")}
          value={category === "review" ? "" : (current?.label ?? category.replace(HEAD_PREFIX, ""))}
          placeholder="Search heads, e.g. rent or capital"
          emptyLabel={suggested ? `Under review · suggested: ${suggested.label}` : "Under review"}
          options={[
            ...(category === "review" && suggested ? [{ name: suggested.label, scheduleKey: suggested.scheduleKey, group: "Suggested", key: t.suggested }] : []),
            ...CATEGORIES.filter((c) => !["receivable", "payable", "prepaid"].includes(c.key)).map((c) => ({ name: c.label, scheduleKey: c.scheduleKey, group: `Categories · ${c.group}`, key: c.key })),
            ...heads.map((h) => ({ name: h.label, scheduleKey: h.scheduleKey, group: "Trial balance heads", key: h.key })),
          ]}
          onChange={(option) => onChange(option.key ?? option.name)}
          onCreate={(typed) => {
            setName(typed)
            setAdding(true)
          }}
        />
      )}
      {((baseCurrency && t.currency !== baseCurrency) || (vatRegistered && !link && category !== "review" && !vatAuto) || onCreateInvoice) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:col-span-4 sm:pl-[6.5rem]">
          {baseCurrency && t.currency !== baseCurrency && (
            <span className="text-muted-foreground">
              {t.currency} {money(t.amount)} × {(rate ?? 0).toLocaleString("en-US", { maximumFractionDigits: 6 })} = <strong className="text-foreground">{baseCurrency} {money(t.amount * (rate ?? 0))}</strong>
            </span>
          )}
          {vatRegistered && !link && category !== "review" && !vatAuto && (
            <span className={cn("inline-flex items-center gap-1 rounded-full border p-0.5", vat === null && "border-[var(--saffron)] bg-[var(--saffron-wash)]")} role="group" aria-label={`VAT for ${t.description}`}>
              {vat === null && <span className="px-1.5 font-medium text-[#6b4500]">VAT?</span>}
              {(
                [
                  ["incl", "Includes 5% VAT"],
                  ["none", "No VAT"],
                ] as const
              ).map(([answer, label]) => (
                <button
                  key={answer}
                  type="button"
                  aria-pressed={vat === answer}
                  onClick={() => onVat?.(answer)}
                  className={cn("rounded-full px-2.5 py-1", vat === answer ? "bg-[var(--ink)] font-semibold text-white" : "hover:bg-muted")}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
          {onCreateInvoice && (
            <button type="button" onClick={onCreateInvoice} className="inline-flex items-center gap-1 rounded-full border border-[var(--cobalt)]/40 px-2.5 py-1 font-medium text-[var(--cobalt)] hover:bg-[var(--cobalt-wash)]">
              No invoice found · Create invoice
            </button>
          )}
        </div>
      )}
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
            <input
              autoFocus
              className="mt-1 h-9 w-full rounded-lg border bg-white px-2.5 text-sm"
              maxLength={120}
              placeholder="e.g. Subcontractor charges"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
          <p className="basis-full text-[11px] text-muted-foreground">
            The head is added to your trial balance list and used for this line and every line from the same payer or payee.
          </p>
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
