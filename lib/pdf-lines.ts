/**
 * Rebuilds readable lines from PDF text items (pdf.js getTextContent).
 * Items on the same baseline become one line; wide gaps between items become
 * three spaces, which the document parsers treat as a column break.
 */
export type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  height?: number
}

export function itemsToLines(items: PdfTextItem[]): string[] {
  const cells = items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      size: Math.abs(item.height || item.transform[3] || item.transform[0] || 10),
    }))
  const rows: (typeof cells)[] = []
  for (const cell of cells.sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r[0].y - cell.y) <= Math.max(2, r[0].size * 0.35))
    if (row) row.push(cell)
    else rows.push([cell])
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x)
    let line = ""
    let end = -Infinity
    for (const cell of row) {
      const gap = cell.x - end
      if (line) line += gap > Math.max(8, cell.size * 1.4) ? "   " : gap > cell.size * 0.12 ? " " : ""
      line += cell.text
      end = cell.x + cell.width
    }
    return line.replace(/\s+$/, "")
  })
}

/* ---------------- OCR (tesseract.js blocks output) ---------------- */

export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
export type OcrBlock = { paragraphs: { lines: { words: OcrWord[] }[] }[] }

/**
 * Lines from OCR word boxes. Low-confidence words (mostly Arabic read as
 * Latin) are dropped, wide gaps become column breaks, and value lines that
 * wrap above or below a vertically centred label are joined to that label.
 */
export function ocrToLines(blocks: OcrBlock[], pageWidth: number): string[] {
  type Cell = { x0: number; x1: number; text: string }
  type Row = { y: number; h: number; cells: Cell[] }
  // Rows are rebuilt from word positions: OCR often returns a label column and its value column as separate lines.
  const words = blocks
    .flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
    // Low-confidence words are mostly Arabic read as Latin, on the right. A capitalised word on the
    // English side is kept even when OCR is unsure of it (italic text often scores near zero).
    .filter(
      (w) =>
        w.text.trim() &&
        (w.confidence >= 30 || (w.bbox.x0 < pageWidth * 0.55 && /^[[(]?[A-Z][a-z]{2,}[\])]?[.,:]?$/.test(w.text)))
    )
    .map((w) => ({ ...w, cy: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 }))
    .sort((a, b) => a.cy - b.cy)
  const groups: (typeof words)[] = []
  for (const word of words) {
    const group = groups[groups.length - 1]
    const center = group ? group.reduce((s, w) => s + w.cy, 0) / group.length : 0
    const height = group ? Math.max(...group.map((w) => w.h)) : 0
    if (group && Math.abs(word.cy - center) <= Math.max(height, word.h) * 0.5) group.push(word)
    else groups.push([word])
  }
  const rows: Row[] = []
  for (const group of groups) {
    group.sort((a, b) => a.bbox.x0 - b.bbox.x0)
    const heights = group.map((w) => w.h).sort((a, b) => a - b)
    const h = heights[Math.floor(heights.length / 2)] || 20
    const cells: Cell[] = []
    for (const w of group) {
      const last = cells[cells.length - 1]
      if (last && w.bbox.x0 - last.x1 < h * 1.6) {
        last.text += ` ${w.text}`
        last.x1 = w.bbox.x1
      } else cells.push({ x0: w.bbox.x0, x1: w.bbox.x1, text: w.text })
    }
    rows.push({ y: group.reduce((s, w) => s + w.cy, 0) / group.length, h, cells })
  }
  rows.sort((a, b) => a.y - b.y)

  // Value column: the usual start of the second cell on lines that begin at the left margin.
  const margin = pageWidth * 0.15
  const starts = rows.filter((r) => r.cells[0].x0 < margin && r.cells[1]).map((r) => Math.round(r.cells[1].x0 / 20) * 20)
  const counts = new Map<number, number>()
  for (const s of starts) counts.set(s, (counts.get(s) ?? 0) + 1)
  const valueX = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (valueX !== undefined && (counts.get(valueX) ?? 0) >= 3) {
    const valueCell = (r: Row) => r.cells.find((c, i) => i > 0 && Math.abs(c.x0 - valueX) < 60)
    const isLabel = (r: Row) => r.cells[0].x0 < margin && r.cells[0].x1 < valueX - 20 && r.cells[0].text.split(" ").length <= 5
    const isValueOnly = (r: Row) => Math.abs(r.cells[0].x0 - valueX) < 60
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!isValueOnly(row)) continue
      // Nearest label above or below; a label without its own value is preferred (centred labels).
      const options = [
        { label: rows[i - 1], above: true },
        { label: rows[i + 1], above: false },
      ]
        .filter((o) => o.label && isLabel(o.label) && Math.abs(o.label.y - row.y) < row.h * 2.4)
        .map((o) => ({ ...o, score: Math.abs(o.label.y - row.y) + (valueCell(o.label) ? row.h : 0) }))
        .sort((a, b) => a.score - b.score)
      const target = options[0]
      if (!target) continue
      let cell = valueCell(target.label)
      if (!cell) {
        cell = { x0: valueX, x1: valueX, text: "" }
        target.label.cells.splice(1, 0, cell)
      }
      cell.text = target.above ? `${cell.text} ${row.cells[0].text}`.trim() : `${row.cells[0].text} ${cell.text}`.trim()
      rows.splice(i, 1)
      i--
    }
  }
  return rows.map((r) => r.cells.map((c) => c.text.trim()).join("   "))
}

export type Reread = (bbox: OcrWord["bbox"], scale: number) => Promise<{ text: string; confidence: number }>

const digitsOf = (text: string) => text.replace(/\D/g, "")

/**
 * Second opinion on numbers OCR was unsure of. Each low-confidence number is
 * re-read from an enlarged crop; if that disagrees, a third reading at another
 * size decides. A number only changes when two readings agree on the new value.
 * Mutates the blocks in place.
 */
export async function refineNumbers(blocks: OcrBlock[], reread: Reread, limit = 60) {
  const words = blocks
    .flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
    .filter((w) => /\d/.test(w.text) && w.confidence < 85)
    .slice(0, limit)
  const clean = (text: string) => text.trim().replace(/(\d)[,.] (\d{3})/g, "$1,$2").replace(/\s+/g, "")
  for (const word of words) {
    const original = digitsOf(word.text)
    const first = clean((await reread(word.bbox, 3)).text)
    if (!digitsOf(first) || digitsOf(first) === original || digitsOf(first).length !== original.length) continue
    const second = clean((await reread(word.bbox, 2)).text)
    if (digitsOf(second) === digitsOf(first)) {
      // Two enlarged readings agree against the first pass: take their digits, keep the original punctuation where possible.
      word.text = first
      word.confidence = 90
    }
  }
}
