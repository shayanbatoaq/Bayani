import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)
const { emptyCompanyDraft, localToday } = await jiti.import("../lib/company.ts")
const { parseVat201, vatYears, analyse, totals, withTotals } = await jiti.import("../lib/vat-filings.ts")

// Layout of an EmaraTax VAT 201 download (as read by the PDF reader); figures and names invented.
const sample = `123456789012 - إقرار VAT 201 Return
Taxpayer Information
VAT Return Period
TRN
100111222300003 فترة   01/06/2026 - 31/08/2026
Legal Name of
VAT Stagger   Stagger 2 – Quarterly (Mar
Entity(English)   Sample Trading Co
اسم   to Feb)
Legal Name of Entity   VAT Return Due Date
(Arabic)   عربي   28/09/2026
Address   Tax Year End
Dubai   28/02/2027
1a Standard Rated Supplies in Abu Dhabi
0.00   0.00   0.00
1b Standard Rated Supplies in Dubai
196,302.80   9,815.14   0.00
1c Standard Rated Supplies in Sharjah
0.00   0.00   0.00
1d Standard Rated Supplies in Ajman
0.00   0.00   0.00
1e Standard Rated Supplies in Umm Al Quwain
0.00   0.00   0.00
1f Standard Rated Supplies in Ras Al Khaimah
0.00   0.00   0.00
1g Standard Rated Supplies in Fujairah
0.00   0.00   0.00
2 Tax Refunds provided to Tourists under the Tax
Refunds for Tourists Scheme   0.00   0.00
3 Supplies subject to the reverse charge provisions
0.00   0.00
4 Zero Rated Supplies
0.00
5 Exempt Supplies
0.00
6 Goods imported into the UAE
0.00   0.00
7 Adjustments to goods imported into the UAE
0.00   0.00
8 Totals
196,302.80   9,815.14   0.00
9 Standard Rated Expenses
18,144.80   907.24   0.00
10 Supplies subject to the reverse charge provisions
0.00   0.00
11 Totals
18,144.80   907.24   0.00
12 Total Value of due tax for the period
9,815.14
13 Total Value of recoverable tax for the period
907.24
14 Payable tax for the period
8,907.90
Did you apply the profit margin scheme in respect of any supplies made during the tax period?
No
Date of Submission   Email Address
24/09/2026`

const company = {
  ...emptyCompanyDraft(),
  id: "00000000-0000-4000-8000-000000000004",
  name: "Sample Trading Co",
  vat: { trn: "100111222300003", effectiveDate: "2025-03-01", frequency: "quarterly", cycleStartMonth: 3 },
}

test("reads an uploaded VAT 201 return", () => {
  const { filing, found, warnings } = parseVat201(sample)
  assert.equal(found, 20)
  assert.deepEqual(warnings, [])
  assert.equal(filing.trn, "100111222300003")
  assert.equal(filing.periodStart, "2026-06-01")
  assert.equal(filing.periodEnd, "2026-08-31")
  assert.equal(filing.dueDate, "2026-09-28")
  assert.equal(filing.stagger, "Stagger 2 – Quarterly (Mar to Feb)")
  assert.equal(filing.reference, "123456789012")
  assert.equal(filing.submittedOn, "2026-09-24")
  assert.deepEqual(filing.boxes["1b"], { amount: 196302.8, vat: 9815.14, adjustment: 0 })
  assert.deepEqual(filing.boxes["9"], { amount: 18144.8, vat: 907.24, adjustment: 0 })
  assert.equal(filing.boxes["14"].amount, 8907.9)
  assert.equal(totals({ ...filing, source: "upload" }).payable, 8907.9)
})

test("tax years follow the VAT tax year: May to April gives 2025-2026", () => {
  const years = vatYears({ ...company, vat: { ...company.vat, effectiveDate: "2025-05-01", cycleStartMonth: 5 } }, {}, {}, "2026-10-01")
  const y = years.find((year) => year.key === "2025")
  assert.equal(y.label, "2025-2026")
  assert.deepEqual(y.periods.map((p) => p.label), ["May–Jul 2025", "Aug–Oct 2025", "Nov–Jan 2025/2026", "Feb–Apr 2026"])
  assert.equal(y.periods[0].dueDate, "2025-08-28")
  // January start gives a single-year label.
  assert.equal(vatYears({ ...company, vat: { ...company.vat, cycleStartMonth: 1, effectiveDate: "2025-01-01" } }, {}, {}, "2025-06-01")[0].label, "2025")
  // Registration part-way through a quarter shortens the first return.
  const late = vatYears({ ...company, vat: { ...company.vat, effectiveDate: "2025-06-15", cycleStartMonth: 5 } }, {}, {}, "2025-12-01")[0]
  assert.equal(late.periods[0].registered, true)
  assert.equal(late.periods[0].start, "2025-06-15")
})

test("today is the user's own date, not UTC's", () => {
  const zone = process.env.TZ
  try {
    process.env.TZ = "Asia/Dubai"
    // 1:30 am on 1 April in Dubai is still 31 March in UTC.
    assert.equal(localToday(new Date("2025-03-31T21:30:00Z")), "2025-04-01")
    process.env.TZ = "America/New_York"
    assert.equal(localToday(new Date("2025-04-01T02:30:00Z")), "2025-03-31")
  } finally {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  }
})

test("analysis: deregistration warnings follow the thresholds", () => {
  const years = vatYears(company, {}, {}, "2026-12-01")
  const quarter = (slot, sales) => withTotals({ periodStart: slot.start, periodEnd: slot.end, source: "manual", profitMarginScheme: false, boxes: { "1b": { amount: sales, vat: sales * 0.05, adjustment: 0 }, "9": { amount: 1000, vat: 50, adjustment: 0 } } })
  const slots = years.flatMap((y) => y.periods).filter((p) => p.registered).slice(0, 4)
  const store = (sales) => Object.fromEntries(slots.map((s) => [s.id, quarter(s, sales)]))
  const low = analyse(company, years, store(40000), years[0].key, "2026-12-01")
  assert.equal(low.taxableSupplies12m, 160000)
  assert.ok(low.insights.some((i) => i.level === "alert" && /deregistration/i.test(i.title)))
  const mid = analyse(company, years, store(70000), years[0].key, "2026-12-01")
  assert.ok(mid.insights.some((i) => /optional/i.test(i.title)))
  const high = analyse(company, years, store(500000), years[0].key, "2026-12-01")
  assert.ok(high.insights.some((i) => i.title === "Registration is required"))
  const none = analyse(company, years, store(0), years[0].key, "2026-12-01")
  assert.ok(none.insights.some((i) => /No taxable supplies/.test(i.title)))
  // Unrecorded past returns are flagged.
  assert.ok(analyse(company, years, {}, years[0].key, "2026-12-01").insights.some((i) => /not recorded/.test(i.title)))
})
