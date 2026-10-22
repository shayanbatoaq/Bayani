import "server-only"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  open,
  unlink,
} from "node:fs/promises"
import path from "node:path"
import { cookies } from "next/headers"
import { getSupabaseServerClient } from "./supabase/server"
import {
  calculateFinancials,
  type FinancialInput,
  type FinancialRecord,
} from "./financial-statements"
import { financialInputSchema } from "./financial-validation"
import { resolveRecords } from "./movement"
import {
  listStoredData,
  readStoredData,
  saveStoredData,
  SupabaseDataError,
} from "./supabase/data-store"

export class FinancialError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

export async function financialOwner() {
  const supabase = await getSupabaseServerClient()
  if (supabase) {
    const { data } = await supabase.auth.getUser()
    if (data.user) return `user:${data.user.id}`
    // One-click login: without a signed-in user, fall back to the browser workspace
    // unless sign-in has been made mandatory.
    if (process.env.FINSCOPE_REQUIRE_LOGIN === "true")
      throw new FinancialError("Please sign in to access financial data.", 401)
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.FINSCOPE_LOCAL_WORKSPACE !== "true"
  )
    throw new FinancialError(
      "Financial storage requires authentication or an explicitly enabled local workspace.",
      503
    )
  const jar = await cookies()
  const existing = jar.get("finscope-workspace")?.value
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return `local:${existing}`
  const token = randomBytes(32).toString("hex")
  jar.set("finscope-workspace", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
  return `local:${token}`
}

export function ownerDirectory(owner: string) {
  const root =
    process.env.FINSCOPE_DATA_DIR ||
    path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "financial-records")
  // Runtime client data must never be bundled into a deployment.
  return path.join(
    /* turbopackIgnore: true */ root,
    createHash("sha256").update(owner).digest("hex")
  )
}

export async function listFinancialRecords(
  owner: string
): Promise<FinancialRecord[]> {
  const saved = await listStoredData<FinancialRecord>(owner, "financial-records")
  if (saved) {
    const records = saved.map(({ value, revision, updatedAt }) => {
      const validated = financialInputSchema.parse(value)
      return { ...value, ...validated, revision, updatedAt } as FinancialRecord
    })
    return resolveRecords(records).sort(
      (a, b) => b.year - a.year || a.clientName.localeCompare(b.clientName)
    )
  }

  const directory = ownerDirectory(owner)
  let files: string[]
  try {
    files = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const records = await Promise.all(
    files
      .filter((file) => /^[a-f0-9-]+\.json$/.test(file))
      .map(async (file) => {
        const parsed = JSON.parse(
          await readFile(path.join(directory, file), "utf8")
        ) as FinancialRecord
        const { revision, ...validated } = financialInputSchema.parse(parsed)
        return { ...parsed, ...validated, revision: parsed.revision ?? revision }
      })
  )
  return resolveRecords(records).sort(
    (a, b) => b.year - a.year || a.clientName.localeCompare(b.clientName)
  )
}

export async function saveFinancialRecord(
  owner: string,
  input: FinancialInput,
  expectedRevision: number
) {
  const id = `${input.clientId}-${input.year}`
  const stored = await readStoredData<FinancialRecord>(owner, "financial-records", id)
  if (stored !== undefined) {
    if ((stored?.revision ?? 0) !== expectedRevision)
      throw new FinancialError(
        "This client year has a newer saved version. Reopen it before saving your changes.",
        409
      )
    const record: FinancialRecord = {
      ...input,
      id,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
      statements: calculateFinancials(input),
    }
    try {
      await saveStoredData(owner, "financial-records", id, record, expectedRevision)
    } catch (error) {
      if (error instanceof SupabaseDataError && error.code === "40001")
        throw new FinancialError(
          "This client year has a newer saved version. Reopen it before saving your changes.",
          409
        )
      throw error
    }
    return (await listFinancialRecords(owner)).find((item) => item.id === id) ?? record
  }

  const directory = ownerDirectory(owner)
  await mkdir(directory, { recursive: true })
  const filename = path.join(directory, `${id}.json`)
  const lockPath = path.join(directory, `${id}.lock`)
  let lock
  try {
    lock = await open(lockPath, "wx")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new FinancialError(
        "This record is being saved. Try again in a moment.",
        409
      )
    throw error
  }
  try {
    let existing: FinancialRecord | null = null
    try {
      existing = JSON.parse(await readFile(filename, "utf8"))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    if ((existing?.revision ?? 0) !== expectedRevision)
      throw new FinancialError(
        "This client year has a newer saved version. Reopen it before saving your changes.",
        409
      )
    const record: FinancialRecord = {
      ...input,
      id,
      revision: (existing?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      statements: calculateFinancials(input),
    }
    const temporary = path.join(directory, `${id}-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(record), {
      encoding: "utf8",
      mode: 0o600,
    })
    await rename(temporary, filename)
    // Statements depend on the year before (movement entry), so return the resolved record.
    return (
      (await listFinancialRecords(owner)).find((item) => item.id === id) ?? record
    )
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}

export function financialErrorResponse(error: unknown) {
  if (error instanceof FinancialError)
    return Response.json({ error: error.message }, { status: error.status })
  if (error instanceof SupabaseDataError)
    return Response.json(
      { error: error.message },
      { status: error.code === "401" ? 401 : 500 }
    )
  console.error("Financial data operation failed", error)
  return Response.json(
    { error: "Financial data could not be read or saved. Please try again." },
    { status: 500 }
  )
}
