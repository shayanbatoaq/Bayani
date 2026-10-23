import "server-only"

import { getSupabaseServerClient } from "./server"

export type DataNamespace =
  | "companies"
  | "financial-records"
  | "bank-sessions"
  | "audit-requests"
  | "plan"
  | "company-logos"
  | "books"
  | "bill-documents"
  | "asp-requests"
  | "activity"

type DataRow = {
  record_id: string
  payload: Record<string, unknown>
  revision: number
  updated_at: string
}

export class SupabaseDataError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
  }
}

async function context(owner: string) {
  const match = /^user:([0-9a-f-]{36})$/i.exec(owner)
  if (!match) return null

  const client = await getSupabaseServerClient()
  if (!client) throw new SupabaseDataError("Supabase is not configured.")

  const { data, error } = await client.auth.getUser()
  if (error || !data.user || data.user.id !== match[1])
    throw new SupabaseDataError("Please sign in to access saved data.", "401")

  return { client, userId: data.user.id }
}

export async function listStoredData<T extends object>(
  owner: string,
  namespace: DataNamespace,
  limit?: number,
  prefix?: string
): Promise<Array<{ id: string; value: T; revision: number; updatedAt: string }> | null> {
  const scope = await context(owner)
  if (!scope) return null

  let query = scope.client
    .from("finscope_user_data")
    .select("record_id,payload,revision,updated_at")
    .eq("user_id", scope.userId)
    .eq("namespace", namespace)
    .order("updated_at", { ascending: false })
  if (prefix) query = query.like("record_id", `${prefix}%`)
  if (limit) query = query.limit(limit)

  const { data, error } = await query
  if (error) throw new SupabaseDataError(error.message, error.code)
  return (data as DataRow[]).map((row) => ({
    id: row.record_id,
    value: row.payload as T,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
  }))
}

export async function readStoredData<T extends object>(
  owner: string,
  namespace: DataNamespace,
  id: string
): Promise<{ value: T; revision: number; updatedAt: string } | null | undefined> {
  const scope = await context(owner)
  if (!scope) return undefined

  const { data, error } = await scope.client
    .from("finscope_user_data")
    .select("payload,revision,updated_at")
    .eq("user_id", scope.userId)
    .eq("namespace", namespace)
    .eq("record_id", id)
    .maybeSingle()
  if (error) throw new SupabaseDataError(error.message, error.code)
  if (!data) return null
  return {
    value: data.payload as T,
    revision: Number(data.revision),
    updatedAt: data.updated_at,
  }
}

export async function saveStoredData<T extends object>(
  owner: string,
  namespace: DataNamespace,
  id: string,
  value: T,
  expectedRevision: number
): Promise<{ value: T; revision: number; updatedAt: string } | null> {
  const scope = await context(owner)
  if (!scope) return null

  const { data, error } = await scope.client.rpc("save_finscope_user_data", {
    p_namespace: namespace,
    p_record_id: id,
    p_payload: value,
    p_expected_revision: expectedRevision,
  })
  if (error) throw new SupabaseDataError(error.message, error.code)
  const row = (data as DataRow[] | null)?.[0]
  if (!row) throw new SupabaseDataError("Saved data was not returned.")
  return {
    value: row.payload as T,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
  }
}

export async function deleteStoredData(
  owner: string,
  namespace: DataNamespace,
  id: string
): Promise<boolean | null> {
  const scope = await context(owner)
  if (!scope) return null

  const { error } = await scope.client
    .from("finscope_user_data")
    .delete()
    .eq("user_id", scope.userId)
    .eq("namespace", namespace)
    .eq("record_id", id)
  if (error) throw new SupabaseDataError(error.message, error.code)
  return true
}

export async function deleteStoredDataByPrefix(
  owner: string,
  namespace: DataNamespace,
  prefix: string
): Promise<boolean | null> {
  const scope = await context(owner)
  if (!scope) return null

  const { error } = await scope.client
    .from("finscope_user_data")
    .delete()
    .eq("user_id", scope.userId)
    .eq("namespace", namespace)
    .like("record_id", `${prefix}%`)
  if (error) throw new SupabaseDataError(error.message, error.code)
  return true
}
