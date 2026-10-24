"use client"

import { parsePdfStatement, parseTableStatement, type ParsedStatement, type TextPage } from "./bank-statement"

/**
 * Reads a bank statement in the browser. The file never leaves the device: only the
 * totals the user accepts are saved.
 */
export class StatementPasswordError extends Error {
  constructor(readonly file: string, readonly wrong: boolean) {
    super(wrong ? `The password for ${file} is not correct.` : `${file} is password protected.`)
  }
}

const MAX_PAGES = 300

async function readPdfPages(file: File, password?: string): Promise<{ pages: TextPage[]; empty: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password, useSystemFonts: true })
  try {
    const pdf = await task.promise
    const pages: TextPage[] = []
    let empty = 0
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items = []
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue
        // Page rotation is applied so landscape statements read like portrait ones.
        const m = pdfjs.Util.transform(viewport.transform, item.transform)
        if (Math.abs(m[1]) > Math.abs(m[0])) continue // vertical text: watermarks and side notes
        items.push({ s: item.str, x: m[4], y: m[5], w: item.width })
      }
      if (items.length < 5) empty++
      pages.push({ items, width: viewport.width, height: viewport.height })
      page.cleanup()
    }
    return { pages, empty }
  } catch (cause) {
    const name = (cause as { name?: string })?.name
    if (name === "PasswordException") throw new StatementPasswordError(file.name, Boolean(password))
    throw cause
  } finally {
    await task.destroy()
  }
}

export async function readStatementFile(file: File, password?: string): Promise<ParsedStatement> {
  if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} is larger than 30 MB.`)
  const extension = file.name.split(".").pop()?.toLowerCase()
  if (extension === "pdf" || file.type === "application/pdf") {
    const { pages, empty } = await readPdfPages(file, password)
    const parsed = parsePdfStatement(pages)
    if (empty === pages.length)
      return { ...parsed, warnings: ["This PDF is a scanned image with no text. Download the statement from online banking as a PDF or Excel file instead."] }
    return parsed
  }
  if (extension === "xlsx" || extension === "csv" || extension === "xls" || extension === "xlsm" || extension === "ods") {
    const sheets = await readSheets(file, extension)
    // Every sheet is read: some banks put each account (or each month) on its own sheet.
    const parsed = sheets.map((sheet) => parseTableStatement(sheet, file.name))
    const accounts = parsed.flatMap((p) => p.accounts)
    if (accounts.length) return { bank: parsed.find((p) => p.accounts.length)!.bank, accounts, warnings: parsed.flatMap((p) => (p.accounts.length ? p.warnings : [])) }
    return parsed[0] ?? parseTableStatement([], file.name)
  }
  throw new Error(`${file.name}: upload the statement as PDF, Excel (XLSX or XLS) or CSV.`)
}

/**
 * The rows of every sheet. XLSX and CSV are read directly; older XLS files, and the HTML or XML
 * "Excel" files many banks export, go through SheetJS.
 */
async function readSheets(file: File, extension: string): Promise<unknown[][][]> {
  if (extension === "xlsx" || extension === "csv") {
    try {
      const { readTrialBalance } = await import("./import-trial-balance")
      const sheets = await readTrialBalance(file)
      if (sheets.some((sheet) => sheet.data.length)) return sheets.map((sheet) => sheet.data)
    } catch {
      // fall through to SheetJS
    }
  }
  const XLSX = await import("xlsx")
  // Dates as the sheet's own day numbers: SheetJS's Dates are local midnight, a day early once read as UTC east of Greenwich.
  const book = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array", dense: true })
  return book.SheetNames.map((name) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }))
}
