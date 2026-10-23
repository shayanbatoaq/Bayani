import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFile, mkdir } from "node:fs/promises"
import { DOMParser, XMLSerializer } from "@xmldom/xmldom"
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate"

const require = createRequire(
  process.env.BAYANI_TEST_DEPS || process.env.FINSCOPE_TEST_DEPS
    ? `${process.env.BAYANI_TEST_DEPS || process.env.FINSCOPE_TEST_DEPS}/package.json`
    : import.meta.url
)
const { chromium } = require("playwright")
const { PDFDocument, StandardFonts } = require("pdf-lib")
const base = process.env.BAYANI_TEST_URL || process.env.FINSCOPE_TEST_URL || "http://127.0.0.1:3000"
const output = process.env.BAYANI_TEST_OUTPUT || process.env.FINSCOPE_TEST_OUTPUT || ".next/qa"
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
page.setDefaultTimeout(20000)

async function visible(locator) {
  await locator.waitFor({ state: "visible" })
}
async function hasText(text) {
  await visible(page.getByText(text, { exact: true }))
}
async function file(name, buffer, mimeType) {
  await page
    .getByLabel("Trial balance file", { exact: true })
    .setInputFiles({ name, buffer: Buffer.from(buffer), mimeType })
  await page
    .getByRole("button", { name: "Choose a file or drop it here" })
    .waitFor()
}
async function noOverflow() {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    "Page should not overflow horizontally"
  )
}
async function screenshot(name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }))
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
}

