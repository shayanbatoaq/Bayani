import ExcelJS from "exceljs"
import type { Company } from "./company"
import type { CtReturn, FormRow } from "./ct-return"

const FONT = "Calibri"
const NUMBER = '#,##0;(#,##0);"-"'
const band = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFECE5B5" } }
const grey = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD9D9D9" } }
const cellValue = (value: FormRow["value"]) => (typeof value === "boolean" ? (value ? "Yes" : "No") : (value ?? ""))

/** The corporate tax return worksheet as Excel: one sheet per EmaraTax step plus summary and commentary. */
export async function ctWorkbook(company: Company, ret: CtReturn) {
  const book = new ExcelJS.Workbook()
  book.creator = "FinScope"
  const sheet = (name: string, widths: number[]) => {
    const ws = book.addWorksheet(name, { views: [{ showGridLines: false }] })
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
    const head = ws.addRow([`${company.name} — Corporate Tax Return ${ret.periodStart.split("-").reverse().join("/")} to ${ret.periodEnd.split("-").reverse().join("/")}`])
    head.font = { name: FONT, bold: true, size: 12 }
    ws.addRow([`Regime: ${ret.regime} · Status: ${ret.status} · Due: ${ret.dueDate.split("-").reverse().join("/")}`]).font = { name: FONT, size: 10 }
    ws.addRow([])
    return ws
  }

  const summary = sheet("Tax summary", [8, 90, 20])
  const h = summary.addRow(["S.no", "Description", "Total Amount (AED)"])
  h.font = { name: FONT, bold: true }
  h.eachCell((c) => (c.fill = band))
  let group = ""
  for (const line of ret.summary) {
    if (line.group !== group) {
      group = line.group
      const g = summary.addRow(["", group])
      g.font = { name: FONT, bold: true }
      g.eachCell((c) => (c.fill = grey))
    }
    const row = summary.addRow([line.no, line.label, line.amount])
    row.font = { name: FONT, bold: line.no >= 23 }
    row.getCell(3).numFmt = NUMBER
  }

  for (const step of ret.steps) {
    const ws = sheet(`${step.number} ${step.title}`.slice(0, 31), [80, 22, 22])
    for (const section of step.sections) {
      const title = ws.addRow([section.title, section.columns === "comparative" ? "Current Period (AED)" : section.columns === "amount" ? "Total Amount (AED)" : "", section.columns === "comparative" ? "Previous Period (AED)" : ""])
      title.font = { name: FONT, bold: true }
      title.eachCell((c) => (c.fill = band))
      for (const row of section.rows) {
        if (row.hidden) continue
        const line = ws.addRow(row.kind === "heading" ? [row.label] : [row.label, cellValue(row.value), section.columns === "comparative" ? (row.prior ?? "") : ""])
        line.font = { name: FONT, bold: row.kind === "heading" || row.kind === "total" }
        line.getCell(1).alignment = { wrapText: true, vertical: "top" }
        line.getCell(2).alignment = { horizontal: typeof row.value === "number" ? "right" : "left", wrapText: true }
        line.getCell(2).numFmt = NUMBER
        line.getCell(3).numFmt = NUMBER
        if (row.kind === "total") line.eachCell((c) => (c.fill = grey))
      }
      ws.addRow([])
    }
  }

  const notes = sheet("Commentary", [110])
  for (const block of ret.commentary) {
    notes.addRow([block.title]).font = { name: FONT, bold: true, size: 11 }
    for (const text of block.paragraphs) {
      const row = notes.addRow([text])
      row.getCell(1).alignment = { wrapText: true, vertical: "top" }
      row.height = Math.max(15, Math.ceil(text.length / 120) * 15)
    }
    notes.addRow([])
  }
  const open = [...ret.blockers, ...ret.warnings, ...ret.assumptions]
  if (open.length) {
    notes.addRow(["Open points before filing"]).font = { name: FONT, bold: true, size: 11 }
    for (const text of open) notes.addRow([`• ${text}`]).getCell(1).alignment = { wrapText: true }
    notes.addRow([])
  }
  notes.addRow(["Disclosures, schedules and records"]).font = { name: FONT, bold: true, size: 11 }
  for (const item of ret.disclosures) notes.addRow([`${item.item} — ${item.status}: ${item.reason}`]).getCell(1).alignment = { wrapText: true }

  return Buffer.from(await book.xlsx.writeBuffer())
}
