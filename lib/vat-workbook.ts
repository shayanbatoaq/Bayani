import ExcelJS from "exceljs"
import type { Company } from "./company"
import type { RegistrationCheck, VatReturn } from "./vat-return"

const FONT = "Calibri"
const MONEY = '#,##0.00;(#,##0.00);"-"'
const band = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFECE5B5" } }

/** VAT 201 worksheet and line working as Excel. */
export async function vatWorkbook(company: Company, ret: VatReturn, registration: RegistrationCheck) {
  const book = new ExcelJS.Workbook()
  book.creator = "FinScope"
  const ws = book.addWorksheet("VAT 201", { views: [{ showGridLines: false }] })
  ;[8, 60, 18, 18, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w))
  ws.addRow([`${company.name} — VAT 201 ${ret.period.start} to ${ret.period.end}`]).font = { name: FONT, bold: true, size: 12 }
  ws.addRow([`TRN ${company.vat.trn} · ${ret.stagger} · Due ${ret.period.dueDate} · ${ret.coverage}`]).font = { name: FONT }
  const section = (title: string) => {
    ws.addRow([])
    const r = ws.addRow(["", title, "Amount (AED)", "VAT Amount (AED)", "Adjustment (AED)"])
    r.font = { name: FONT, bold: true }
    r.eachCell((c) => (c.fill = band))
  }
  const put = (boxes: string[], total: string) => {
    for (const b of ret.boxes.filter((x) => boxes.includes(x.box))) {
      const r = ws.addRow([b.box, b.label, b.box === "2" ? null : b.amount, b.box === "4" || b.box === "5" ? null : b.vat, b.adjustment || null])
      r.font = { name: FONT, bold: b.box === total }
      ;[3, 4, 5].forEach((c) => (r.getCell(c).numFmt = MONEY))
    }
  }
  section("VAT on Sales and All Other Outputs")
  put(["1a", "1b", "1c", "1d", "1e", "1f", "1g", "2", "3", "4", "5", "6", "7", "8"], "8")
  section("VAT on Expenses and All Other Inputs")
  put(["9", "10", "11"], "11")
  section("Net VAT Due")
  for (const b of ret.boxes.filter((x) => ["12", "13", "14"].includes(x.box))) {
    const r = ws.addRow([b.box, b.label, null, b.vat])
    r.font = { name: FONT, bold: b.box === "14" }
    r.getCell(4).numFmt = MONEY
  }

  const lines = book.addWorksheet("Working", { views: [{ showGridLines: false }] })
  ;[40, 16, 12, 60, 14, 14, 70].forEach((w, i) => (lines.getColumn(i + 1).width = w))
  const h = lines.addRow(["Description", "Amount (AED)", "Rule", "Treatment", "VAT", "Recoverable", "Note"])
  h.font = { name: FONT, bold: true }
  h.eachCell((c) => (c.fill = band))
  for (const l of ret.lines) {
    const r = lines.addRow([l.name, l.amount, l.rule, l.ruleLabel, l.vat, l.side === "expense" ? l.recoverable : null, l.reason])
    ;[2, 5, 6].forEach((c) => (r.getCell(c).numFmt = MONEY))
    r.getCell(7).alignment = { wrapText: true }
  }
  lines.addRow([])
  for (const text of [...ret.commentary, `Registration (${registration.rule}): ${registration.result}`]) lines.addRow([text])
  lines.addRow([])
  lines.addRow(["Needs review"]).font = { name: FONT, bold: true }
  for (const text of ret.review) lines.addRow([`• ${text}`])
  lines.addRow(["Assumptions made"]).font = { name: FONT, bold: true }
  for (const text of ret.assumptions) lines.addRow([`• ${text}`])
  lines.addRow([ret.footer]).font = { name: FONT, italic: true }
  return Buffer.from(await book.xlsx.writeBuffer())
}
