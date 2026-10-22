import assert from "node:assert/strict"
import { test } from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)
const { auditRequestInputSchema, auditYearOptions, contactKind } = await jiti.import("../lib/audit-request.ts")

const base = { companyId: "8d2b8a3e-3c5e-4f0b-9b7a-2f1d6c0e9a11", years: [2025, 2024], purpose: "Bank Facility", contact: "+971 50 123 4567" }

test("audit request accepts phone or email and several years", () => {
  assert.equal(auditRequestInputSchema.safeParse(base).success, true)
  assert.equal(auditRequestInputSchema.safeParse({ ...base, contact: "owner@example.ae" }).success, true)
  assert.equal(contactKind("owner@example.ae"), "email")
  assert.equal(contactKind("+971 50 123 4567"), "phone")
})

test("audit request rejects missing years, bad contact and blank other purpose", () => {
  assert.equal(auditRequestInputSchema.safeParse({ ...base, years: [] }).success, false)
  assert.equal(auditRequestInputSchema.safeParse({ ...base, contact: "call me" }).success, false)
  assert.equal(auditRequestInputSchema.safeParse({ ...base, purpose: "Others" }).success, false)
  assert.equal(auditRequestInputSchema.safeParse({ ...base, purpose: "Others", otherPurpose: "Investor due diligence" }).success, true)
  assert.equal(auditRequestInputSchema.safeParse({ ...base, purpose: "Tax" }).success, false)
})

test("audit years include saved years and the last six years", () => {
  const years = auditYearOptions([2018], new Date("2026-10-01"))
  assert.deepEqual(years, [2026, 2025, 2024, 2023, 2022, 2021, 2018])
})
