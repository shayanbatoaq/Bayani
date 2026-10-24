/**
 * Bank statement reader. Turns the positioned text of a statement PDF (or the rows of an
 * Excel / CSV export) into transactions, without a template per bank.
 *
 * Every statement is a table with the same few columns under different names: date,
 * description, money out, money in (or one signed amount) and a running balance. The
 * reader finds the header, assigns each word to its nearest column, groups wrapped
 * description lines with their transaction and then proves the result against the
 * running balance: opening balance plus each amount must give the balance on every line.
 * Where the column was misread the balance decides the sign; where it cannot be
 * reconciled the line is flagged instead of guessed.
 */

export type TextItem = { s: string; x: number; y: number; w: number }
export type TextPage = { items: TextItem[]; width: number; height: number }

export type BankTransaction = {
  id: string
  date: string // ISO yyyy-mm-dd
  description: string
  amount: number // + money in, - money out
  balance: number | null
  /** Set when the line did not agree with the running balance. */
  issue?: string
}

export type BankAccount = {
  key: string
  currency: string
  account: string
  opening: number | null
  closing: number | null
  statedOpening: number | null
  statedClosing: number | null
  transactions: BankTransaction[]
  /** Lines proven against the running balance / lines that disagree. */
  verified: number
  mismatches: number
  from: string
  to: string
}

export type ParsedStatement = {
  bank: string
  accounts: BankAccount[]
  warnings: string[]
}

type Role = "date" | "valueDate" | "description" | "debit" | "credit" | "amount" | "balance" | "ref" | "serial" | "drcr" | "other"
type Column = { role: Role; left: number; right: number; center: number; label: string }

const AMOUNT_ROLES: Role[] = ["debit", "credit", "amount", "balance"]
export const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "QAR", "OMR", "KWD", "BHD", "INR", "PKR", "CHF", "JPY", "CNY", "CAD", "AUD", "EGP", "TRY", "SGD", "HKD"]

/* ---------------- primitives ---------------- */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n: number) => String(n).padStart(2, "0")
const fullYear = (y: number) => (y < 100 ? 2000 + y : y)
const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100

/** Parses the date formats UAE banks use; day before month unless that is impossible. */
export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ")
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    let d = +m[1]
    let mo = +m[2]
    const y = fullYear(+m[3])
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]
    return validDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null
  }
  m = s.match(/^(\d{1,2})[ /-]?([A-Za-z]{3,9})\.?[ /,-]*(\d{2,4})$/)
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()]
    const y = fullYear(+m[3])
    return mo && validDate(y, mo, +m[1]) ? `${y}-${pad(mo)}-${pad(+m[1])}` : null
  }
  m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/)
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
    return mo && validDate(+m[3], mo, +m[2]) ? `${m[3]}-${pad(mo)}-${pad(+m[2])}` : null
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/)
  if (m) return validDate(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null
  return null
}

/** Parses 1,234.50 · -1,234.50 · (1,234.50) · 1,234.50 Cr. · Dr.1,234.50 · 1234.5- ; null when not an amount. */
export function parseMoney(raw: string): number | null {
  let s = raw.replace(/\s+/g, "").replace(new RegExp(`^(${CURRENCIES.join("|")})|(${CURRENCIES.join("|")})$`, "g"), "")
  if (!s || !/\d/.test(s)) return null
  let sign = 1
  const dr = /^(Dr\.?|DR\.?)/i
  const cr = /^(Cr\.?|CR\.?)/i
  if (dr.test(s)) {
    sign = -1
    s = s.replace(dr, "")
  } else s = s.replace(cr, "")
  if (/(Dr\.?|DR\.?)$/.test(s)) {
    sign = -sign
    s = s.replace(/(Dr\.?|DR\.?)$/, "")
  } else s = s.replace(/(Cr\.?|CR\.?)$/, "")
  if (/^\(.*\)$/.test(s)) {
    sign = -sign
    s = s.slice(1, -1)
  }
  if (s.startsWith("-")) {
    sign = -sign
    s = s.slice(1)
  } else if (s.endsWith("-")) {
    sign = -sign
    s = s.slice(0, -1)
  } else if (s.startsWith("+")) s = s.slice(1)
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,3})?$/.test(s)) return null
  return sign * Number(s.replace(/,/g, ""))
}

const round2 = (n: number) => Math.round(n * 100) / 100
const close = (a: number, b: number, tolerance = 0.011) => Math.abs(a - b) <= tolerance
const ARABIC = /[؀-ۿﭐ-﷿ﹰ-﻿]+/g

/* ---------------- column headers ---------------- */

