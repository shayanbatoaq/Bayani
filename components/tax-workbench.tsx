"use client"

/** Shared loading, company picker and empty states for the VAT and corporate tax pages. */
import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Company } from "@/lib/company"
import type { FinancialRecord } from "@/lib/financial-statements"

export function useTaxData() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [records, setRecords] = useState<FinancialRecord[]>([])
  const [companyId, setCompanyId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    Promise.all([
      fetch("/api/companies", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/financial-data", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([companyData, recordData]) => {
        if (companyData.error || recordData.error) throw new Error(companyData.error || recordData.error)
        setCompanies(companyData.companies)
        setRecords(recordData.records)
        if (companyData.companies[0]) setCompanyId(companyData.companies[0].id)
      })
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [])
  const company = companies.find((item) => item.id === companyId)
  const companyRecords = records.filter((record) => record.clientId === companyId)
  return { companies, setCompanies, company, companyId, setCompanyId, companyRecords, loading, error }
}

export function CompanyPicker({ companies, companyId, onChange }: { companies: Company[]; companyId: string; onChange: (id: string) => void }) {
  if (companies.length < 2) return null
  return (
    <select aria-label="Company" className="h-10 rounded-md border bg-white px-3 text-sm" value={companyId} onChange={(e) => onChange(e.target.value)}>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

export function NoData({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return (
    <div className="space-y-3 rounded-xl border bg-white p-10 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button asChild variant="outline">
        <Link href={href}>
          {action} <ArrowRight className="size-4" />
        </Link>
      </Button>
    </div>
  )
}

export function Loading() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm">
      <Loader2 className="size-4 animate-spin" /> Loading...
    </p>
  )
}
