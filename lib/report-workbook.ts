import ExcelJS from "exceljs"
import type { EquityTable, ReportModel, Row, Schedule } from "./report-model"

/**
 * The financial statements as an Excel workbook, one sheet per statement, laid out
 * like the PDF: black year headers, dashed subtotals, double-ruled totals.
 */
const FONT = "Cambria"
const NUMBER = '#,##0;(#,##0);"-"'
const thin = { style: "thin" as const }
const dashed = { style: "dashed" as const }
const double = { style: "double" as const }

export async function reportWorkbook(model: ReportModel) {
  const book = new ExcelJS.Workbook()
  book.creator = "FinScope"
  book.created = new Date()
  const ended = `FOR THE YEAR ENDED ${model.periodEndText.toUpperCase()}`

  const sheet = (name: string, title: string, widths: number[]) => {
    const ws = book.addWorksheet(name, {
      pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.6, right: 0.6, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 } },
      views: [{ showGridLines: false }],
    })
    ws.properties.defaultRowHeight = 15
    widths.forEach((width, i) => (ws.getColumn(i + 1).width = width))
    ws.getColumn(1).font = { name: FONT, size: 10 }
    const a = ws.addRow([model.companyName])
    a.font = { name: FONT, bold: true, size: 11 }
    const b = ws.addRow([title])
    b.font = { name: FONT, bold: true, size: 10 }
    ws.addRow([])
    return ws
  }

  const years = [model.year, ...(model.priorYear ? [model.priorYear] : [])]
  const yearHeader = (ws: ExcelJS.Worksheet, withNote: boolean) => {
    const head = ws.addRow(["", withNote ? "Note" : "", ...years])
    head.font = { name: FONT, bold: true, size: 10 }
    head.getCell(1).border = { bottom: { style: "thick" } }
    head.getCell(2).border = { bottom: { style: "thick" } }
    head.getCell(2).alignment = { horizontal: "center" }
    years.forEach((_, i) => {
      const cell = head.getCell(3 + i)
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } }
      cell.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } }
      cell.alignment = { horizontal: "center" }
    })
    const currency = ws.addRow(["", "", ...years.map(() => model.currency)])
    currency.font = { name: FONT, bold: true, size: 10 }
    currency.alignment = { horizontal: "center" }
  }

  const statementRows = (ws: ExcelJS.Worksheet, rows: Row[], withNote = true, indent = 0) => {
    for (const row of rows) {
      if (row.kind === "spacer") {
        ws.addRow([])
        continue
      }
      const showAmounts = row.kind !== "section" && !(row.kind === "heading" && row.current === null)
      const values = showAmounts ? [row.current ?? 0, ...(model.priorYear ? [row.prior ?? 0] : [])] : []
      const line = ws.addRow([row.label, withNote && row.note ? row.note : "", ...values])
      line.font = { name: FONT, size: 10, bold: Boolean(row.kind) }
      line.getCell(1).alignment = { indent }
      line.getCell(2).alignment = { horizontal: "center" }
      years.forEach((_, i) => {
        const cell = line.getCell(3 + i)
        cell.numFmt = NUMBER
        if (row.kind === "subtotal") cell.border = { top: dashed, bottom: dashed }
        if (row.kind === "total") cell.border = { top: thin, bottom: double }
      })
      if (row.kind === "total") line.getCell(1).border = { top: thin, bottom: thin }
    }
  }

  const signature = (ws: ExcelJS.Worksheet, text = "The annexed schedules form an integral part of these financial statements.") => {
    ws.addRow([])
    ws.addRow([text]).font = { name: FONT, size: 9 }
    ws.addRow([])
    ws.addRow([`For ${model.companyName}`]).font = { name: FONT, bold: true, size: 10 }
    ws.addRow([model.place]).font = { name: FONT, bold: true, size: 10 }
    ws.addRow([])
    ws.addRow([])
    ws.addRow(["______________________"])
    ws.addRow(["Authorised Signatory"]).font = { name: FONT, bold: true, size: 10 }
  }

  /* Company details */
  const details = sheet("Company details", "COMPANY DETAILS", [30, 80])
  for (const item of model.details) {
    const row = details.addRow([item.label, item.lines.join("\n")])
    row.font = { name: FONT, size: 10 }
    row.getCell(1).font = { name: FONT, size: 10, bold: true }
    row.alignment = { vertical: "top", wrapText: true }
    row.height = Math.max(16, item.lines.length * 14)
    row.eachCell((cell) => (cell.border = { bottom: { style: "hair" } }))
  }

  /* Statements */
  const widths = [52, 8, 16, 16]
  const bs = sheet("Financial position", `STATEMENT OF FINANCIAL POSITION AS AT ${model.periodEndText.toUpperCase()}`, widths)
  yearHeader(bs, true)
  statementRows(bs, model.bs)
  signature(bs)

  const pl = sheet("Comprehensive income", `STATEMENT OF COMPREHENSIVE INCOME ${ended}`, widths)
  yearHeader(pl, true)
  statementRows(pl, model.income)
  signature(pl)

  const eq = sheet("Changes in equity", `STATEMENT OF CHANGES IN EQUITY ${ended}`, [34, 15, 15, 15, 15, 15])
  for (const table of model.equity) equityTable(eq, table, model.currency)
  signature(eq)

  const cf = sheet("Cash flows", `STATEMENT OF CASH FLOWS ${ended}`, widths)
  yearHeader(cf, true)
  statementRows(cf, model.cashFlow)
  signature(cf)

  const sc = sheet("Schedules", `SCHEDULES TO THE FINANCIAL STATEMENTS ${ended}`, [52, 14, 16, 16])
  yearHeader(sc, false)
  for (const schedule of model.schedules) scheduleBlock(sc, schedule, (rows) => statementRows(sc, rows, false, 2))
  signature(sc, "The schedules above form an integral part of these financial statements.")

  return Buffer.from(await book.xlsx.writeBuffer())
}

