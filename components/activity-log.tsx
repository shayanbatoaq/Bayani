"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Download, History, Loader2, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ACTIVITY_AREAS, AREA_LABELS, type ActivityArea, type ActivityEntry } from "@/lib/activity"
import type { Company } from "@/lib/company"
import type { StoredChange } from "@/lib/supabase/data-store"

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
const NAMESPACE_LABELS: Record<string, string> = {
  companies: "Company",
  "financial-records": "Trial balance",
  "bank-sessions": "Bank statements",
  books: "Invoices, bills and adjustments",
  "bill-documents": "Bill document",
  "company-logos": "Logo",
  "audit-requests": "Audit request",
  "asp-requests": "E-invoicing request",
  plan: "Plan",
}
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

/** Every change saved in Bayani: when, where and what, with the amounts before and after. */
export function ActivityLog() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState("")
  const [area, setArea] = useState<ActivityArea | "">("")
  const [query, setQuery] = useState("")
  const [loaded, setLoaded] = useState<{ key: string; entries: ActivityEntry[]; error?: string } | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [view, setView] = useState<"summary" | "changes">("summary")
  const [record, setRecord] = useState<{ key: string; changes: StoredChange[]; recorded: boolean; error?: string } | null>(null)

  useEffect(() => {
    fetch("/api/companies", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setCompanies(data.companies ?? []))
      .catch(() => {})
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/activity${companyId ? `?companyId=${companyId}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error)
        setLoaded({ key: companyId, entries: data.entries })
      })
      .catch((cause) => cause.name !== "AbortError" && setLoaded({ key: companyId, entries: [], error: cause.message }))
    return () => controller.abort()
  }, [companyId])
  useEffect(() => {
    if (view !== "changes") return
    const controller = new AbortController()
    fetch(`/api/activity?view=changes${companyId ? `&companyId=${companyId}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error)
        setRecord({ key: companyId, changes: data.changes, recorded: data.recorded })
      })
      .catch((cause) => cause.name !== "AbortError" && setRecord({ key: companyId, changes: [], recorded: true, error: cause.message }))
    return () => controller.abort()
  }, [view, companyId])
  const companyOf = (recordId: string) => companies.find((c) => recordId.startsWith(c.id))?.name ?? ""

  const loading = loaded?.key !== companyId
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (loaded?.entries ?? []).filter(
      (e) => (!area || e.area === area) && (!q || `${e.summary} ${e.companyName} ${e.changes.map((c) => `${c.label} ${c.before ?? ""} ${c.after ?? ""}`).join(" ")}`.toLowerCase().includes(q)),
    )
  }, [loaded, area, query])
  const days = useMemo(() => {
    const out: { day: string; entries: ActivityEntry[] }[] = []
    for (const e of entries) {
      const d = day(e.at)
      if (out.at(-1)?.day === d) out.at(-1)!.entries.push(e)
      else out.push({ day: d, entries: [e] })
    }
    return out
  }, [entries])

  function download() {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const rows = [["Date", "Time", "Company", "Area", "Year", "Change", "Item", "Before", "After"]]
    for (const e of entries) {
      const head = [day(e.at), time(e.at), e.companyName, AREA_LABELS[e.area], e.year ?? "", e.summary]
      if (!e.changes.length) rows.push([...head, "", "", ""].map(String))
      for (const c of e.changes) rows.push([...head, c.label, c.before ?? "", c.after ?? ""].map(String))
    }
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `Bayani-activity-log${companyId ? `-${(companies.find((c) => c.id === companyId)?.name ?? "").replace(/[^A-Za-z0-9]+/g, "-")}` : ""}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Company</span>
          <select className="block h-10 rounded-xl border bg-white px-3 text-sm" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Search the log</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input type="search" className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-sm" placeholder="Search: invoice number, ledger head, supplier…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Button variant="outline" onClick={download} disabled={!entries.length}>
          <Download className="size-4" /> Download CSV
        </Button>
      </div>
      <div className="track" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view === "summary"} className="track-item" onClick={() => setView("summary")}>
          What changed
        </button>
        <button role="tab" aria-selected={view === "changes"} className="track-item" onClick={() => setView("changes")}>
          Database record
        </button>
      </div>
      {view === "changes" ? (
        <ChangeRecord record={record?.key === companyId ? record : null} companyOf={companyOf} />
      ) : (
        <>
          <div className="track flex-wrap" role="tablist" aria-label="Area">
            <button role="tab" aria-selected={!area} className="track-item" onClick={() => setArea("")}>
              All
            </button>
            {ACTIVITY_AREAS.map((a) => (
              <button key={a} role="tab" aria-selected={area === a} className="track-item" onClick={() => setArea(a)}>
                {AREA_LABELS[a]}
              </button>
            ))}
          </div>
          <p className="note note-info text-sm">
            Every change saved is described here. The time of each entry is set by the server, entries cannot be edited or deleted, and they stay after a company is removed. The database record lists every change to your data, however it was made.
          </p>
          {loaded?.error && <p className="note note-alert text-sm">{loaded.error}</p>}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading the log…
            </p>
          ) : !entries.length ? (
            <div className="panel flex flex-col items-center gap-2 p-10 text-center">
              <History className="size-7 text-muted-foreground" aria-hidden />
              <p className="font-semibold">{loaded?.entries.length ? "Nothing matches these filters" : "No changes recorded yet"}</p>
              <p className="text-sm text-muted-foreground">Changes made from now on appear here.</p>
            </div>
          ) : (
            days.map((group) => (
              <section key={group.day} className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground">{group.day}</h2>
                <ul className="panel divide-y overflow-hidden">
                  {group.entries.map((e) => {
                    const expanded = open.has(e.id)
                    return (
                      <li key={e.id}>
                        <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50" aria-expanded={e.changes.length ? expanded : undefined} onClick={() => e.changes.length && toggle(e.id)}>
                          <span className="w-16 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">{time(e.at)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{e.summary}</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {AREA_LABELS[e.area]}
                              {e.companyName ? ` · ${e.companyName}` : ""}
                              {e.year ? ` · ${e.year}` : ""}
                              {e.changes.length ? ` · ${e.changes.length} detail${e.changes.length === 1 ? "" : "s"}` : ""}
                            </span>
                          </span>
                          {e.changes.length > 0 && <ChevronDown className={`mt-1 size-4 shrink-0 text-muted-foreground transition ${expanded ? "rotate-180" : ""}`} aria-hidden />}
                        </button>
                        {expanded && (
                          <div className="overflow-x-auto px-4 pb-3 sm:pl-23">
                            <table className="w-full text-xs">
                              <thead className="text-left text-muted-foreground">
                                <tr>
                                  <th className="py-1 pr-3 font-medium">Item</th>
                                  <th className="py-1 pr-3 font-medium">Before</th>
                                  <th className="py-1 font-medium">After</th>
                                </tr>
                              </thead>
                              <tbody>
                                {e.changes.map((c, i) => (
                                  <tr key={i} className="border-t">
                                    <td className="py-1 pr-3">{c.label}</td>
                                    <td className="py-1 pr-3 text-rose-700">{c.before ?? "—"}</td>
                                    <td className="py-1 text-emerald-700">{c.after ?? "removed"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}

/** The database's own record: one row per insert, update or delete, written by a trigger the account cannot skip. */
function ChangeRecord({ record, companyOf }: { record: { changes: StoredChange[]; recorded: boolean; error?: string } | null; companyOf: (recordId: string) => string }) {
  if (!record)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the record…
      </p>
    )
  if (record.error) return <p className="note note-alert text-sm">{record.error}</p>
  if (!record.recorded) return <p className="note note-info text-sm">The database record is kept for signed-in accounts. Sign in to keep one.</p>
  if (!record.changes.length) return <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-2 py-2 font-medium">What</th>
            <th className="px-2 py-2 font-medium">Company</th>
            <th className="px-2 py-2 font-medium">Change</th>
            <th className="px-2 py-2 font-medium">Version</th>
            <th className="px-4 py-2 font-medium">Content check</th>
          </tr>
        </thead>
        <tbody>
          {record.changes.map((c, i) => (
            <tr key={i} className="border-t">
              <td className="whitespace-nowrap px-4 py-1.5 font-mono">
                {day(c.changedAt)} {time(c.changedAt)}
              </td>
              <td className="px-2 py-1.5">{NAMESPACE_LABELS[c.namespace] ?? c.namespace}</td>
              <td className="px-2 py-1.5">{companyOf(c.recordId)}</td>
              <td className="px-2 py-1.5">{c.operation === "insert" ? "Added" : c.operation === "update" ? "Changed" : "Removed"}</td>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono">{c.operation === "update" ? `${c.oldRevision} → ${c.newRevision}` : (c.newRevision ?? c.oldRevision)}</td>
              <td className="px-4 py-1.5 font-mono text-muted-foreground" title="MD5 of the saved content: it matches only that exact version">
                {c.payloadMd5?.slice(0, 12) ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
