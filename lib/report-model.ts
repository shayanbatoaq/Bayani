import {
  financialPeriod,
  formatLongDate,
  type Company,
} from "./company"
import {
  calculateCashFlow,
  scheduleLines,
  scheduleValue,
  type FinancialRecord,
  type ScheduleKey,
} from "./financial-statements"

export type Row = {
  label: string
  note?: number
  current: number | null
  prior: number | null
  kind?: "heading" | "subtotal" | "total"
}
export type NoteBlock = {
  number: number
  title: string
  paragraphs?: string[]
  rows?: Row[]
  table?: { head: string[]; body: string[][] }
}
export type EquityTable = {
  year: number
  columns: string[]
  lines: { label: string; values: (number | null)[]; total?: boolean }[]
}
export type ReportModel = {
  companyName: string
  location: string
  currency: string
  year: number
  priorYear: number | null
  periodEnd: string
  periodEndText: string
  yearEndedText: string
  companyInfo: { heading: string; text: string[] }[]
  bs: Row[]
  income: Row[]
  equity: EquityTable[]
  cashFlow: Row[]
  policies: NoteBlock[]
  notes: NoteBlock[]
  warnings: string[]
}

const round = (n: number) => Math.round(n * 100) / 100
const money = (n: number) =>
  n.toLocaleString("en-AE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** Order of schedule notes as they appear after the policies. */
const NOTE_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 21, 18, 19]
const NOTE_TITLES: Record<number, string> = {
  3: "Property, plant and equipment",
  4: "Financial assets",
  5: "Inventories",
  6: "Trade receivables",
  7: "Advances, deposits and prepayments",
  8: "Due from related parties",
  9: "Cash and cash equivalents",
  10: "Non-current liabilities",
  11: "Trade payables",
  12: "Accruals, provisions and other payables",
  13: "Due to related parties",
  14: "Employees' end of service benefits",
  15: "Shareholders' current account",
  16: "Revenue",
  17: "Cost of sales",
  18: "Administrative and general expenses",
  19: "Finance costs",
  21: "Other income",
}