const HEADINGS: [Role, RegExp][] = [
  ["valueDate", /^value ?date$/],
  ["date", /^(transaction|txn|trans|posting|post|book|booking|entry)?\.? ?date$/],
  ["balance", /^(running|available|ledger|closing)? ?balance( ?\(?[a-z]{3}\)?)?$/],
  ["debit", /^(debit|debits|withdrawal|withdrawals|money out|dr|payments?|debit amount|withdrawal amount|paid out)( ?\(?[a-z]{3}\)?)?$/],
  ["credit", /^(credit|credits|deposit|deposits|money in|cr|receipts?|credit amount|deposit amount|paid in)( ?\(?[a-z]{3}\)?)?$/],
  ["amount", /^(transaction )?amount( ?\(?incl\.? ?vat\)?)?( ?\(?[a-z]{3}\)?)?$|^(credit ?\/ ?debit|debit ?\/ ?credit)$/],
  ["description", /^(description|narration|narrative|particulars|details|transaction details|remarks|transaction|transaction description|transaction narrative|payment details)$/],
  ["serial", /^(sr\.? ?no\.?|s\.? ?no\.?|serial|#)$/],
  ["ref", /(ref|reference|cheque|chq|inst\.? ?no|txnrefno|instrument)/],
]

function roleOf(label: string): Role {
  const text = label.replace(ARABIC, " ").replace(/[()[\]:*]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
  if (!text) return "other"
  for (const [role, pattern] of HEADINGS) if (pattern.test(text)) return role
  return "other"
}

/**
 * Spreadsheet headings vary more than printed ones ("Tran Dt", "Date & Time", "Withdrawals (AED)",
 * "Beneficiary / Description"): when no exact heading matches, the words in the cell decide.
 */
function looseRoleOf(label: string): Role {
  const exact = roleOf(label)
  if (exact !== "other") return exact
  const text = label.replace(ARABIC, " ").replace(/\s+/g, " ").trim().toLowerCase()
  if (!text || text.length > 40) return "other"
  if (/\bvalue\b.*\b(date|dt)\b/.test(text)) return "valueDate"
  if (/\b(date|dt)\b/.test(text) && !/\b(due|expiry|print|statement|from|to)\b/.test(text)) return "date"
  if (/\b(dr ?\/ ?cr|cr ?\/ ?dr|d ?\/ ?c|c ?\/ ?d|debit ?\/ ?credit (indicator|flag|type)|transaction type|txn type|type)\b/.test(text)) return "drcr"
  if (/balance/.test(text)) return "balance"
  if (/\b(withdrawals?|debits?|money out|paid out|dr amount|outflow)\b/.test(text)) return "debit"
  if (/\b(deposits?|credits?|money in|paid in|cr amount|inflow)\b/.test(text)) return "credit"
  if (/\bamount\b/.test(text)) return "amount"
  if (/\b(description|narration|narrative|particulars|details|remarks|memo|beneficiary|transaction)\b/.test(text)) return "description"
  if (/\b(ref|reference|cheque|chq)\b/.test(text)) return "ref"
  return "other"
}

type Line = { page: number; y: number; items: TextItem[]; text: string }
const isDebitFlag = (v: string) => /^(dr|d|debit|db|withdrawal|out|-)$/i.test(v.trim().replace(/\.$/, ""))
const isCreditFlag = (v: string) => /^(cr|c|credit|deposit|in|\+)$/i.test(v.trim().replace(/\.$/, ""))

function toLines(page: TextPage, pageNo: number): Line[] {
  const items = page.items.filter((i) => i.s.trim()).sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Line[] = []
  for (const item of items) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(item.y - last.y) <= 2.6) last.items.push(item)
    else lines.push({ page: pageNo, y: item.y, items: [item], text: "" })
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    line.text = line.items.map((i) => i.s.trim()).join(" ")
  }
  return lines
}

const HEADING_WORD = /^(\(?(transaction|txn|value|posting|date|dates|amount|amounts|balance|running|available|debit|credit|withdrawals?|deposits?|description|narration|narrative|particulars|details|remarks|reference|ref\.?|referen\w*|no\.?|number|cheque|chq|type|info|incl\.?|vat\)?|[A-Z]{3}|sr\.?|serial)\)?\s*)+$/i
const isDataToken = (s: string) => parseDate(s) !== null || parseMoney(s) !== null || /^\d{1,2}[ -][A-Za-z]{3}-?$/.test(s.trim())

/**
 * A header is a few stacked lines of words that between them name a date column, a
 * balance or amount column and debit/credit or amount columns.
 */
function headerAt(lines: Line[], index: number): { columns: Column[]; last: number } | null {
  const base = lines[index]
  if (!/(balance|amount|debit|credit|withdrawal|deposit)/i.test(base.text)) return null
  const isHeading = (j: number) => {
    const line = lines[j]
    if (!line || line.page !== base.page || line.y - base.y > 26 || base.y - line.y > 12) return false
    if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(line.text)) return false
    if (line.items.some((i) => isDataToken(i.s) && !/^\(?[A-Z]{3}\)?$/.test(i.s.trim()))) return false
    if (j === index) return true
    // Lines above or below must read like headings, not like the first description line.
    const headingLike = line.items.filter((i) => /[^\x20-\x7E]/.test(i.s) || /^[()\s]*$/.test(i.s) || HEADING_WORD.test(i.s.trim()))
    return headingLike.length * 2 >= line.items.length
  }
  if (!isHeading(index)) return null
  // Contiguous heading lines around this one; stop at the first line holding data.
  const window: number[] = [index]
  for (let j = index - 1; j >= index - 3 && isHeading(j); j--) window.unshift(j)
  for (let j = index + 1; j <= index + 4 && isHeading(j); j++) window.push(j)
  const tokens = window.flatMap((j) => lines[j].items.map((item) => ({ ...item, line: j })))
  // Words stacked in the same column form one heading ("Running" / "Balance").
  const groups: { left: number; right: number; parts: typeof tokens }[] = []
  for (const token of [...tokens].sort((a, b) => a.x - b.x)) {
    const right = token.x + Math.max(token.w, 4)
    const group = groups.find((g) => token.x < g.right + 1 && right > g.left - 1 && !g.parts.some((p) => p.line === token.line && Math.abs(p.x - token.x) > 2 && (p.x + p.w < token.x - 3 || token.x + token.w < p.x - 3)))
    if (group) {
      group.left = Math.min(group.left, token.x)
      group.right = Math.max(group.right, right)
      group.parts.push(token)
    } else groups.push({ left: token.x, right, parts: [token] })
  }
  const columns: Column[] = groups
    .map((g) => {
      const label = g.parts
        .sort((a, b) => a.line - b.line || a.x - b.x)
        .map((p) => p.s)
        // Arabic headings (sometimes stored in a broken encoding) are skipped; the English ones name the column.
        .filter((text) => /^[\x20-\x7E]+$/.test(text))
        .join(" ")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
      return { role: roleOf(label), left: g.left, right: g.right, center: (g.left + g.right) / 2, label: label.replace(ARABIC, "").trim() }
    })
    .filter((c) => c.label)
  const roles = new Set(columns.map((c) => c.role))
  const hasMoney = (roles.has("debit") && roles.has("credit")) || roles.has("amount")
  if (!roles.has("date") || !hasMoney || !(roles.has("balance") || (roles.has("debit") && roles.has("credit")))) return null
  // A second plain "Date" under "Value" was merged above; any further date column is the value date.
  const dates = columns.filter((c) => c.role === "date")
  dates.slice(1).forEach((c) => (c.role = "valueDate"))
  return { columns, last: Math.max(...window) }
}

