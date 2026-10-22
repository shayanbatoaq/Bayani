import "server-only"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  companyDraftSchema,
  companyExtrasSchema,
  type Company,
  type CompanyDraft,
} from "./company"
import { FinancialError, ownerDirectory } from "./financial-store"

/**
 * Companies a profile may hold. The live product includes one company per subscription;
 * each further company is a paid add-on, recorded per profile in plan.json
 * ({ "extraCompanies": n }) by the billing step. Test mode (development, or
 * FINSCOPE_TEST_MODE=true) allows several companies without payment.
 * FINSCOPE_COMPANY_LIMIT overrides both.
 */
export const INCLUDED_COMPANIES = 1
export const TEST_MODE_COMPANIES = 10

export function companyTestMode() {
  return process.env.FINSCOPE_TEST_MODE === "true" || (process.env.NODE_ENV !== "production" && process.env.FINSCOPE_TEST_MODE !== "false")
}

export async function paidExtraCompanies(owner: string) {
  try {
    const plan = JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "plan.json"), "utf8")) as { extraCompanies?: unknown }
    const extra = Number(plan.extraCompanies)
    return Number.isInteger(extra) && extra > 0 ? Math.min(extra, 500) : 0
  } catch {
    return 0
  }
}

export async function companyLimit(owner: string) {
  const fixed = Number(process.env.FINSCOPE_COMPANY_LIMIT)
  if (process.env.FINSCOPE_COMPANY_LIMIT && Number.isInteger(fixed) && fixed > 0) return fixed
  if (companyTestMode()) return TEST_MODE_COMPANIES
  return INCLUDED_COMPANIES + (await paidExtraCompanies(owner))
}

function directory(owner: string) {
  return path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "companies")
}

export async function listCompanies(owner: string): Promise<Company[]> {
  let files: string[]
  try {
    files = await readdir(directory(owner))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const companies = await Promise.all(
    files
      .filter((file) => /^[a-f0-9-]{36}\.json$/.test(file))
      .map(async (file) => {
        const raw = JSON.parse(await readFile(path.join(directory(owner), file), "utf8"))
        return { ...raw, ...companyExtrasSchema.parse(raw) } as Company
      })
  )
  return companies.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getCompany(owner: string, id: string) {
  return (await listCompanies(owner)).find((company) => company.id === id) ?? null
}

async function write(owner: string, company: Company) {
  await mkdir(directory(owner), { recursive: true })
  const file = path.join(directory(owner), `${company.id}.json`)
  const temporary = `${file}-${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(company), { encoding: "utf8", mode: 0o600 })
  await rename(temporary, file)
  return company
}

export async function saveCompany(
  owner: string,
  input: {
    id?: string
    revision?: number
    draft: CompanyDraft
    documents?: Company["documents"]
  }
) {
  const draft = companyDraftSchema.parse(input.draft)
  const companies = await listCompanies(owner)
  const now = new Date().toISOString()
  if (!input.id) {
    if (companies.length >= (await companyLimit(owner)))
      throw new FinancialError(
        "Your subscription includes one company. Each additional company is a paid add-on.",
        402
      )
    return write(owner, {
      ...draft,
      id: randomUUID(),
      revision: 1,
      createdAt: now,
      updatedAt: now,
      customHeads: [],
      vatOverrides: {},
      ctAnswers: {},
      logo: null,
      bankRules: [],
      vatFilings: {},
      vatSettings: {},
      documents: input.documents ?? [],
    })
  }
  const existing = companies.find((company) => company.id === input.id)
  if (!existing) throw new FinancialError("Company not found.", 404)
  if ((input.revision ?? 0) !== existing.revision)
    throw new FinancialError(
      "This company was changed elsewhere. Reload before saving.",
      409
    )
  return write(owner, {
    ...existing,
    ...draft,
    documents: [...existing.documents, ...(input.documents ?? [])].slice(-20),
    revision: existing.revision + 1,
    updatedAt: now,
  })
}

/** Update the company's working data (custom heads, VAT figures) without a revision check. */
export async function updateCompanyExtras(
  owner: string,
  id: string,
  patch: Partial<Pick<Company, "customHeads" | "vatOverrides" | "ctAnswers" | "vatFilings" | "vatSettings" | "logo" | "bankRules">>
) {
  const existing = await getCompany(owner, id)
  if (!existing) throw new FinancialError("Company not found.", 404)
  const extras = companyExtrasSchema.parse({ ...existing, ...patch })
  return write(owner, {
    ...existing,
    ...extras,
    updatedAt: new Date().toISOString(),
  })
}


/** Remove a company together with every year of figures saved for it. */
export async function deleteCompany(owner: string, id: string) {
  const existing = await getCompany(owner, id)
  if (!existing) throw new FinancialError("Company not found.", 404)
  await rm(path.join(directory(owner), `${id}.json`), { force: true })
  await removeLogoFiles(owner, id)
  let files: string[] = []
  try {
    files = await readdir(ownerDirectory(owner))
  } catch {}
  await Promise.all(
    files
      .filter((file) => file.startsWith(`${id}-`) && file.endsWith(".json"))
      .map((file) => rm(path.join(ownerDirectory(owner), file), { force: true }))
  )
  return existing
}

/* ---------------------------------------------------------------- logo */

const LOGO_LIMIT = 1024 * 1024
function logoPath(owner: string, id: string, type: "png" | "jpeg") {
  return path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "logos", `${id}.${type === "png" ? "png" : "jpg"}`)
}
async function removeLogoFiles(owner: string, id: string) {
  await Promise.all((["png", "jpeg"] as const).map((type) => rm(logoPath(owner, id, type), { force: true })))
}

/** Stores a PNG or JPEG logo (checked by its file signature, at most 1 MB). */
export async function saveCompanyLogo(owner: string, id: string, bytes: Buffer) {
  const existing = await getCompany(owner, id)
  if (!existing) throw new FinancialError("Company not found.", 404)
  if (bytes.length > LOGO_LIMIT) throw new FinancialError("The logo must be 1 MB or smaller.", 413)
  const type = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ? "png"
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "jpeg"
      : null
  if (!type) throw new FinancialError("Upload the logo as a PNG or JPG image.", 415)
  await mkdir(path.dirname(logoPath(owner, id, type)), { recursive: true })
  await removeLogoFiles(owner, id)
  await writeFile(logoPath(owner, id, type), bytes, { mode: 0o600 })
  return updateCompanyExtras(owner, id, { logo: { type, updatedAt: new Date().toISOString() } })
}

export async function readCompanyLogo(owner: string, company: Company) {
  if (!company.logo) return null
  try {
    return { type: company.logo.type, bytes: await readFile(logoPath(owner, company.id, company.logo.type)) }
  } catch {
    return null
  }
}

export async function deleteCompanyLogo(owner: string, id: string) {
  await removeLogoFiles(owner, id)
  return updateCompanyExtras(owner, id, { logo: null })
}

/** The logo as a data URI for PDFs. */
export async function logoDataUri(owner: string, company: Company) {
  const logo = await readCompanyLogo(owner, company)
  return logo ? `data:image/${logo.type};base64,${logo.bytes.toString("base64")}` : null
}
