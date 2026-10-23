"use client"

/**
 * Reads uploaded company documents in the browser: the PDF text layer where
 * there is one, OCR for scanned pages and images. Output is plain text with
 * pages separated by form feeds and OCR pages marked "[OCR]", the format the
 * document rules expect.
 */
import { itemsToLines, ocrToLines, refineNumbers, type OcrBlock, type PdfTextItem } from "./pdf-lines"

export type ReadProgress = { file: string; page: number; pages: number; ocr: boolean }

const OCR_SCALE = 300 / 72 // about 300 dpi
const MAX_PAGES = 30

type Worker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>
let workerPromise: Promise<Worker> | null = null

function ocrWorker() {
  workerPromise ??= import("tesseract.js").then(async ({ createWorker }) => {
    const worker = await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      gzip: true,
    })
    // Pages are rendered at 300 dpi; without this tesseract guesses the resolution and misses tables.
    await worker.setParameters({ tessedit_pageseg_mode: "3" as never, user_defined_dpi: "300" })
    return worker
  })
  return workerPromise
}

async function ocrCanvas(canvas: HTMLCanvasElement) {
  const worker = await ocrWorker()
  const { data } = await worker.recognize(canvas, {}, { blocks: true })
  const blocks = (data.blocks ?? []) as unknown as OcrBlock[]
  // Second opinion on uncertain numbers, read from an enlarged crop.
  await refineNumbers(
    blocks,
    async ({ x0, y0, x1, y1 }, scale) => {
      const pad = 12
      const crop = document.createElement("canvas")
      const w = x1 - x0 + pad * 2
      const h = y1 - y0 + pad * 2
      crop.width = w * scale
      crop.height = h * scale
      const ctx = crop.getContext("2d")!
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, crop.width, crop.height)
      ctx.drawImage(canvas, Math.max(0, x0 - pad), Math.max(0, y0 - pad), w, h, 0, 0, crop.width, crop.height)
      // Single line; resolution left for tesseract to estimate on the enlarged crop.
      await worker.setParameters({ tessedit_pageseg_mode: "7" as never, user_defined_dpi: "0" })
      const result = await worker.recognize(crop)
      await worker.setParameters({ tessedit_pageseg_mode: "3" as never, user_defined_dpi: "300" })
      return { text: result.data.text, confidence: result.data.confidence }
    },
    25
  )
  return ocrToLines(blocks, canvas.width).join("\n")
}

async function readPdf(file: File, onProgress?: (p: ReadProgress) => void) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true })
  try {
    const pdf = await task.promise
    const pages: string[] = []
    const count = Math.min(pdf.numPages, MAX_PAGES)
    for (let n = 1; n <= count; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      const lines = itemsToLines(content.items.filter((item) => "str" in item) as unknown as PdfTextItem[])
      const letters = lines.join("").replace(/[^A-Za-z]/g, "").length
      if (letters >= 40) {
        onProgress?.({ file: file.name, page: n, pages: count, ocr: false })
        pages.push(lines.join("\n"))
      } else {
        onProgress?.({ file: file.name, page: n, pages: count, ocr: true })
        const viewport = page.getViewport({ scale: OCR_SCALE })
        const canvas = document.createElement("canvas")
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext("2d")!
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, viewport, canvas } as never).promise
        pages.push(`[OCR]\n${await ocrCanvas(canvas)}`)
      }
      page.cleanup()
    }
    return pages.join("\n\f\n")
  } finally {
    await task.destroy()
  }
}

async function readImage(file: File, onProgress?: (p: ReadProgress) => void) {
  onProgress?.({ file: file.name, page: 1, pages: 1, ocr: true })
  const bitmap = await createImageBitmap(file)
  // Upscale small photos so text is large enough for OCR.
  const scale = Math.max(1, Math.min(3, 2400 / bitmap.width))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return `[OCR]\n${await ocrCanvas(canvas)}`
}

export async function readDocument(file: File, onProgress?: (p: ReadProgress) => void) {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than 25 MB.`)
  const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name)
  if (pdf) return readPdf(file, onProgress)
  if (/^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) return readImage(file, onProgress)
  throw new Error(`${file.name}: upload a PDF, PNG, JPG or WEBP file.`)
}

/** The first pages of a PDF as JPEG images, for a reading that looks at the layout itself. */
export async function pdfPageImages(file: File, maxPages = 2, width = 1400) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true })
  try {
    const pdf = await task.promise
    const images: string[] = []
    for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
      const page = await pdf.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement("canvas")
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext("2d")!
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport, canvas } as never).promise
      images.push(canvas.toDataURL("image/jpeg", 0.8))
      page.cleanup()
    }
    return images
  } finally {
    await task.destroy()
  }
}
