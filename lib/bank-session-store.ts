import "server-only"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { bankSessionSchema, type BankSession } from "./bank-session"
import { ownerDirectory } from "./financial-store"
import { deleteStoredData, readStoredData, saveStoredData } from "./supabase/data-store"

const file = (owner: string, companyId: string, year: number) =>
  path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "bank-statements", `${companyId}-${year}.json`)

export async function readBankSession(owner: string, companyId: string, year: number): Promise<BankSession | null> {
  const saved = await readStoredData<BankSession>(owner, "bank-sessions", `${companyId}-${year}`)
  if (saved !== undefined) {
    const parsed = saved ? bankSessionSchema.safeParse(saved.value) : null
    return parsed?.success ? parsed.data : null
  }

  try {
    const parsed = bankSessionSchema.safeParse(JSON.parse(await readFile(file(owner, companyId, year), "utf8")))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function writeBankSession(owner: string, companyId: string, year: number, session: BankSession) {
  const id = `${companyId}-${year}`
  const saved = await readStoredData<BankSession>(owner, "bank-sessions", id)
  if (saved !== undefined) {
    await saveStoredData(owner, "bank-sessions", id, session, saved?.revision ?? 0)
    return
  }

  const target = file(owner, companyId, year)
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(session), { encoding: "utf8", mode: 0o600 })
  await rename(temporary, target)
}

export async function clearBankSession(owner: string, companyId: string, year: number) {
  const removed = await deleteStoredData(owner, "bank-sessions", `${companyId}-${year}`)
  if (removed) return
  await rm(file(owner, companyId, year), { force: true })
}