try {
  await page.goto(`${base}/data-input`)
  await visible(page.getByRole("button", { name: /Enter it manually/ }))
  assert.equal(await page.getByRole("table").count(), 0)
  assert.equal(
    await page
      .locator(
        'a[href="/mapping"],a[href="/processing"],a[href="/financial-statements"]'
      )
      .count(),
    0
  )
  await screenshot("data-input-desktop")

  await page.getByRole("button", { name: /Enter it manually/ }).click()
  await page.getByLabel("Name of ledger", { exact: true }).fill("Bank")
  await page.getByLabel("Amount", { exact: true }).fill("not an amount")
  assert.equal(
    await page
      .getByRole("button", { name: "Add ledger", exact: true })
      .isDisabled(),
    true
  )
  await page.getByLabel("Amount", { exact: true }).fill("1,250.50")
  await page.getByRole("button", { name: "Add ledger", exact: true }).click()
  await hasText("1 ledgers")
  await page.getByRole("button", { name: "Edit Bank", exact: true }).click()
  await page.getByLabel("Amount", { exact: true }).fill("1500")
  await page.getByRole("button", { name: "Save ledger", exact: true }).click()
  await page.getByRole("tab", { name: "Account mapping", exact: true }).click()
  await page
    .getByRole("combobox", { name: "Category for Bank", exact: true })
    .click()
  await page
    .getByRole("option", { name: "Non-Current Assets", exact: true })
    .click()
  await hasText("1 of 1 mappings reviewed")
  await page.getByRole("tab", { name: "Preview", exact: true }).click()
  await page.getByRole("button", { name: /Upload trial balance XLSX/ }).click()
  await visible(page.getByRole("link", { name: "Download template" }))
  const download = await page.request.get(
    `${base}/templates/trial-balance-template.xlsx`
  )
  const template = await readFile(
    "public/templates/trial-balance-template.xlsx"
  )
  assert.deepEqual(await download.body(), template)
  await file(
    "Trial Balance Template.xlsx",
    template,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
  await visible(page.locator('p[role="alert"]'))
  await hasText("1 ledgers")

  await file(
    "quoted.csv",
    'Account,Amount\n"Bank, operating","1,250.50"\nRevenue,-1250.50\nBad,abc',
    "text/csv"
  )
  await hasText("3 ledgers")
  await visible(page.getByText(/1 rows with missing or invalid/))
  await page.getByRole("tab", { name: "Account mapping", exact: true }).click()
  await hasText("Non-Current Assets")
  await page.getByRole("tab", { name: "Preview", exact: true }).click()

  const zip = unzipSync(template)
  const path = "xl/worksheets/sheet1.xml"
  const xml = new DOMParser().parseFromString(strFromU8(zip[path]), "text/xml")
  const ns = xml.documentElement.namespaceURI
  for (const row of Array.from(xml.getElementsByTagName("row"))) {
    const index = Number(row.getAttribute("r"))
    if (index < 2) continue
    let cell = Array.from(row.getElementsByTagName("c")).find(
      (cell) => cell.getAttribute("r") === `C${index}`
    )
    if (!cell) {
      cell = xml.createElementNS(ns, "c")
      cell.setAttribute("r", `C${index}`)
      row.appendChild(cell)
    }
    while (cell.firstChild) cell.removeChild(cell.firstChild)
    cell.removeAttribute("t")
    const value = xml.createElementNS(ns, "v")
    value.appendChild(xml.createTextNode(String((index - 1) * 100)))
    cell.appendChild(value)
  }
  zip[path] = strToU8(new XMLSerializer().serializeToString(xml))
  await page.getByRole("radio", { name: /Replace all/ }).check()
  await file(
    "filled-template.xlsx",
    zipSync(zip),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
  await hasText("41 ledgers")
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await page.getByRole("button", { name: "Next page", exact: true }).click()
  await hasText("Dividends")

  const multi = unzipSync(template)
  multi["xl/worksheets/sheet2.xml"] = zip[path]
  for (const [entry, parentTag, childTag, attributes] of [
    [
      "xl/workbook.xml",
      "sheets",
      "sheet",
      { name: "Filled ledgers", sheetId: "2", "r:id": "rIdFinscopeTest" },
    ],
    [
      "xl/_rels/workbook.xml.rels",
      "Relationships",
      "Relationship",
      {
        Id: "rIdFinscopeTest",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        Target: "worksheets/sheet2.xml",
      },
    ],
    [
      "[Content_Types].xml",
      "Types",
      "Override",
      {
        PartName: "/xl/worksheets/sheet2.xml",
        ContentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
      },
    ],
  ]) {
    const document = new DOMParser().parseFromString(
      strFromU8(multi[entry]),
      "text/xml"
    )
    const parent = document.getElementsByTagName(parentTag)[0]
    const child = document.createElementNS(parent.namespaceURI, childTag)
    for (const [key, value] of Object.entries(attributes))
      child.setAttribute(key, value)
    parent.appendChild(child)
    multi[entry] = strToU8(new XMLSerializer().serializeToString(document))
  }
  await file(
    "multiple-sheets.xlsx",
    zipSync(multi),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
  await page.getByLabel("Worksheet", { exact: true }).selectOption("1")
  await page
    .getByRole("button", { name: "Import worksheet", exact: true })
    .click()
  await hasText("41 ledgers")
  await hasText("Revenue")

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) {
    const sheet = pdf.addPage([600, 800])
    const draw = (text, x, y) => sheet.drawText(text, { x, y, size: 12, font })
    draw("Account", 55, 750)
    draw("Amount", 440, 750)
    draw(i ? "Revenue" : "Bank", 55, 720)
    draw(i ? "-1,000.00" : "1,000.00", 440, 720)
  }
  await file("trial-balance.pdf", await pdf.save(), "application/pdf")
  await hasText("2 ledgers")
  await hasText("Bank")
  await hasText("Revenue")
  await page.getByRole("tab", { name: "Account mapping", exact: true }).click()
  await page.getByRole("button", { name: "Accept page suggestions" }).click()
  await hasText("2 of 2 mappings reviewed")
  await screenshot("data-input-mapping-desktop")
  await noOverflow()

  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow()
  await screenshot("data-input-mapping-mobile")
  await page.getByRole("tab", { name: "Preview", exact: true }).click()
  await page.getByRole("button", { name: "Edit Bank", exact: true }).click()
  await noOverflow()
  await screenshot("data-input-manual-mobile")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Remove Bank", exact: true }).click()
  await hasText("1 ledgers")

  await page.getByRole("button", { name: /Upload trial balance XLSX/ }).click()
  const imageOnly = await PDFDocument.create()
  imageOnly.addPage([600, 800])
  await file("unreadable.pdf", await imageOnly.save(), "application/pdf")
  await visible(page.locator('p[role="alert"]'))
  await hasText("1 ledgers")
  assert.match(
    await page.locator('p[role="alert"]').innerText(),
    /No readable ledger table/
  )
  await file("broken.csv", 'Account,Amount\n"Unclosed,200', "text/csv")
  assert.match(
    await page.locator('p[role="alert"]').innerText(),
    /unmatched quotes/
  )
  for (const route of ["mapping", "processing", "financial-statements"]) {
    const response = await page.request.get(`${base}/${route}`)
    assert.equal(response.status(), 404, `${route} must be removed`)
  }
  await page.reload()
  await visible(page.getByRole("button", { name: /Enter it manually/ }))
  await noOverflow()
  await screenshot("data-input-mobile")
  await page.setViewportSize({ width: 320, height: 700 })
  await noOverflow()
  await page.getByRole("button", { name: /Enter it manually/ }).click()
  await page.getByLabel("Name of ledger", { exact: true }).fill("Bank")
  await page.getByLabel("Amount", { exact: true }).fill("0")
  await page.getByRole("button", { name: "Add ledger", exact: true }).click()
  await noOverflow()
  await page.getByRole("tab", { name: "Account mapping", exact: true }).click()
  await noOverflow()
  assert.deepEqual(errors, [])
  console.log(
    "PASS: manual entry/edit/remove, live mapping, CSV, all 41 XLSX ledgers, PDF pages, import errors, exact template download, removed routes, desktop/mobile layout."
  )
} finally {
  await browser.close()
}