export function buildReport(
  company: Company,
  records: FinancialRecord[],
  year: number
): ReportModel {
  const byYear = new Map(records.map((record) => [record.year, record]))
  const current = byYear.get(year)
  if (!current) throw new Error(`No saved data for ${year}.`)
  const prior = byYear.get(year - 1) ?? null
  const prior2 = byYear.get(year - 2) ?? null
  const c = current.statements
  const p = prior?.statements ?? null
  const v = (key: ScheduleKey) => scheduleValue(c, key)
  const pv = (key: ScheduleKey) => (p ? scheduleValue(p, key) : null)
  const period = financialPeriod(year, company.ct.yearEndMonth)
  const periodEndText = formatLongDate(period.end)
  const warnings: string[] = []

  /* ---------- note numbering ---------- */
  const groupNonZero = (note: number) =>
    scheduleLines
      .filter((line) => line.note === note)
      .some((line) => v(line.key) !== 0 || (pv(line.key) ?? 0) !== 0)
  const included = NOTE_ORDER.filter(groupNonZero)
  const FIRST_SCHEDULE_NOTE = 5
  const noteNumber = new Map(included.map((note, i) => [note, FIRST_SCHEDULE_NOTE + i]))

  /* ---------- statement of financial position ---------- */
  const bsAmount = (output: typeof c | null, row: number) =>
    output ? (output.bs.find((line) => line.row === row)?.amount ?? 0) : null
  const bsLabels: Record<number, string> = {
    11: "Property, plant and equipment",
    12: "Financial assets",
    17: "Inventories",
    18: "Trade receivables",
    19: "Advances, deposits and prepayments",
    20: "Due from related parties",
    21: "Cash and cash equivalents",
    32: "Loan from director",
    33: "Other non-current liabilities",
    38: "Trade payables",
    39: "Accruals, provisions and other payables",
    40: "Due to related parties",
    41: "Employees' end of service benefits",
    46: "Share capital",
    47: "Current year earnings",
    48: "Retained earnings",
    49: "Shareholders' current account",
  }
  const bsNotes: Record<number, number> = { 11: 3, 12: 4, 17: 5, 18: 6, 19: 7, 20: 8, 21: 9, 38: 11, 39: 12, 40: 13, 41: 14, 49: 15 }
  const bsRow = (row: number, label: string, kind?: Row["kind"], note?: number): Row => ({
    label,
    note,
    current: bsAmount(c, row),
    prior: bsAmount(p, row),
    kind,
  })
  const nonZero = (row: Row) => (row.current ?? 0) !== 0 || (row.prior ?? 0) !== 0
  const section = (heading: string, rows: number[], total: number, totalLabel: string, totalNote?: number) => {
    const lines = rows
      .map((row) =>
        bsRow(row, bsLabels[row], undefined, row === 46 ? 2 : bsNotes[row] !== undefined ? noteNumber.get(bsNotes[row]) : undefined)
      )
      .filter(nonZero)
    const totalRow = bsRow(total, totalLabel, "subtotal", totalNote)
    return lines.length || nonZero(totalRow)
      ? [{ label: heading, current: null, prior: null, kind: "heading" as const }, ...lines, totalRow]
      : []
  }
  const cleanBs: Row[] = [
    { label: "Assets", current: null, prior: null, kind: "heading" },
    ...section("Non-current assets", [11, 12], 13, "Total non-current assets"),
    ...section("Current assets", [17, 18, 19, 20, 21], 22, "Total current assets"),
    bsRow(25, "Total assets", "total"),
    { label: "Equity and liabilities", current: null, prior: null, kind: "heading" },
    ...section("Equity", [46, 47, 48, 49], 50, "Total equity"),
    ...section("Non-current liabilities", [32, 33], 34, "Total non-current liabilities", noteNumber.get(10)),
    ...section("Current liabilities", [38, 39, 40, 41], 42, "Total current liabilities"),
    {
      label: "Total liabilities",
      current: round((bsAmount(c, 34) ?? 0) + (bsAmount(c, 42) ?? 0)),
      prior: p ? round((bsAmount(p, 34) ?? 0) + (bsAmount(p, 42) ?? 0)) : null,
      kind: "subtotal",
    },
    bsRow(52, "Total equity and liabilities", "total"),
  ]

  /* ---------- statement of comprehensive income ---------- */
  const incomeLabel: Record<number, string> = {
    10: "Revenue",
    11: "Cost of sales",
    12: "Gross profit",
    13: "Other income",
    14: "Administrative and general expenses",
    15: "Finance costs",
    16: "Net profit / (loss) for the year",
  }
  const priorIncome = new Map(p?.income.map((line) => [line.row, line.amount]) ?? [])
  const income: Row[] = c.income
    .map((line) => ({
      label: incomeLabel[line.row] ?? sentence(line.label),
      note: line.note !== undefined ? noteNumber.get(line.note) : undefined,
      current: line.amount,
      prior: p ? (priorIncome.get(line.row) ?? 0) : null,
      kind: line.kind === "total" ? ("subtotal" as const) : undefined,
    }))
    .filter((row) => row.kind || row.current !== 0 || (row.prior ?? 0) !== 0)
  income.push(
    { label: "Other comprehensive income", current: 0, prior: p ? 0 : null },
    {
      label: "Total comprehensive income for the year",
      current: c.netProfit,
      prior: p ? p.netProfit : null,
      kind: "total",
    }
  )
  if (income.at(-3)) income[income.length - 3].kind = "subtotal"

  /* ---------- changes in equity ---------- */
  const columns = [
    "Share capital",
    "Current year earnings",
    "Retained earnings",
    "Shareholders' current account",
    "Total",
  ]
  const equityFor = (record: FinancialRecord): EquityTable => ({
    year: record.year,
    columns,
    lines: record.statements.equity
      .filter((line) => line.kind === "total" || line.values.some((value) => value !== 0))
      .map((line) => ({
        label: line.label,
        values: line.values,
        total: line.kind === "total",
      })),
  })
  const equity = [prior, current].filter(Boolean).map((record) => equityFor(record!))

  /* ---------- cash flows ---------- */
  const cf = calculateCashFlow(c, p)
  const cfPrior = p ? calculateCashFlow(p, prior2?.statements ?? null) : null
  const cashFlow: Row[] = cf.lines
    .map((line, i) => ({
      label: line.label,
      current: line.amount,
      prior: cfPrior ? cfPrior.lines[i].amount : null,
      kind: line.kind,
      note: line.label.startsWith("Cash and cash equivalents at end") ? noteNumber.get(9) : undefined,
    }))
    .filter((row) => row.kind || (row.current ?? 0) !== 0 || (row.prior ?? 0) !== 0 || /beginning|end of the year/.test(row.label))
  if (cf.firstYear)
    warnings.push(
      `No data saved for ${year - 1}: the cash flow statement treats opening balances as nil. Save ${year - 1} for accurate working-capital movements.`
    )
  if (Math.abs(cf.difference) >= 0.01)
    warnings.push(`Cash flow does not reconcile to cash by ${money(cf.difference)} ${current.currency}.`)
  for (const record of [current, prior].filter(Boolean))
    for (const warning of record!.statements.warnings) warnings.push(`${record!.year}: ${warning}`)

  /* ---------- company information and policies ---------- */
  const partners = company.partners
  const capital = v("capital")
  const partnerValues = partners.map((partner) =>
    partner.shareValue > 0 ? partner.shareValue : round((capital * partner.sharePercent) / 100)
  )
  const registered = company.licenseIssueDate ? formatLongDate(company.licenseIssueDate) : ""
  const emirate = company.emirate || "the United Arab Emirates"
  const legalStatus = `${company.name} (the "Company") is registered${registered ? ` on ${registered}` : ""} as a ${company.legalForm || "company"} with ${company.authority}, ${company.emirate ? `${company.emirate}, ` : ""}United Arab Emirates${company.licenseNumber ? `, under licence No. ${company.licenseNumber}` : ""}.`
  const activities = `The principal activities of the Company are ${company.businessActivity.replace(/\.$/, "")}.`
  const management = `The Company is managed by ${company.manager}.`
  const companyInfo = [
    { heading: "Manager", text: [company.manager] },
    {
      heading: "Shareholders",
      text: partners.map((partner) => `${partner.name}${partner.nationality ? ` (${partner.nationality})` : ""} – ${money(partner.sharePercent)}%`),
    },
    { heading: "Principal activities", text: [company.businessActivity] },
    { heading: "Legal status", text: [legalStatus] },
    ...(company.vat.trn ? [{ heading: "VAT registration number (TRN)", text: [company.vat.trn] }] : []),
    ...(company.ct.trn ? [{ heading: "Corporate tax registration number (TRN)", text: [company.ct.trn] }] : []),
    { heading: "Registered office", text: [`${emirate}, United Arab Emirates`] },
  ]
  const partnerTotal = round(partnerValues.reduce((sum, value) => sum + value, 0))
  if (capital && Math.abs(partnerTotal - capital) >= 0.01)
    warnings.push(
      `Partner share values (${money(partnerTotal)}) differ from share capital in the trial balance (${money(capital)}).`
    )
  const policies: NoteBlock[] = [
    {
      number: 1,
      title: "Legal status and principal activities",
      paragraphs: [legalStatus, activities, management],
    },
    {
      number: 2,
      title: "Share capital",
      paragraphs: [
        `The paid-up share capital of the Company is ${current.currency} ${money(capital)}, held as follows:`,
      ],
      table: {
        head: ["Name", "Nationality", "% of shares", current.currency],
        body: [
          ...partners.map((partner, i) => [
            partner.name,
            partner.nationality,
            money(partner.sharePercent),
            money(partnerValues[i]),
          ]),
          ["Total", "", money(partners.reduce((s, x) => s + x.sharePercent, 0)), money(partnerTotal)],
        ],
      },
    },
    {
      number: 3,
      title: "Basis of preparation",
      paragraphs: [
        "These financial statements have been prepared in accordance with International Financial Reporting Standards (IFRS) as issued by the International Accounting Standards Board, and the applicable requirements of UAE law.",
        `The financial statements are prepared under the historical cost convention and are presented in ${currencyName(current.currency)} (${current.currency}), the Company's functional and presentation currency.`,
        "The preparation of financial statements requires management to make estimates and assumptions that affect the reported amounts of assets, liabilities, income and expenses. Estimates are reviewed on an ongoing basis and revisions are recognised in the period in which they are revised.",
      ],
    },
    {
      number: 4,
      title: "Significant accounting policies",
      paragraphs: [
        "4.1 Revenue – Revenue is recognised under IFRS 15 when control of goods or services passes to the customer, at the amount of consideration the Company expects to be entitled to, excluding value added tax.",
        "4.2 Property, plant and equipment – Stated at cost less accumulated depreciation and impairment losses. Depreciation is charged on a straight-line basis over the estimated useful lives of the assets. Gains and losses on disposal are recognised in profit or loss.",
        "4.3 Inventories – Stated at the lower of cost and net realisable value. Cost comprises purchase price and directly attributable costs.",
        "4.4 Trade receivables – Measured at amortised cost less an allowance for expected credit losses determined under IFRS 9.",
        "4.5 Cash and cash equivalents – Comprise cash in hand and balances with banks with original maturities of three months or less.",
        "4.6 Trade and other payables – Liabilities are recognised for amounts to be paid for goods and services received, whether or not billed to the Company.",
        "4.7 Provisions – Recognised when the Company has a present obligation arising from a past event, an outflow of resources is probable and the amount can be estimated reliably.",
        "4.8 Employees' end of service benefits – Provided in accordance with UAE labour law, based on employees' final salary and length of service.",
        "4.9 Leases – Leases are accounted for under IFRS 16. Short-term leases and leases of low-value assets are expensed on a straight-line basis over the lease term.",
        "4.10 Foreign currencies – Transactions in foreign currencies are recorded at the rate ruling on the transaction date. Monetary balances are retranslated at the reporting-date rate and differences are recognised in profit or loss.",
        "4.11 Taxation – Corporate tax is provided under Federal Decree-Law No. 47 of 2022 on the Taxation of Corporations and Businesses. Value added tax is accounted for under Federal Decree-Law No. 8 of 2017; revenue, expenses and assets are recognised net of recoverable VAT.",
        "4.12 Financial instruments – Financial assets and liabilities are recognised when the Company becomes party to the contractual provisions of the instrument, and are offset only where there is a legally enforceable right and an intention to settle net.",
      ],
    },
  ]

  /* ---------- schedule notes ---------- */
  const notes: NoteBlock[] = included.map((note) => {
    const number = noteNumber.get(note)!
    const lines = scheduleLines.filter((line) => line.note === note)
    let rows: Row[]
    if (note === 3) {
      rows = ledgerBreakdown(current, prior, "ppe")
    } else if (note === 15) {
      const opening = p ? scheduleValue(p, "shareholder") : current.openingEquity?.shareholder ?? null
      rows = [
        { label: "Opening balance", current: opening, prior: p ? (prior2 ? scheduleValue(prior2.statements, "shareholder") : prior!.openingEquity?.shareholder ?? null) : null },
        {
          label: "Net movement during the year",
          current: opening === null ? null : round(v("shareholder") - opening),
          prior: null,
        },
      ]
      if (p && rows[0].prior !== null) rows[1].prior = round((pv("shareholder") ?? 0) - rows[0].prior!)
    } else {
      rows = lines
        .filter((line) => v(line.key) !== 0 || (pv(line.key) ?? 0) !== 0)
        .map((line) => ({ label: sentence(line.label.replace(/ - closing balance$/, "")), current: v(line.key), prior: pv(line.key) }))
    }
    const total = (get: (key: ScheduleKey) => number | null) =>
      lines.reduce<number | null>((sum, line) => {
        const value = get(line.key)
        return value === null || sum === null ? null : round(sum + value)
      }, 0)
    rows.push({
      label: note === 15 ? "Closing balance" : "Total",
      current: total(v),
      prior: p ? total(pv) : null,
      kind: "total",
    })
    return { number, title: NOTE_TITLES[note], rows }
  })
  let next = FIRST_SCHEDULE_NOTE + included.length
  notes.push(
    {
      number: next++,
      title: "Financial instruments and risk management",
      paragraphs: [
        "Financial assets comprise cash and bank balances, trade and other receivables and amounts due from related parties. Financial liabilities comprise trade and other payables, borrowings and amounts due to related parties.",
        "Credit risk on bank balances is limited as balances are held with reputable banks. Credit risk on receivables is managed through credit assessment and regular monitoring of balances.",
        "The fair values of financial assets and liabilities are not materially different from their carrying amounts. Foreign exchange risk is limited as substantially all balances are denominated in UAE Dirhams or US Dollars, to which the Dirham is pegged.",
      ],
    },
    {
      number: next++,
      title: "Contingencies and commitments",
      paragraphs: [
        "There were no contingent liabilities or capital commitments at the reporting date other than those arising in the normal course of business, from which no loss is anticipated.",
      ],
    },
    ...(p
      ? [
          {
            number: next++,
            title: "Comparative figures",
            paragraphs: ["Comparative figures have been regrouped or reclassified where necessary to conform with the current year's presentation."],
          },
        ]
      : []),
    {
      number: next++,
      title: "Approval of the financial statements",
      paragraphs: ["These financial statements were approved and authorised for issue by management on ____________________."],
    }
  )

  return {
    companyName: company.name,
    location: `${(company.emirate || "").toUpperCase()}${company.emirate ? " - " : ""}UNITED ARAB EMIRATES`,
    currency: current.currency,
    year,
    priorYear: p ? year - 1 : null,
    periodEnd: period.end,
    periodEndText,
    yearEndedText: `for the year ended ${periodEndText}`,
    companyInfo,
    bs: cleanBs,
    income,
    equity,
    cashFlow,
    policies,
    notes,
    warnings,
  }
}

