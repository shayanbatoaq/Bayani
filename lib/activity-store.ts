import "server-only"
import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import type { ActivityDraft, ActivityEntry } from "./activity"
import { ownerDirectory } from "./financial-store"
import { listStoredChanges, listStoredData, logStoredActivity, saveStoredData, SupabaseDataError, type StoredChange } from "./supabase/data-store"

const file = (owner: string) => path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "activity.jsonl")

/** Ids sort by time within a company: companyId:time:random. */
const entryId = (companyId: string) => `${companyId || "account"}:${Date.now().toString(36).padStart(10, "0")}:${randomUUID().slice(0, 8)}`

/** Adds an entry to the activity log. Never fails the change it records: a log that cannot be written is reported in the server log. */
export async function logActivity(owner: string, draft: ActivityDraft | null) {
  if (!draft) return
  const entry: ActivityEntry = { ...draft, id: entryId(draft.companyId), at: new Date().toISOString() }
  try {
    // Signed in: the database stamps the time and refuses any later change to the entry.
    const stamped = await logStoredActivity(owner, entry.id, draft).catch((error) =>
      // Before the migration that adds log_finscope_activity: the earlier direct write.
      error instanceof SupabaseDataError && error.code === "PGRST202" ? saveStoredData(owner, "activity", entry.id, entry, 0) : Promise.reject(error)
    )
    if (stamped) return
    await mkdir(ownerDirectory(owner), { recursive: true, mode: 0o700 })
    await appendFile(file(owner), `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 })
  } catch (error) {
    console.error("Activity log entry could not be saved (apply supabase/migrations/20261024090000_lock_billing_audit_trail_ai_quota.sql)", error)
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

/** The database's record of every change to the owner's data (signed-in accounts only; empty for a local workspace). */
export async function listChanges(owner: string, { companyId = "", limit = 1000 } = {}): Promise<StoredChange[]> {
  return (await listStoredChanges(owner, limit, companyId || undefined)) ?? []
}