function equityTable(ws: ExcelJS.Worksheet, table: EquityTable, currency: string) {
  const head = ws.addRow(["", ...table.columns])
  head.font = { name: FONT, bold: true, size: 10 }
  head.alignment = { horizontal: "center", vertical: "bottom", wrapText: true }
  head.height = 42
  const sub = ws.addRow([String(table.year), ...table.columns.map(() => currency)])
  sub.font = { name: FONT, bold: true, size: 10 }
  sub.eachCell((cell, col) => {
    cell.border = { bottom: thin }
    if (col > 1) cell.alignment = { horizontal: "center" }
  })
  for (const line of table.lines) {
    const row = ws.addRow([line.label, ...line.values])
    row.font = { name: FONT, size: 10, bold: line.kind === "total" }
    row.eachCell((cell, col) => {
      if (col > 1) cell.numFmt = NUMBER
      if (line.kind === "total") cell.border = { top: thin, bottom: double }
    })
  }
  ws.addRow([])
}

function scheduleBlock(ws: ExcelJS.Worksheet, schedule: Schedule, rows: (rows: Row[]) => void) {
  ws.addRow([])
  const title = ws.addRow([`${schedule.number}   ${schedule.title}`])
  title.font = { name: FONT, bold: true, size: 10 }
  for (const text of schedule.paragraphs ?? []) {
    const para = ws.addRow([text])
    para.font = { name: FONT, size: 10 }
    para.getCell(1).alignment = { indent: 2, wrapText: true }
    ws.mergeCells(para.number, 1, para.number, 4)
    para.height = 28
  }
  if (schedule.table) {
    const head = ws.addRow(schedule.table.head)
    head.font = { name: FONT, bold: true, size: 10 }
    head.eachCell((cell) => (cell.border = { bottom: thin }))
    schedule.table.body.forEach((cells, r) => {
      const total = schedule.table!.totalLast && r === schedule.table!.body.length - 1
      const row = ws.addRow(cells)
      row.font = { name: FONT, size: 10, bold: Boolean(total) }
      schedule.table!.numeric.forEach((col) => (row.getCell(col + 1).alignment = { horizontal: "right" }))
      if (total) row.eachCell((cell) => (cell.border = { top: thin, bottom: thin }))
    })
  }
  if (schedule.rows) rows(schedule.rows)
}