function nearest(columns: Column[], x: number, w: number) {
  const left = x
  const right = x + w
  const center = (left + right) / 2
  let best: Column | null = null
  let score = Infinity
  for (const column of columns) {
    // Prefer overlap; otherwise distance between centres, or edges for right/left aligned text.
    const overlap = Math.min(right, column.right) - Math.max(left, column.left)
    const d = overlap > 0 ? -overlap : Math.min(Math.abs(center - column.center), Math.abs(right - column.right), Math.abs(left - column.left))
    if (d < score) {
      score = d
      best = column
    }
  }
  return best
}

/** The money column a figure belongs to; a figure with decimals drifting under a neighbouring heading still counts. */
function moneyColumn(columns: Column[], item: TextItem) {
  const column = nearest(columns, item.x, item.w)
  if (column && AMOUNT_ROLES.includes(column.role)) return column
  if (!/\.\d{2,3}\b/.test(item.s)) return null
  const money = columns.filter((c) => AMOUNT_ROLES.includes(c.role))
  const near = nearest(money, item.x, item.w)
  if (!near) return null
  const gap = Math.max(near.left - (item.x + item.w), item.x - near.right, 0)
  return gap <= 45 ? near : null
}

/* ---------------- PDF statements ---------------- */

type Txn = {
  date: string
  lineIndex: number
  lines: number[]
  page: number
  opening?: boolean
}

const BREAK = /^(total|totals|sub ?total|closing balance|closing (statement|book|ledger) balance|account (details|title|number|no)|iban|statement of account|end of statement|page \d|carried forward|c\/f\b|transactions details|summary)/i
const OPENING = /(opening balance|\bb\/f\b|previous balance)/i
const CONTINUED = /(brought forward|carried forward|balance forward|\bc\/f\b)/i

