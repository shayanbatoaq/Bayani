import "server-only"
import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { applyBooksAction, booksSchema, emptyBooks, type Books, type BooksAction } from "./books"
import { FinancialError, ownerDirectory } from "./financial-store"

const folder = (owner: string) => path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "books")
const file = (owner: string, companyId: string) => path.join(/* turbopackIgnore: true */ folder(owner), `${companyId}.json`)
const attachments = (owner: string, companyId: string) => path.join(/* turbopackIgnore: true */ folder(owner), "attachments", companyId)

export async function readBooks(owner: string, companyId: string): Promise<Books> {
  try {
    return booksSchema.parse(JSON.parse(await readFile(file(owner, companyId), "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyBooks()
    throw error
  }
}

/** Every company's books, for building the trial balances. */
export async function readAllBooks(owner: string): Promise<Map<string, Books>> {
  const out = new Map<string, Books>()
  let files: string[] = []
  try {
    files = await readdir(folder(owner))
  } catch {
    return out
  }
  for (const name of files.filter((f) => /^[a-f0-9-]{36}\.json$/.test(f))) {
    const id = name.slice(0, -5)
    try {
      out.set(id, await readBooks(owner, id))
    } catch (error) {
      console.error("Books could not be read", error)
    }
  }
  return out
}

export async function updateBooks(owner: string, companyId: string, expectedRevision: number, action: BooksAction) {
  await mkdir(folder(owner), { recursive: true, mode: 0o700 })
  const lockPath = `${file(owner, companyId)}.lock`
  let lock
  try {
    lock = await open(lockPath, "wx")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new FinancialError("Another change is being saved. Try again in a moment.", 409)
    throw error
  }
  try {
    const current = await readBooks(owner, companyId)
    if (current.revision !== expectedRevision) throw new FinancialError("These books were changed in another window. Reload to see the latest.", 409)
    let next: Books
    try {
      next = applyBooksAction(current, action)
    } catch (cause) {
      throw new FinancialError(cause instanceof Error ? cause.message : "This change could not be made.")
    }
    if (action.action === "deleteBill") {
      const bill = current.bills.find((b) => b.id === action.id)
      if (bill?.attachment) await removeAttachment(owner, companyId, bill.attachment.id)
    }
    const temporary = `${file(owner, companyId)}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 })
    await rename(temporary, file(owner, companyId))
    return next
  } finally {
    await lock.close()
    await unlink(lockPath).catch(() => {})
  }
}

export async function deleteBooks(owner: string, companyId: string) {
  await rm(file(owner, companyId), { force: true })
  await rm(attachments(owner, companyId), { recursive: true, force: true })
}

const safeId = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new FinancialError("Attachment not found.", 404)
  return id
}
export async function saveAttachment(owner: string, companyId: string, bytes: Buffer, type: string) {
  const id = randomUUID()
  await mkdir(attachments(owner, companyId), { recursive: true, mode: 0o700 })
  await writeFile(path.join(attachments(owner, companyId), id), bytes, { mode: 0o600 })
  await writeFile(path.join(attachments(owner, companyId), `${id}.type`), type, { mode: 0o600 })
  return id
}
export async function readAttachment(owner: string, companyId: string, id: string) {
  const dir = attachments(owner, companyId)
  const bytes = await readFile(path.join(dir, safeId(id)))
  const type = await readFile(path.join(dir, `${id}.type`), "utf8").catch(() => "application/octet-stream")
  return { bytes, type }
}
export async function removeAttachment(owner: string, companyId: string, id: string) {
  const dir = attachments(owner, companyId)
  await rm(path.join(dir, safeId(id)), { force: true })
  await rm(path.join(dir, `${id}.type`), { force: true })
}
