import "server-only"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AuditRequest, AuditRequestInput } from "./audit-request"
import { logActivity } from "./activity-store"
import { ownerDirectory } from "./financial-store"
import { listStoredData, saveStoredData } from "./supabase/data-store"

const file = (owner: string) => path.join(/* turbopackIgnore: true */ ownerDirectory(owner), "audit-requests.json")

export async function listAuditRequests(owner: string): Promise<AuditRequest[]> {
  const saved = await listStoredData<AuditRequest>(owner, "audit-requests", 200)
  if (saved) return saved.map(({ value }) => value)

  try {
    const list = JSON.parse(await readFile(file(owner), "utf8")) as AuditRequest[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export async function saveAuditRequest(owner: string, input: AuditRequestInput, companyName: string) {
  const request: AuditRequest = { ...input, years: [...input.years].sort((a, b) => a - b), id: randomUUID(), companyName, createdAt: new Date().toISOString(), status: "Received" }
  const saved = await saveStoredData(owner, "audit-requests", request.id, request, 0)
  const log = () => logActivity(owner, { area: "audit", companyId: input.companyId, companyName, summary: `Audit request submitted for ${request.years.join(", ")}`, changes: [] })
  if (saved) {
    await log()
    return request
  }

  const list = [request, ...(await listAuditRequests(owner))].slice(0, 200)
  await mkdir(ownerDirectory(owner), { recursive: true, mode: 0o700 })
  const temporary = `${file(owner)}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(list), { encoding: "utf8", mode: 0o600 })
  await rename(temporary, file(owner))
  await log()
  return request
}

/** Optional hand-off to the audit team, e.g. a Slack, Zapier or CRM webhook. */
export async function notifyAuditTeam(request: AuditRequest) {
  const url = process.env.FINSCOPE_AUDIT_WEBHOOK
  if (!url) return false
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Audit quote request: ${request.companyName}, ${request.years.join(", ")}, ${request.purpose === "Others" ? request.otherPurpose : request.purpose}, contact ${request.contact}`,
        request,
      }),
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}