export function parsePdfStatement(pages: TextPage[]): ParsedStatement {
  const lines = pages.flatMap((page, i) => toLines(page, i + 1))
  const warnings: string[] = []
  const kind: ("header" | "anchor" | "opening" | "break" | "other")[] = lines.map(() => "other")
  const columnsAt: (Column[] | null)[] = lines.map(() => null)
  const anchors: Txn[] = []
  let columns: Column[] | null = null
  const leads: number[] = []
  let sinceHeader = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i > 0 && line.page !== lines[i - 1].page) sinceHeader = -1
    if (kind[i] === "header") continue
    const header = headerAt(lines, i)
    if (header) {
      columns = header.columns
      for (let j = i; j <= header.last; j++) if (lines[j].page === line.page) kind[j] = "header"
      for (let j = i - 3; j < i; j++) if (j >= 0 && lines[j].page === line.page && Math.abs(lines[j].y - line.y) <= 26 && kind[j] === "other" && !line.items.some((t) => isDataToken(t.s))) kind[j] = "header"
      i = Math.max(i, header.last)
      sinceHeader = 0
      continue
    }
    if (!columns) continue
    columnsAt[i] = columns
    const dateColumn = (item: TextItem) => nearest(columns!, item.x, item.w)?.role === "date"
    let date: string | null = null
    for (const [k, item] of line.items.entries()) {
      if (!dateColumn(item)) continue
      date = parseDate(item.s)
      // "01-Aug-" with the year on the next line.
      if (!date && /^\d{1,2}[ -][A-Za-z]{3}-?$/.test(item.s.trim())) {
        const next = lines[i + 1]
        const year = next?.items.find((t) => /^\d{4}$/.test(t.s.trim()) && Math.abs(t.x - item.x) < 12)
        if (year) date = parseDate(`${item.s.trim().replace(/-$/, "")}-${year.s.trim()}`)
      }
      if (!date && k + 1 < line.items.length) date = parseDate(`${item.s} ${line.items[k + 1].s}`)
      if (date) break
    }
    if (OPENING.test(line.text) && !CONTINUED.test(line.text) && line.items.some((t) => parseMoney(t.s) !== null && nearest(columns!, t.x, t.w)?.role === "balance")) {
      kind[i] = "opening"
      anchors.push({ date: date ?? "", lineIndex: i, lines: [i], page: line.page, opening: true })
      continue
    }
    if (date && line.items.some((t) => parseMoney(t.s) !== null && moneyColumn(columns!, t) !== null) || (date && /^\d{1,2}[ -][A-Za-z]{3}-?$/.test(line.items.find(dateColumn)?.s.trim() ?? ""))) {
      kind[i] = "anchor"
      anchors.push({ date, lineIndex: i, lines: [i], page: line.page })
      if (sinceHeader >= 0) leads.push(sinceHeader)
      sinceHeader = -1
      continue
    }
    if (BREAK.test(line.text.replace(ARABIC, "").trim()) || CONTINUED.test(line.text) || /^\*+/.test(line.text)) {
      kind[i] = "break"
      continue
    }
    if (sinceHeader >= 0) sinceHeader++
  }

  // Description lines between transactions: split each gap at its widest spacing, or, when
  // the lines are evenly spaced, by how many lines usually sit above a date in this layout.
  const lead = leads.length ? leads.sort((a, b) => a - b)[Math.floor(leads.length / 2)] : 0
  const owner = new Map<number, Txn>()
  const byIndex = new Map(anchors.map((a) => [a.lineIndex, a]))
  const hard = (i: number) => kind[i] === "header" || kind[i] === "break" || kind[i] === "opening"
  for (const current of anchors) {
    if (current.opening) continue
    // Lines above a transaction that follows a header, a break or the top of a page; lines
    // between two transactions are split further down.
    const above: number[] = []
    let j = current.lineIndex - 1
    for (; j >= 0; j--) {
      if (lines[j].page !== current.page || hard(j) || byIndex.has(j)) break
      above.unshift(j)
    }
    if (!above.length) continue
    const samePage = j >= 0 && lines[j].page === current.page
    if (samePage && byIndex.has(j) && !byIndex.get(j)!.opening) continue
    const chosen = samePage && kind[j] === "header" ? above : lead ? above.slice(-lead) : []
    for (const k of chosen) {
      if (lines[current.lineIndex].y - lines[k].y > 60) continue
      owner.set(k, current)
      current.lines.push(k)
    }
  }
  for (let a = 0; a < anchors.length; a++) {
    const current = anchors[a]
    if (current.opening) continue
    const after: number[] = []
    let j = current.lineIndex + 1
    for (; j < lines.length; j++) {
      if (lines[j].page !== current.page || hard(j) || byIndex.has(j)) break
      after.push(j)
    }
    const next = byIndex.get(j)
    if (next && !next.opening && lines[j].page === current.page) {
      const ys = [lines[current.lineIndex].y, ...after.map((k) => lines[k].y), lines[j].y]
      const gaps = ys.slice(1).map((y, k) => y - ys[k])
      const sorted = [...gaps].sort((x, y) => y - x)
      let split: number // number of lines that stay with the current transaction
      if (after.length === 0) split = 0
      else if (sorted.length > 1 && sorted[0] >= sorted[1] * 1.2) split = gaps.indexOf(sorted[0])
      else split = Math.max(0, after.length - lead)
      // When the date line carries no figures, the figures below it are this transaction's.
      const hasMoney = (k: number) => lines[k].items.some((item) => parseMoney(item.s) !== null && moneyColumn(columnsAt[k] ?? columnsAt[current.lineIndex]!, item) !== null)
      if (!hasMoney(current.lineIndex)) {
        const firstMoney = after.findIndex((k) => hasMoney(k))
        if (firstMoney >= 0) split = Math.max(split, firstMoney + 1)
      }
      after.forEach((k, n) => {
        const target = n < split ? current : next
        owner.set(k, target)
        target.lines.push(k)
      })
    } else {
      // last transaction on the page / before a break: keep closely following lines
      let previousY = lines[current.lineIndex].y
      const figures = (k: number) => lines[k].items.some((item) => parseMoney(item.s) !== null && moneyColumn(columnsAt[k] ?? columnsAt[current.lineIndex]!, item) !== null)
      let needFigures = !figures(current.lineIndex)
      for (const k of after) {
        if (lines[k].y - previousY > (needFigures ? 40 : 18)) break
        if (figures(k)) needFigures = false
        previousY = lines[k].y
        owner.set(k, current)
        current.lines.push(k)
      }
    }
  }

  // Build transactions
  type Raw = { date: string; description: string; debit: number | null; credit: number | null; amount: number | null; balance: number | null; marker: number; opening: boolean }
  const raw: Raw[] = []
  for (const t of anchors) {
    const cols = columnsAt[t.lineIndex]!
    const ordered = [t.lineIndex, ...t.lines.filter((k) => k !== t.lineIndex).sort((a, b) => a - b)]
    const values: Partial<Record<Role, number>> = {}
    for (const k of ordered) {
      for (const item of lines[k].items) {
        const value = parseMoney(item.s)
        if (value === null) continue
        const column = moneyColumn(cols, item)
        if (!column) continue
        if (values[column.role] !== undefined) continue
        if (k !== t.lineIndex && value === 0) continue
        values[column.role] = value
      }
    }
    const description = [...t.lines]
      .sort((a, b) => lines[a].y - lines[b].y)
      .map((k) =>
        lines[k].items
          .filter((item) => {
            const role = nearest(cols, item.x, item.w)?.role
            if (role === "description") return true
            if (role !== "other") return false
            // unnamed columns before the money columns usually hold beneficiary / narrative text
            const firstMoney = Math.min(...cols.filter((c) => AMOUNT_ROLES.includes(c.role)).map((c) => c.left))
            return item.x < firstMoney
          })
          .map((item) => item.s.replace(ARABIC, "").trim())
          .join(" ")
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    raw.push({
      date: t.date,
      description: t.opening ? "Opening balance" : description,
      debit: values.debit ?? null,
      credit: values.credit ?? null,
      amount: values.amount ?? null,
      balance: values.balance ?? null,
      marker: t.lineIndex,
      opening: Boolean(t.opening),
    })
  }

  // Context outside the transactions: currency, account, stated balances.
  const assigned = new Set<number>([...owner.keys(), ...anchors.map((a) => a.lineIndex)])
  const context = lines.map((line, i) => ({ i, line })).filter(({ i }) => !assigned.has(i) || kind[i] === "opening")
  const bank = detectBank(lines.filter((_, i) => !assigned.has(i)).map((l) => l.text).join("\n"))

  const markers: { index: number; currency?: string; account?: string; opening?: number; closing?: number }[] = []
  for (const { i, line } of context) {
    const text = line.text.replace(ARABIC, " ")
    const currency =
      text.match(/(?:currency|ccy)\s*:?\s*([A-Z]{3})\b/i)?.[1]?.toUpperCase() ??
      text.match(/\b\d{6,}\s*[-–]?\s*([A-Z]{3})\b/)?.[1] ??
      (kind[i] === "header" ? text.match(/\(\s*([A-Z]{3})\s*\)/)?.[1] : undefined) ??
      (line.items.length <= 3 ? line.items.map((t) => t.s.trim()).find((s) => CURRENCIES.includes(s) ) : undefined)
    const account = text.match(/\bAE\d{2}\s?\d{3}\s?\d{4,}[\d\s]*\b/)?.[0].replace(/\s/g, "").slice(0, 23) ?? text.match(/account\s*(?:no\.?|number)\s*[.:]*\s*(\d{6,})/i)?.[1]
    const m: (typeof markers)[number] = { index: i }
    if (currency && CURRENCIES.includes(currency)) m.currency = currency
    if (account) m.account = account
    const labelled = (label: RegExp) => {
      const at = line.items.findIndex((t) => label.test(t.s))
      if (at < 0) return undefined
      const labelItem = line.items[at]
      // figures after the label up to the next label; the last one is the balance column
      const run: number[] = []
      for (const t of line.items.slice(at + 1)) {
        const v = parseMoney(t.s.replace(/\s*(AED|USD|EUR|GBP)$/, ""))
        if (v === null) {
          if (run.length) break
          continue
        }
        run.push(v)
      }
      if (run.length) return run[run.length - 1]
      for (const k of [i + 1, i + 2, i + 3]) {
        const below = lines[k]
        if (!below || below.page !== line.page) break
        const hit = below.items.find((t) => Math.abs(t.x - labelItem.x) < 30 && parseMoney(t.s) !== null)
        if (hit) return parseMoney(hit.s) ?? undefined
      }
      return undefined
    }
    if (kind[i] !== "opening") {
      const o = labelled(/^(opening balance|balance b\/f|previous balance)\s*:?$/i)
      const c = labelled(/^(closing|ledger|closing\s*\(available\))\s*balance\s*:?$/i)
      if (o !== undefined) m.opening = o
      if (c !== undefined) m.closing = c
    }
    if (m.currency || m.account || m.opening !== undefined || m.closing !== undefined) markers.push(m)
  }

  // Split into accounts where the currency or account changes, or a new opening line starts.
  const accounts: BankAccount[] = []
  let currency = "AED"
  let account = ""
  type Section = { rows: Raw[]; currency: string; account: string; statedOpening: number | null; statedClosing: number | null }
  let current = null as Section | null
  const sections: Section[] = []
  let markerAt = 0
  let pendingOpening: number | null = null
  let pendingClosing: number | null = null
  for (const row of raw) {
    while (markerAt < markers.length && markers[markerAt].index < row.marker) {
      const m = markers[markerAt++]
      if (m.currency) currency = m.currency
      if (m.account) account = m.account
      if (m.opening !== undefined) pendingOpening = m.opening
      // A closing figure printed after transactions belongs to the account just listed.
      if (m.closing !== undefined) {
        if (current && current.currency === currency && current.rows.some((r) => !r.opening)) current.statedClosing = m.closing
        else pendingClosing = m.closing
      }
    }
    // Statements issued page by page (each with its own opening balance) continue the same account.
    const last = current ? [...current.rows].reverse().find((r) => r.balance !== null && !r.opening) : undefined
    if (row.opening && current && current.currency === currency && last && row.balance !== null && close(row.balance, last.balance!)) continue
    const changed = !current || current.currency !== currency || (row.opening && current.rows.some((r) => !r.opening))
    if (changed) {
      current = { rows: [], currency, account, statedOpening: pendingOpening, statedClosing: pendingClosing }
      sections.push(current)
      pendingOpening = null
      pendingClosing = null
    } else if (current && !current.account && account) current.account = account
    if (pendingClosing !== null && current!.statedClosing === null) {
      current!.statedClosing = pendingClosing
      pendingClosing = null
    }
    current!.rows.push(row)
  }
  // closing labels printed after the last transaction of a section
  for (const m of markers.slice(markerAt)) {
    if (m.currency) currency = m.currency
    if (m.closing !== undefined && current && current.currency === currency) current.statedClosing = m.closing
  }

  const seq = { n: 0 }
  for (const section of sections) accounts.push(reconcile(section.rows, section.currency, section.account, section.statedOpening, section.statedClosing, seq))
  const usable = accounts.filter((a) => a.transactions.length > 0 || a.opening !== null)
  if (!usable.length) warnings.push("No transaction table was found. If this is a scanned statement, download the statement from online banking as PDF or Excel instead.")
  return { bank, accounts: usable, warnings }
}

