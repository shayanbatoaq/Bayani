import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdir } from "node:fs/promises"
import ExcelJS from "exceljs"

const require = createRequire(
  process.env.BAYANI_TEST_DEPS || process.env.FINSCOPE_TEST_DEPS
    ? `${process.env.BAYANI_TEST_DEPS || process.env.FINSCOPE_TEST_DEPS}/package.json`
    : import.meta.url
)
const { chromium } = require("playwright")
const base = process.env.BAYANI_TEST_URL || process.env.FINSCOPE_TEST_URL || "http://127.0.0.1:3000"
const output = ".local/qa-financial"
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
page.on("dialog", (dialog) => dialog.accept())
const name = `QA Financial ${Date.now()}`
async function shot(name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
}
async function noOverflow() {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    "No page-wide horizontal overflow"
  )
}
async function addLedger(name, amount) {
  await page.getByLabel("Name of ledger", { exact: true }).fill(name)
  await page.getByLabel("Amount", { exact: true }).fill(String(amount))
  await page.getByRole("button", { name: "Add ledger", exact: true }).click()
}
async function save(year) {
  await page
    .getByRole("button", { name: "Save financial data", exact: true })
    .click()
  await page.getByText(`Saved ${name} for ${year}.`, { exact: true }).waitFor()
}
try {
  await page.goto(`${base}/data-input`)
  await page.getByLabel("Client / company name", { exact: true }).fill(name)
  await page.getByLabel("Reporting year", { exact: true }).fill("2024")
  const nav = await page
    .locator("aside a")
    .evaluateAll((items) => items.map((item) => item.getAttribute("href")))
  assert.equal(nav[nav.indexOf("/data-input") + 1], "/final-report")
  for (const route of ["industry", "ai-cfo-report", "expert-review"])
    assert.equal((await page.request.get(`${base}/${route}`)).status(), 404)
  await page.getByRole("button", { name: /Enter it manually/ }).click()
  for (const ledger of [
    ["Bank", 1800],
    ["Office expenses", 200],
    ["Revenue", -1000],
    ["Share capital", -1000],
  ])
    await addLedger(...ledger)
  await page.getByText("Opening equity for 2024", { exact: true }).click()
  for (const [id, value] of [
    ["capital", 1000],
    ["earnings", 0],
    ["retained", 0],
    ["shareholder", 0],
  ])
    await page.locator(`#opening-${id}`).fill(String(value))
  await page.getByRole("tab", { name: "Account mapping", exact: true }).click()
  assert.equal(
    await page.getByLabel("Schedule for Bank", { exact: true }).inputValue(),
    "bank"
  )
  await page
    .getByLabel("Schedule for Office expenses", { exact: true })
    .selectOption("office")
  await save(2024)
  await shot("saved-data-desktop")
  const firstResponse = await page.request.get(`${base}/api/financial-data`)
  const first = (await firstResponse.json()).records.find(
    (record) => record.clientName === name
  )
  assert.equal(first.statements.netProfit, 800)
  assert.equal(first.statements.balanceDifference, 0)
  assert.equal(
    (
      await page.request.post(`${base}/api/financial-data`, {
        data: { ...first, revision: 0 },
      })
    ).status(),
    409
  )
  assert.equal(
    (
      await page.request.post(`${base}/api/financial-data`, {
        data: {
          ...first,
          year: 2023,
          rows: [{ ...first.rows[0], amount: 1.123 }],
        },
      })
    ).status(),
    400
  )
  assert.equal(
    (
      await page.request.post(`${base}/api/financial-data`, {
        headers: { origin: "https://other.example" },
        data: first,
      })
    ).status(),
    403
  )

  await page.reload()
  await page
    .getByLabel("Saved financial data", { exact: true })
    .selectOption(first.id)
  assert.equal(
    await page
      .getByLabel("Client / company name", { exact: true })
      .inputValue(),
    name
  )
  await page.getByText("Saved", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Add year", exact: true }).click()
  assert.equal(
    await page.getByLabel("Reporting year", { exact: true }).inputValue(),
    "2025"
  )
  await page.getByRole("button", { name: /Enter it manually/ }).click()
  for (const ledger of [
    ["Bank", 2100],
    ["Office expenses", 200],
    ["Revenue", -600],
    ["Share capital", -1000],
    ["Retained earnings", -800],
    ["Dividends", 100],
  ])
    await addLedger(...ledger)
  await page.getByText("Opening equity for 2025", { exact: true }).click()
  assert.equal(await page.locator("#opening-earnings").inputValue(), "800")
  await save(2025)
  await page.getByRole("link", { name: "Final report", exact: true }).click()
  await page.getByLabel("Client", { exact: true }).selectOption(first.clientId)
  await page.getByRole("checkbox", { name: "2024 AED", exact: true }).check()
  await page
    .getByRole("tab", { name: "BS · Balance sheet", exact: true })
    .click()
  await page.getByLabel("Preview year", { exact: true }).selectOption("2025")
  assert.match(
    await page.getByRole("row").filter({ hasText: "TOTAL ASSETS" }).innerText(),
    /2,100\.00/
  )
  await noOverflow()
  await shot("final-report-desktop")
  const downloadEvent = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Download Excel", exact: true })
    .click()
  const download = await downloadEvent
  const xlsxPath = `${output}/financial-2025-2024.xlsx`
  await download.saveAs(xlsxPath)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(xlsxPath)
  assert.deepEqual(
    workbook.worksheets
      .filter((sheet) => sheet.state === "visible")
      .map((sheet) => sheet.name),
    ["schedules", "BS", "INCOME", "EQUITY"]
  )
  assert.equal(workbook.getWorksheet("BS").getCell("F5").value, 2025)
  assert.equal(workbook.getWorksheet("BS").getCell("H5").value, 2024)
  assert.equal(workbook.getWorksheet("BS").getCell("F25").result, 2100)
  assert.equal(workbook.getWorksheet("BS").getCell("H25").result, 1800)
  assert.equal(workbook.getWorksheet("INCOME").getCell("F16").result, 400)
  assert.equal(workbook.getWorksheet("INCOME").getCell("H16").result, 800)
  assert.equal(workbook.getWorksheet("EQUITY").getCell("H13").result, 2100)
  assert.equal(workbook.getWorksheet("schedules").getCell("H59").value, "n.a.")
  assert.match(
    workbook.getWorksheet("BS").getCell("F25").formula,
    /BS!F13\+BS!F22/
  )
  for (const sheet of workbook.worksheets)
    sheet.eachRow((row) =>
      row.eachCell((cell) =>
        assert.ok(!JSON.stringify(cell.value).includes("#REF!"))
      )
    )
  await page.getByRole("checkbox", { name: "2024 AED", exact: true }).uncheck()
  const pdfEvent = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download PDF", exact: true }).click()
  await (await pdfEvent).saveAs(`${output}/financial-2025.pdf`)

  const exportUrl = (
    years,
    sheets = "schedules,BS,INCOME,EQUITY",
    format = "xlsx"
  ) =>
    `${base}/api/financial-data/export?${new URLSearchParams({ clientId: first.clientId, years, sheets, format })}`
  const onlyIncome = await page.request.get(exportUrl("2024", "INCOME"))
  assert.equal(onlyIncome.status(), 200)
  const single = new ExcelJS.Workbook()
  await single.xlsx.load(await onlyIncome.body())
  assert.deepEqual(
    single.worksheets
      .filter((sheet) => sheet.state === "visible")
      .map((sheet) => sheet.name),
    ["INCOME"]
  )
  assert.equal(single.getWorksheet("INCOME").getCell("F16").result, 800)
  assert.equal(single.getWorksheet("Trial balance").rowCount, 5)
  assert.equal((await page.request.get(exportUrl("2022"))).status(), 404)
  const isolated = await browser.newContext()
  assert.deepEqual(
    (await (await isolated.request.get(`${base}/api/financial-data`)).json())
      .records,
    []
  )
  assert.equal((await isolated.request.get(exportUrl("2024"))).status(), 404)
  await isolated.close()
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow()
  await shot("final-report-mobile")
  await page.getByRole("tab", { name: "EQUITY", exact: true }).click()
  await noOverflow()
  await shot("equity-mobile")
  await page.goto(`${base}/audit`)
  await page.getByRole("dialog").waitFor()
  assert.equal(
    await page.getByRole("link", { name: "Contact AMA", exact: true }).count(),
    0
  )
  await noOverflow()
  await shot("ama-popup-mobile")
  await page.getByRole("button", { name: "Not now", exact: true }).click()
  await page
    .getByRole("button", { name: "Contact AMA for expert review", exact: true })
    .click()
  await page.getByRole("dialog").waitFor()
  await page
    .getByRole("button", { name: "Close expert review popup", exact: true })
    .click()
  await page.goto(`${base}/data-input`)
  await page
    .getByLabel("Saved financial data", { exact: true })
    .selectOption(first.id)
  await noOverflow()
  await shot("saved-data-mobile")
  assert.deepEqual(errors, [])
  console.log(
    "PASS: removed routes, sidebar order, manual ledger mapping, save/reload, next-year opening equity, two-year XLSX formulas, selected-sheet/year export, PDF download, validation, revision conflicts, workspace isolation, AMA popup, desktop/mobile layout."
  )
} finally {
  await browser.close()
}
