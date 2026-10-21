// Copies the OCR engine (tesseract.js worker, WebAssembly core, English model) into public/ocr
// so scanned documents are read locally, without fetching anything from a CDN.
import { cp, mkdir, readdir, stat } from "node:fs/promises"
import path from "node:path"

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname))
const out = path.join(root, "public", "ocr")
const mod = (...p) => path.join(root, "node_modules", ...p)

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

await mkdir(path.join(out, "core"), { recursive: true })
await mkdir(path.join(out, "lang"), { recursive: true })
await cp(mod("tesseract.js", "dist", "worker.min.js"), path.join(out, "worker.min.js"))
for (const file of await readdir(mod("tesseract.js-core")))
  if (/^tesseract-core.*lstm\.wasm\.js$/.test(file) || /^tesseract-core.*lstm\.wasm$/.test(file) || /^tesseract-core.*lstm\.js$/.test(file))
    await cp(mod("tesseract.js-core", file), path.join(out, "core", file))
const lang = mod("@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz")
if (!(await exists(lang))) throw new Error("English OCR model missing: run npm install")
await cp(lang, path.join(out, "lang", "eng.traineddata.gz"))
console.log("OCR assets ready in public/ocr")