function ledgerBreakdown(
  current: FinancialRecord,
  prior: FinancialRecord | null,
  key: ScheduleKey
): Row[] {
  const sum = (record: FinancialRecord | null, name: string) =>
    record
      ? round(
          record.rows
            .filter((row) => row.scheduleKey === key && row.ledgerName === name)
            .reduce((total, row) => total + row.amount, 0)
        )
      : null
  const names = [
    ...new Set(
      [current, prior]
        .filter(Boolean)
        .flatMap((record) => record!.rows.filter((row) => row.scheduleKey === key).map((row) => row.ledgerName))
    ),
  ]
  return names.map((name) => ({ label: name, current: sum(current, name) ?? 0, prior: sum(prior, name) }))
}

function sentence(label: string) {
  if (label !== label.toUpperCase()) return label
  const lower = label.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function currencyName(code: string) {
  return (
    { AED: "UAE Dirhams", USD: "US Dollars", GBP: "Pounds Sterling", EUR: "Euros", PKR: "Pakistani Rupees" } as Record<string, string>
  )[code] ?? code
}

export const reportIndex = [
  "Company information",
  "Statement of financial position",
  "Statement of comprehensive income",
  "Statement of changes in equity",
  "Statement of cash flows",
  "Significant accounting policies",
  "Notes to the financial statements",
] as const
