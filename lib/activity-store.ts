import "server-only"
import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { ActivityDraft, ActivityEntry } from "./activity"
import { ownerDirectory } from "./financial-store"
import { listStoredData, saveStoredData } from "./supabase/data-store"

const file = (owner: string) => path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "activity.jsonl")

/** Ids sort by time within a company: companyId:time:random. */
const entryId = (companyId: string) => `${companyId || "account"}:${Date.now().toString(36).padStart(10, "0")}:${randomUUID().slice(0, 8)}`

/** Adds an entry to the activity log. Never fails the change it records: a log that cannot be written is reported in the server log. */
export async function logActivity(owner: string, draft: ActivityDraft | null) {
  if (!draft) return
  const entry: ActivityEntry = { ...draft, id: entryId(draft.companyId), at: new Date().toISOString() }
  try {
    const saved = await saveStoredData(owner, "activity", entry.id, entry, 0)
    if (saved) return
    await mkdir(ownerDirectory(owner), { recursive: true, mode: 0o700 })
    await appendFile(file(owner), `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 })
  } catch (error) {
    console.error("Activity log entry could not be saved (apply supabase/migrations/20261023180000_add_activity_log.sql)", error)
  }
}

/** Newest first; for one company when companyId is given. */
export async function listActivity(owner: string, { companyId = "", limit = 1000 } = {}): Promise<ActivityEntry[]> {
  const stored = await listStoredData<ActivityEntry>(owner, "activity", limit, companyId ? `${companyId}:` : undefined).catch((error) => {
    console.error("Activity log could not be read", error)
    return []
  })
  if (stored) return stored.map((row) => row.value).sort((a, b) => b.at.localeCompare(a.at))
  let text = ""
  try {
    text = await readFile(file(owner), "utf8")
  } catch {
    return []
  }
  const out: ActivityEntry[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as ActivityEntry
      if (!companyId || entry.companyId === companyId) out.push(entry)
    } catch {}
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}
