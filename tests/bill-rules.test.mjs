import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

// Invented suppliers, customers and figures in the layouts UAE bills come in.
const jiti = createJiti(import.meta.url)
const { readBill } = await jiti.import("../lib/bill-rules.ts")
const own = { ownName: "Example Buyer LLC", ownTrn: "100999999900003" }

const cases = [
  {
    name: "summary with a tax summary repeated below (Zoho style, AED glued to the figure)",
    text: `Tax Invoice
# PI-00086
DESERT CABLING TECHNICAL SERVICES L.L.C
Office 1, Al Barsha
TRN 100306600000003
Bill To
EXAMPLE BUYER LLC
TRN 100999999900003
INV Date :   16 Dec 2024
#   Item & Description   Qty   Rate   Tax %   Tax   Amount
1   Supply of cables   1.00   76,000.00   5.00   3,800.00   76,000.00
2   Fibre testing   1.00   7,500.00   5.00   375.00   7,500.00
Sub Total   83,500.00
Standard Rate (5%)   4,175.00
Total   AED87,675.00
Tax Summary
Tax Details   Taxable Amount (AED) Tax Amount (AED)
Standard Rate (5%)   83,500.00   4,175.00
Total   AED83,500.00   AED4,175.00`,
    expect: { net: 83500, vat: 4175, total: 87675, number: "PI-00086", date: "2024-12-16", supplier: "DESERT CABLING TECHNICAL SERVICES L.L.C", vendorTrn: "100306600000003" },
  },
  {
    name: "excl / incl VAT labels",
    text: `GULF OFFICE TRADING LLC
TRN: 100200300400003
Invoice No: GO-5521   Date: 03/02/2025
Description Qty Price Amount
A4 paper 10 25.00 250.00
Total Excl. VAT 250.00
VAT @ 5% 12.50
Total Incl. VAT 262.50`,
    expect: { net: 250, vat: 12.5, total: 262.5, number: "GO-5521", date: "2025-02-03" },
  },
  {
    name: "labels and figures on separate lines",
    text: `MARINA PRINTING PRESS LLC
TAX INVOICE
Invoice Number
INV/2025/0091
Sub Total
1,000.00
VAT 5%
50.00
Grand Total
1,050.00`,
    expect: { net: 1000, vat: 50, total: 1050 },
  },
  {
    name: "totals printed above the items",
    text: `AL NOOR CATERING SERVICES
Amount Due AED 2,100.00
VAT 100.00
Subtotal 2,000.00
Item Qty Amount
Lunch boxes 100 2,000.00`,
    expect: { net: 2000, vat: 100, total: 2100 },
  },
  {
    name: "supermarket receipt, VAT included in the total",
    text: `FRESH MART SUPERMARKET
TRN 100555666700003
12/03/2025 18:22
MILK 2L 9.75
BREAD 6.50
WATER 6PK 12.00
TOTAL AED 28.25
VAT 5% INCLUDED 1.35
VISA ****1234`,
    expect: { net: 26.9, vat: 1.35, total: 28.25, payment: "card" },
  },
  {
    name: "Dubai restaurant bill with municipality fee",
    text: `PALM GRILL RESTAURANT LLC
TRN 100777888900003
Bill No: 4471 Date: 21-Jan-2025
Food 400.00
Municipality Fee 7% 28.00
VAT 5% 21.40
Total 449.40
Paid by Cash`,
    expect: { total: 449.4, vat: 21.4, net: 428, payment: "cash" },
  },
  {
    name: "utility bill",
    text: `Dubai Electricity and Water Authority
Account number 2001234567
Bill date 05/04/2025
Electricity consumption 812.40
Water consumption 211.70
Housing fee 150.00
Current month charges 1,174.10
VAT 58.71
Total amount due AED 1,232.81`,
    expect: { net: 1174.1, vat: 58.71, total: 1232.81 },
  },
  {
    name: "telecom bill",
    text: `EMIRATES TELECOMMUNICATIONS GROUP COMPANY
Tax Invoice No. 9876543
Invoice date 01 Mar 2025
Total charges (excl VAT) 499.00
VAT 24.95
Total due 523.95`,
    expect: { net: 499, vat: 24.95, total: 523.95, date: "2025-03-01" },
  },
  {
    name: "zero-rated export",
    text: `HORIZON LOGISTICS FZE
Invoice No: HL-778 Date: 10/06/2025
Freight to Riyadh 10,000.00
Sub Total 10,000.00
VAT 0% 0.00
Total AED 10,000.00
Zero rated supply`,
    expect: { net: 10000, vat: 0, total: 10000, proven: true },
  },
  {
    name: "foreign supplier, no VAT",
    text: `Cloudhost Inc.
Invoice # 20250417
April 17, 2025
Hosting plan 1,200.00
Total 1,200.00`,
    expect: { net: 1200, vat: 0, total: 1200 },
  },
  {
    name: "Dhs prefix and no thousands separator",
    text: `SPEEDY AUTO GARAGE LLC
Receipt No: R-77
Date 2/5/2025
Service and oil change Dhs 950.00
Subtotal Dhs 950.00
VAT Dhs 47.50
Total Dhs 997.50`,
    expect: { net: 950, vat: 47.5, total: 997.5, number: "R-77", date: "2025-05-02" },
  },
  {
    name: "bilingual labels",
    text: `مؤسسة الواحة للتجارة
OASIS TRADING EST
فاتورة ضريبية Tax Invoice
المجموع Sub Total 3,400.00
ضريبة القيمة المضافة VAT 170.00
الإجمالي Total 3,570.00`,
    expect: { net: 3400, vat: 170, total: 3570 },
  },
  {
    name: "discount before VAT",
    text: `BRIGHT FURNITURE TRADING LLC
Invoice No: BF-310 Date: 12/12/2024
Office desk 2 500.00 1,000.00
Subtotal 1,000.00
Discount 100.00
Taxable Amount 900.00
VAT 5% 45.00
Total 945.00`,
    expect: { net: 900, vat: 45, total: 945 },
  },
  {
    name: "advance deducted from the amount due",
    text: `PRIME CONTRACTING LLC
Invoice No: PC-19
Contract works 20,000.00
Sub Total 20,000.00
VAT 1,000.00
Invoice Total 21,000.00
Less: Advance received 5,000.00
Balance Due 16,000.00`,
    expect: { net: 20000, vat: 1000, total: 21000 },
  },
  {
    name: "VAT rounded per line",
    text: `CITY STATIONERS LLC
Item Qty Rate VAT Amount
Pens 3 111.11 16.67 333.33
Sub-Total: 333.33
VAT(5%): 16.67
Total: AED 350.00`,
    expect: { net: 333.33, vat: 16.67, total: 350 },
  },
  {
    name: "large figures with currency after the amount",
    text: `EMIRATES STEEL SUPPLIES LLC
Taxable value 1,234,567.89 AED
Output VAT 61,728.39 AED
Total payable 1,296,296.28 AED`,
    expect: { net: 1234567.89, vat: 61728.39, total: 1296296.28 },
  },
  {
    name: "card slip with only a total is flagged, not guessed",
    text: `PAYMENT RECEIPT
MERCHANT: COFFEE CORNER
AMOUNT AED 52.50
APPROVED`,
    expect: { total: 52.5, proven: false },
  },
  {
    name: "nothing adds up: amounts left for the user",
    text: `SOME TRADING LLC
Total 1,000.00
VAT 80.00`,
    expect: { total: 1000, net: undefined, vat: undefined, proven: false },
  },
]

for (const c of cases)
  test(`bill: ${c.name}`, () => {
    const f = readBill(c.text, own)
    for (const [key, value] of Object.entries(c.expect)) {
      if (key === "proven") assert.equal(f.check.amounts === "proven", value, `${key}: ${JSON.stringify(f)}`)
      else assert.deepEqual(f[key], value, `${key}: ${JSON.stringify(f)}`)
    }
    // Whatever is filled in must add up.
    if (f.net !== undefined && f.vat !== undefined) assert.ok(Math.abs(f.net + f.vat - f.total) < 0.02, JSON.stringify(f))
  })
