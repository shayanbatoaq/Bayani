import ExcelJS from "exceljs"
import {
  scheduleLines,
  type FinancialRecord,
  type ReportLine,
} from "./financial-statements"

export const reportSheets = ["schedules", "BS", "INCOME", "EQUITY"] as const
export type ReportSheet = (typeof reportSheets)[number]

export async function createFinancialWorkbook(
  records: FinancialRecord[],
  selected: ReportSheet[]
) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "FinScope AI"
  workbook.calcProperties.fullCalcOnLoad = true
  const currency = records[0].currency
  const format = '#,##0.00;(#,##0.00);"-"'
  const sheets = Object.fromEntries(
    reportSheets.map((name) => [
      name,
      workbook.addWorksheet(name, {
        state: selected.includes(name) ? "visible" : "hidden",
        views: [{ showGridLines: false, state: "frozen", ySplit: 8 }],
        pageSetup: {
          paperSize: 9,
          orientation: name === "EQUITY" ? "landscape" : "portrait",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        },
      }),
    ])
  ) as Record<ReportSheet, ExcelJS.Worksheet>
  const raw = workbook.addWorksheet("Trial balance", { state: "hidden" })
  raw.addRow(["Year", "Ledger", "Amount", "Schedule"])
  for (const record of records)
    for (const row of record.rows)
      raw.addRow([
        record.year,
        row.ledgerName,
        Math.round(row.amount * 100) / 100,
        row.scheduleKey,
      ])
  raw.getColumn(3).numFmt = format
  const lastRaw = raw.rowCount

  function heading(
    sheet: ExcelJS.Worksheet,
    title: string,
    lastColumn: number
  ) {
    sheet.mergeCells(2, 2, 2, lastColumn)
    sheet.getCell(2, 2).value = records[0].clientName
    sheet.getCell(2, 2).font = { name: "Cambria", size: 14, bold: true }
    sheet.mergeCells(3, 2, 3, lastColumn)
    sheet.getCell(3, 2).value = title
    sheet.getCell(3, 2).font = { name: "Cambria", size: 11, bold: true }
    sheet.getCell(3, 2).alignment = { wrapText: true, vertical: "middle" }
    sheet.getRow(3).height = 34
    sheet.properties.defaultRowHeight = 18
    sheet.headerFooter.oddFooter = "FinScope AI | &P of &N"
  }
  for (const sheet of Object.values(sheets)) {
    sheet.getColumn(1).width = 3
    sheet.getColumn(2).width = 7
    sheet.getColumn(3).width = 47
    sheet.getColumn(4).width = 7
    sheet.getColumn(5).width = 3
  }
  const col = (n: number) => sheets.BS.getColumn(n).letter
  const lastColumn = Math.max(8, 6 + (records.length - 1) * 2)
  heading(
    sheets.BS,
    "STATEMENT OF FINANCIAL POSITION AS AT 31 DECEMBER",
    lastColumn
  )
  heading(
    sheets.INCOME,
    "STATEMENT OF COMPREHENSIVE INCOME FOR THE YEAR ENDED 31 DECEMBER",
    lastColumn
  )
  const scheduleLast = Math.max(10, 8 + (records.length - 1) * 2)
  heading(
    sheets.schedules,
    "NOTES TO THE ACCOUNTS FOR THE YEAR ENDED 31 DECEMBER",
    scheduleLast
  )
  for (const n of [4, 5, 6, 7])
    sheets.schedules.getColumn(n).width = n === 7 ? 3 : 2
  heading(
    sheets.EQUITY,
    "STATEMENT OF CHANGES IN EQUITY FOR THE YEAR ENDED 31 DECEMBER",
    8
  )

  const groupStarts: [number, number][] = [
    [7, 4],
    [11, 5],
    [15, 6],
    [19, 7],
    [27, 8],
    [32, 9],
    [37, 10],
    [42, 11],
    [46, 12],
    [53, 13],
    [58, 14],
    [64, 15],
    [69, 16],
    [73, 17],
    [77, 18],
    [93, 19],
    [99, 3],
    [103, 20],
    [109, 21],
  ]
  for (const [row, note] of groupStarts) {
    sheets.schedules.getCell(row, 2).value = note
    sheets.schedules.mergeCells(row, 3, row, 7)
    sheets.schedules.getCell(row, 3).value = scheduleLines.find(
      (line) => line.note === note
    )!.group
    sheets.schedules.getRow(row).font = {
      name: "Cambria",
      size: 11,
      bold: true,
    }
  }

  function labelLines(
    sheet: ExcelJS.Worksheet,
    lines: ReportLine[],
    schedule = false
  ) {
    for (const line of lines) {
      const start = schedule ? 3 : 2
      const end = schedule ? 7 : 3
      sheet.mergeCells(line.row, start, line.row, end)
      sheet.getCell(line.row, start).value = line.label
      if (!schedule && line.note) sheet.getCell(line.row, 4).value = line.note
      sheet.getRow(line.row).height = line.label.length > 35 ? 30 : 21
      sheet.getCell(line.row, start).alignment = {
        wrapText: true,
        vertical: "middle",
      }
      if (line.kind)
        sheet.getRow(line.row).font = { name: "Cambria", size: 10, bold: true }
    }
  }
  labelLines(sheets.schedules, records[0].statements.schedules, true)
  labelLines(sheets.BS, records[0].statements.bs)
  labelLines(sheets.INCOME, records[0].statements.income)
  sheets.BS.getCell("D5").value = "Note"
  sheets.INCOME.getCell("D5").value = "Note"

  records.forEach((record, index) => {
    const financialColumn = 6 + index * 2
    const scheduleColumn = 8 + index * 2
    for (const name of ["schedules", "BS", "INCOME"] as const) {
      const sheet = sheets[name]
      const column = name === "schedules" ? scheduleColumn : financialColumn
      sheet.getColumn(column).width = 20
      sheet.getColumn(column + 1).width = 3
      sheet.getCell(5, column).value = record.year
      sheet.getCell(7, column).value = currency
      sheet.getColumn(column).numFmt = format
      sheet.getCell(5, column).numFmt = "0"
      const lines =
        name === "schedules"
          ? record.statements.schedules
          : name === "BS"
            ? record.statements.bs
            : record.statements.income
      for (const line of lines) {
        if (line.amount === null) {
          if (name === "schedules")
            sheet.getCell(line.row, column).value = "n.a."
          continue
        }
        const cell = sheet.getCell(line.row, column)
        if (line.source) {
          const formula = line.source.replace(
            /([SIB]):(\d+)/g,
            (_, type: string, row: string) =>
              `${type === "S" ? "schedules" : type === "I" ? "INCOME" : "BS"}!${col(type === "S" ? scheduleColumn : financialColumn)}${row}`
          )
          cell.value = { formula, result: line.amount }
        } else if (name === "schedules") {
          const definition = scheduleLines.find((item) => item.row === line.row)
          cell.value = definition
            ? {
                formula: `SUMIFS('Trial balance'!$C$2:$C$${lastRaw},'Trial balance'!$A$2:$A$${lastRaw},${col(column)}$5,'Trial balance'!$D$2:$D$${lastRaw},"${definition.key}")*${definition.sign}`,
                result: line.amount,
              }
            : line.amount
        } else cell.value = line.amount
        if (line.kind === "total")
          cell.border = { top: { style: "thin" }, bottom: { style: "double" } }
      }
    }
    const sheet = sheets.EQUITY
    const start = 6 + index * 12
    sheet.getCell(start, 2).value = record.year
    const titles = [
      "Share capital",
      "Current year earnings",
      "Retained earnings",
      "Shareholders current account",
      "Total",
    ]
    titles.forEach((title, i) => {
      sheet.getCell(start + 1, i + 4).value = title
      sheet.getColumn(i + 4).width = 19
    })
    sheet.getRow(start + 1).height = 32
    const keys = ["capital", "earnings", "retained", "shareholder"] as const
    record.statements.equity.forEach((line, j) => {
      const row = start + 2 + j
      sheet.mergeCells(row, 2, row, 3)
      sheet.getCell(row, 2).value = line.label
      sheet.getRow(row).height = 25
      line.values.forEach((value, i) => {
        const cell = sheet.getCell(row, i + 4)
        cell.numFmt = format
        if (value === null) {
          cell.value = "n.a."
          return
        }
        const letter = col(i + 4)
        const scheduleLetter = col(scheduleColumn)
        const financialLetter = col(financialColumn)
        if (i === 4)
          cell.value = { formula: `SUM(D${row}:G${row})`, result: value }
        else if (j === 0) cell.value = record.openingEquity![keys[i]]
        else if (j === 1)
          cell.value =
            i === 1
              ? { formula: `INCOME!${financialLetter}16`, result: value }
              : 0
        else if (j === 2)
          cell.value =
            i === 1
              ? { formula: `-E${start + 2}`, result: value }
              : i === 2
                ? { formula: `E${start + 2}`, result: value }
                : 0
        else if (j === 3)
          cell.value =
            i === 2
              ? { formula: `-schedules!${scheduleLetter}106`, result: value }
              : 0
        else if (j === 4) {
          const formulas = [
            `schedules!${scheduleLetter}104-D${start + 2}`,
            "0",
            `schedules!${scheduleLetter}105-F${start + 2}-E${start + 2}`,
            `schedules!${scheduleLetter}67-G${start + 2}`,
          ]
          cell.value = { formula: formulas[i], result: value }
        } else if (record.openingEquity)
          cell.value = {
            formula: `SUM(${letter}${start + 2}:${letter}${row - 1})`,
            result: value,
          }
        else
          cell.value = {
            formula: `BS!${financialLetter}${[46, 47, 48, 49][i]}`,
            result: value,
          }
        if (line.kind === "total")
          cell.border = { top: { style: "thin" }, bottom: { style: "double" } }
      })
      if (line.kind === "total")
        sheet.getRow(row).font = { name: "Cambria", size: 10, bold: true }
    })
    sheet.getCell(start + 9, 2).value = currency
  })

  for (const sheet of Object.values(sheets)) {
    const lastRow = sheet.rowCount + 3
    const width =
      sheet.name === "EQUITY"
        ? 8
        : sheet.name === "schedules"
          ? scheduleLast
          : lastColumn
    const warnings = records.flatMap((record) =>
      record.statements.warnings.map((warning) => `${record.year}: ${warning}`)
    )
    const notes = [
      "Management financial statements. Not an audit opinion.",
      ...warnings,
    ]
    notes.forEach((note, i) => {
      sheet.mergeCells(lastRow + i, 2, lastRow + i, width)
      const cell = sheet.getCell(lastRow + i, 2)
      cell.value = note
      cell.alignment = { wrapText: true }
      sheet.getRow(lastRow + i).height = 30
    })
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        cell.font = { name: "Cambria", size: 10, ...cell.font }
        cell.alignment = { vertical: "middle", ...cell.alignment }
      })
    )
    sheet.pageSetup.printArea = `A1:${col(width)}${sheet.rowCount}`
    sheet.pageSetup.printTitlesRow =
      sheet.name === "EQUITY"
        ? "1:3"
        : sheet.name === "schedules"
          ? "1:5"
          : "1:7"
  }
  return workbook.xlsx.writeBuffer()
}