/* ---------------- shared reconciliation ---------------- */

type RawRow = { date: string; description: string; debit: number | null; credit: number | null; amount: number | null; balance: number | null; opening: boolean }

/** seq numbers the lines of one statement file, so ids stay short however many files a session reads. */
function reconcile(rows: RawRow[], currency: string, account: string, statedOpening: number | null, statedClosing: number | null, seq: { n: number }): BankAccount {
  const openingRow = rows.find((r) => r.opening)
  let body = rows.filter((r) => !r.opening && r.date)
  // Newest-first statements are put in date order.
  let up = 0
  let down = 0
  for (let i = 1; i < body.length; i++) {
    if (body[i].date > body[i - 1].date) up++
    else if (body[i].date < body[i - 1].date) down++
  }
  if (down > up) body = [...body].reverse()
  // Most banks print debits as positive figures in a debit column; some print them negative.
  // A figure with the other sign in that column is a reversal.
  const debits = body.map((r) => r.debit).filter((d): d is number => d !== null && d !== 0)
  const debitsNegative = debits.filter((d) => d < 0).length > debits.length / 2
  const first = body[0]
  const signed = (r: RawRow) =>
    r.amount !== null ? r.amount : r.debit === null && r.credit === null ? null : round2((r.credit ?? 0) + (r.debit === null ? 0 : debitsNegative ? r.debit : -r.debit))
  let opening: number | null = openingRow?.balance ?? statedOpening
  if (opening === null && first) {
    const amount = signed(first)
    void amount
    if (first.balance !== null && amount !== null) opening = round2(first.balance - amount)
  }
  let previous = opening
  let verified = 0
  let mismatches = 0
  const transactions: BankTransaction[] = []
  for (const r of body) {
    let amount = signed(r)
    // A balance printed as zero beside a movement that cannot reach zero is a blank, not a balance.
    let balance = r.balance === 0 && previous !== null && amount !== null && !close(previous + amount, 0, 0.1) ? null : r.balance
    let issue: string | undefined
    // Information lines (exchange notes, zero-value entries) move no money.
    if (amount === 0 && (balance === null || balance === 0 || (previous !== null && close(balance, previous)))) continue
    if (previous !== null && balance !== null) {
      const delta = round2(balance - previous)
      if (amount === null) {
        amount = delta
        verified++
      } else if (close(delta, amount)) verified++
      else if (close(delta, -amount)) {
        amount = -amount
        verified++
      } else if (close(delta, amount, 0.1)) {
        balance = round2(previous + amount)
        verified++
      } else if (Math.abs(r.debit ?? 0) > 0 && Math.abs(r.credit ?? 0) > 0 && (close(delta, r.credit!) || close(delta, r.debit!))) {
        amount = close(delta, r.credit!) ? r.credit! : r.debit!
        verified++
      } else {
        mismatches++
        issue = `Balance moved by ${delta.toLocaleString("en-US", { minimumFractionDigits: 2 })} but the line shows ${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
        // Trust the printed balance for the next line.
      }
    } else if (balance === null && previous !== null && amount !== null) balance = round2(previous + amount)
    if (amount === null) continue
    if (balance !== null) previous = balance
    else if (previous !== null) previous = round2(previous + amount)
    transactions.push({ id: `t${++seq.n}`, date: r.date, description: r.description || "(no description)", amount: round2(amount), balance, ...(issue ? { issue } : {}) })
  }
  const closing = transactions.length ? (transactions[transactions.length - 1].balance ?? (opening !== null ? round2(opening + transactions.reduce((t, x) => t + x.amount, 0)) : null)) : opening
  return {
    key: `${currency}-${account || "account"}-${seq.n}`,
    currency,
    account,
    opening,
    closing,
    statedOpening,
    statedClosing,
    transactions,
    verified,
    mismatches,
    from: transactions[0]?.date ?? "",
    to: transactions[transactions.length - 1]?.date ?? "",
  }
}

/* ---------------- Excel / CSV statements ---------------- */

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}
function cellMoney(value: unknown): number | null {
  if (typeof value === "number") return value
  return parseMoney(cellText(value))
}
function cellDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "number" && value > 30000 && value < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const text = cellText(value)
  // "03/01/2025 10:22" or "2025-01-03T10:22:00": the date part.
  return parseDate(text) ?? parseDate(text.split(/[ T]/)[0] ?? "")
}

/** Rows of an Excel or CSV export (first row with recognisable headings is the header). */
export function parseTableStatement(rows: unknown[][], name = ""): ParsedStatement {
  let headerRow = -1
  let roles: Role[] = []
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const r = rows[i].map((c) => looseRoleOf(cellText(c)))
    const set = new Set(r)
    if (set.has("date") && ((set.has("debit") && set.has("credit")) || set.has("amount"))) {
      headerRow = i
      roles = r
      const dates = roles.map((role, k) => (role === "date" ? k : -1)).filter((k) => k >= 0)
      dates.slice(1).forEach((k) => (roles[k] = "valueDate"))
      break
    }
  }
  if (headerRow < 0) return { bank: detectBank(name), accounts: [], warnings: ["No header row with a date and amount column was found in this file."] }
  const col = (role: Role) => roles.indexOf(role)
  const descriptionCols = roles.map((role, k) => (role === "description" || role === "ref" ? k : -1)).filter((k) => k >= 0)
  const context = rows.slice(0, headerRow).map((r) => r.map(cellText).join(" ")).join("\n")
  // The currency: stated above the table, or in the amount headings ("Balance (USD)").
  const headings = rows[headerRow].map(cellText).join(" ")
  const fromHeadings = headings.match(/\(\s*([A-Z]{3})\s*\)|\b(AED|USD|EUR|GBP|SAR|QAR|OMR|KWD|BHD|INR|PKR|CHF|JPY|CNY|CAD|AUD|SGD|HKD)\b/)
  const stated = context.match(/(?:currency|ccy)\s*:?\s*([A-Z]{3})\b/i)?.[1]?.toUpperCase()
  const currency = [stated, fromHeadings?.[1], fromHeadings?.[2]].find((c) => c && CURRENCIES.includes(c)) ?? "AED"
  const out: RawRow[] = []
  let statedOpening: number | null = null
  for (const r of rows.slice(headerRow + 1)) {
    const text = r.map(cellText).join(" ")
    const balance = col("balance") >= 0 ? cellMoney(r[col("balance")]) : null
    if (OPENING.test(text)) {
      if (balance !== null) out.push({ date: "", description: "Opening balance", debit: null, credit: null, amount: null, balance, opening: true })
      continue
    }
    const date = cellDate(r[col("date")])
    if (!date) continue
    const debit = col("debit") >= 0 ? cellMoney(r[col("debit")]) : null
    const credit = col("credit") >= 0 ? cellMoney(r[col("credit")]) : null
    let amount = col("amount") >= 0 ? cellMoney(r[col("amount")]) : null
    // A separate Dr/Cr (or Debit/Credit) column gives the amount its sign.
    if (amount !== null && col("drcr") >= 0) {
      const flag = cellText(r[col("drcr")])
      if (isDebitFlag(flag)) amount = -Math.abs(amount)
      else if (isCreditFlag(flag)) amount = Math.abs(amount)
    }
    if (debit === null && credit === null && amount === null) continue
    out.push({
      date,
      description: descriptionCols.map((k) => cellText(r[k])).filter(Boolean).join(" "),
      debit: debit || null,
      credit: credit || null,
      amount,
      balance,
      opening: false,
    })
  }
  const opening = context.match(/opening balance\s*:?\s*([-\d,.]+)/i)?.[1]
  if (opening) statedOpening = parseMoney(opening)
  const accountNo = context.match(/\bAE\d{21}\b/)?.[0] ?? context.match(/(?:account|a\/c)\s*(?:no\.?|number|#)?\s*[:.\-]?\s*(\d[\d\- ]{3,24}\d)/i)?.[1]?.replace(/[\s-]/g, "") ?? ""
  return { bank: detectBank(`${name}\n${context}`), accounts: [reconcile(out, currency, accountNo, statedOpening, null, { n: 0 })].filter((a) => a.transactions.length), warnings: [] }
}

/* ---------------- bank ---------------- */

const BANKS: [string, RegExp, string?][] = [
  ["Wio Bank", /\bwio\b/i, "086"],
  ["Mashreq", /mashreq/i, "033"],
  ["Emirates NBD", /emirates\s*nbd|\bENBD\b/i, "026"],
  ["RAKBANK", /rakbank|ras al khaimah/i, "040"],
  ["ADCB", /abu dhabi commercial|\bADCB\b|procash/i, "003"],
  ["ADIB", /abu dhabi islamic|\bADIB\b/i, "050"],
  ["Ajman Bank", /ajman bank/i, "057"],
  ["Banque Misr", /banque misr|bank misr/i],
  ["UBL", /united bank limited|\bUBL\b/i, "047"],
  ["First Abu Dhabi Bank", /first abu dhabi|\bFAB\b/i, "035"],
  ["Emirates Islamic", /emirates islamic/i, "034"],
  ["Dubai Islamic Bank", /dubai islamic/i, "024"],
  ["Commercial Bank of Dubai", /commercial bank of dubai|\bCBD\b/i, "023"],
  ["HSBC", /\bhsbc\b/i, "020"],
  ["Standard Chartered", /standard chartered/i, "044"],
  ["Sharjah Islamic Bank", /sharjah islamic/i, "041"],
  ["National Bank of Fujairah", /bank of fujairah|\bNBF\b/i, "038"],
  ["Zand", /\bzand\b/i],
]

export function detectBank(text: string) {
  const iban = text.match(/\bAE\d{2}(\d{3})\d{16}\b/)
  if (iban) {
    const byCode = BANKS.find(([, , code]) => code === iban[1])
    if (byCode) return byCode[0]
  }
  const head = text.slice(0, 4000)
  const byName = BANKS.find(([, pattern]) => pattern.test(head))
  return byName ? byName[0] : "Bank"
}

/* ---------------- several statements of one account ---------------- */

export type StatementPart = { account: BankAccount; bank: string; file: string }
export type MergedAccount = {
  account: BankAccount
  bank: string
  files: string[]
  /** Breaks between consecutive statements: the next one does not open where the last closed. */
  gaps: { after: string; before: string; closed: number; opened: number }[]
  /** Lines that appeared in two uploaded statements and were counted once. */
  duplicates: number
}

const digits = (s: string) => s.replace(/\D/g, "")
const named = (p: StatementPart) => p.bank !== "Bank" && digits(p.account.account).length >= 6
/** Same bank and currency, and one account number ends with the other's last digits (IBAN vs account number). */
function sameNumber(a: StatementPart, b: StatementPart) {
  if (a.bank !== b.bank || a.account.currency !== b.account.currency) return false
  const x = digits(a.account.account)
  const y = digits(b.account.account)
  const tail = Math.min(x.length, y.length, 10)
  return x.slice(-tail) === y.slice(-tail)
}
/** A statement without a bank name or account number joins another only where the balances run on. */
function runsOn(a: StatementPart, b: StatementPart) {
  if (a.account.currency !== b.account.currency) return false
  if (a.bank !== b.bank && a.bank !== "Bank" && b.bank !== "Bank") return false
  const [first, second] = (a.account.from || "") <= (b.account.from || "") ? [a, b] : [b, a]
  return first.account.closing !== null && second.account.opening !== null && close(first.account.closing, second.account.opening, 0.011) && first.account.to <= second.account.from
}

/**
 * Two statements of one account that overlap (January–March and March–May, or the same months
 * downloaded twice): they share printed lines, or the later one opens on the earlier one's
 * balance at that date.
 */
function overlaps(a: StatementPart, b: StatementPart) {
  if (a.account.currency !== b.account.currency) return false
  if (a.bank !== b.bank && a.bank !== "Bank" && b.bank !== "Bank") return false
  if (!a.account.transactions.length || !b.account.transactions.length) return false
  if (a.account.to < b.account.from || b.account.to < a.account.from) return false
  const key = (t: BankTransaction) => `${t.date}|${t.amount}|${t.balance}|${t.description}`
  const keys = new Set(a.account.transactions.filter((t) => t.balance !== null).map(key))
  if (b.account.transactions.some((t) => t.balance !== null && keys.has(key(t)))) return true
  const [first, second] = a.account.from <= b.account.from ? [a, b] : [b, a]
  const before = first.account.transactions.filter((t) => t.date < second.account.from && t.balance !== null).pop()
  return Boolean(before && second.account.opening !== null && close(before.balance!, second.account.opening, 0.011))
}
const belongs = (a: StatementPart, b: StatementPart) => runsOn(a, b) || overlaps(a, b)
/** A line of one account: its date, amount and the balance after it; the description only where there is no balance (statements word lines differently). */
const lineKey = (t: BankTransaction) => (t.balance !== null ? `${t.date}|${t.amount}|${t.balance}` : `${t.date}|${t.amount}||${t.description}`)

/**
 * Statements of the same account uploaded in any order (February, May, January…) are put
 * in date order and joined into one account: opening from the earliest, closing from the
 * latest, lines in date order, lines repeated across overlapping statements counted once,
 * and any break between one statement's closing and the next one's opening reported.
 */
export function mergeStatements(parts: StatementPart[]): MergedAccount[] {
  const groups: StatementPart[][] = []
  for (const part of parts.filter(named)) {
    const group = groups.find((g) => g.some((member) => named(member) && sameNumber(member, part)))
    if (group) group.push(part)
    else groups.push([part])
  }
  let unplaced = parts.filter((p) => !named(p))
  for (let changed = true; changed && unplaced.length; ) {
    changed = false
    for (const part of [...unplaced]) {
      const group = groups.find((g) => g.some((member) => belongs(member, part)))
      if (!group) continue
      group.push(part)
      unplaced = unplaced.filter((p) => p !== part)
      changed = true
    }
  }
  // Left over: chained to each other where balances run on, otherwise an account of their own.
  for (const part of unplaced) {
    const group = groups.find((g) => g.every((member) => !named(member)) && g.some((member) => belongs(member, part)))
    if (group) group.push(part)
    else groups.push([part])
  }
  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => (a.account.from || "9999").localeCompare(b.account.from || "9999") || (a.account.to || "").localeCompare(b.account.to || ""))
    const seen = new Set<string>()
    const transactions: BankTransaction[] = []
    let duplicates = 0
    const gaps: MergedAccount["gaps"] = []
    let previous: StatementPart | null = null
    for (const part of ordered) {
      if (previous && previous.account.closing !== null && part.account.opening !== null && part.account.transactions.length && !close(previous.account.closing, part.account.opening, 0.011)) {
        // An overlap (the later statement repeats earlier lines) is not a break.
        const overlaps = part.account.from <= previous.account.to
        if (!overlaps) gaps.push({ after: previous.account.to, before: part.account.from, closed: previous.account.closing, opened: part.account.opening })
      }
      // Only lines already read from an EARLIER statement are repeats; two equal lines in one statement are both real.
      const own: string[] = []
      for (const t of part.account.transactions) {
        const key = lineKey(t)
        if (seen.has(key)) {
          duplicates++
          continue
        }
        own.push(key)
        transactions.push(t)
      }
      own.forEach((key) => seen.add(key))
      if (part.account.transactions.length) previous = part
    }
    // Date order across statements; lines of the same day keep the order the bank printed them.
    const order = new Map(transactions.map((t, i) => [t, i]))
    transactions.sort((a, b) => a.date.localeCompare(b.date) || order.get(a)! - order.get(b)!)
    const withLines = ordered.filter((p) => p.account.transactions.length)
    const first = withLines[0] ?? ordered[0]
    const last = withLines[withLines.length - 1] ?? ordered[ordered.length - 1]
    const account: BankAccount = {
      ...first.account,
      key: ordered.map((p) => p.account.key).join("+"),
      account: ordered.map((p) => p.account.account).sort((a, b) => b.length - a.length)[0] ?? "",
      opening: first.account.opening,
      statedOpening: first.account.statedOpening,
      closing: last.account.closing,
      statedClosing: last.account.statedClosing,
      transactions,
      verified: ordered.reduce((t, p) => t + p.account.verified, 0),
      mismatches: ordered.reduce((t, p) => t + p.account.mismatches, 0),
      from: transactions[0]?.date ?? "",
      to: transactions[transactions.length - 1]?.date ?? "",
    }
    return { account, bank: first.bank, files: [...new Set(ordered.map((p) => p.file))], gaps, duplicates }
  })
}
