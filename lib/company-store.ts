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

/** Companies included in a single profile. Further companies are a paid add-on. */
export function companyLimit() {
  const value = Number(process.env.FINSCOPE_COMPANY_LIMIT ?? 1)
  return Number.isInteger(value) && value > 0 ? value : 1
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
    if (companies.length >= companyLimit())
      throw new FinancialError(
        "Your plan includes one company. Upgrade to add another company.",
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
      vatAnswers: {},
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
  patch: Partial<Pick<Company, "customHeads" | "vatOverrides" | "ctAnswers" | "vatAnswers">>
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
