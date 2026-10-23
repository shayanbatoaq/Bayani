"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts"
import { BadgeCheck, Building2, Calculator, ChevronDown, FileDown, Gauge, Info, Layers, Loader2, RotateCcw, ShieldAlert, Sparkles, TrendingUp } from "lucide-react"

import { CompanyPicker, Loading, NoData, useTaxData } from "@/components/tax-workbench"
import { Button } from "@/components/ui/button"
import { GENERAL, INDUSTRIES, valueBusiness, type Method, type Valuation } from "@/lib/valuation"
import { cn } from "@/lib/utils"

const aed = (n: number) => (Math.round(n) || 0).toLocaleString("en-US")
const compact = (n: number) => {
  const a = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `${sign}${(a / 1_000).toFixed(0)}K`
  return `${sign}${Math.round(a)}`
}
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`
const APPROACH_COLOR: Record<Method["approach"], string> = { Income: "#2f5bff", Market: "#12b5a6", Asset: "#e89a00" }

export function ValuationWorkbench() {
  const data = useTaxData()
  const { company, companyRecords } = data
  const [year, setYear] = useState<number | null>(null)
  const [industry, setIndustry] = useState<string>("")
  const [discount, setDiscount] = useState<number | null>(null)
  const [growthRate, setGrowthRate] = useState<number | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState("")

  const years = useMemo(() => [...new Set(companyRecords.map((r) => r.year))].sort((a, b) => b - a), [companyRecords])
  const selected = year && years.includes(year) ? year : (years[0] ?? null)
  const v = useMemo(
    () =>
      company && selected
        ? valueBusiness(company, companyRecords, { year: selected, industry: industry || undefined, discountRate: discount ?? undefined, terminalGrowth: growthRate ?? undefined })
        : null,
    [company, companyRecords, selected, industry, discount, growthRate]
  )

  async function download() {
    if (!company || !v) return
    setDownloading(true)
    setError("")
    try {
      const query = new URLSearchParams({ companyId: company.id, year: String(v.year) })
      if (industry) query.set("industry", industry)
      if (discount !== null) query.set("discountRate", String(discount))
      if (growthRate !== null) query.set("terminalGrowth", String(growthRate))
      const response = await fetch(`/api/valuation/pdf?${query}`)
      if (!response.ok) throw new Error((await response.json()).error || "Download failed.")
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = `${company.name.replace(/[^A-Za-z0-9]+/g, "-")}-Valuation-Brief-${v.year}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.")
    } finally {
      setDownloading(false)
    }
  }

  if (data.loading) return <Loading />
  if (!company) return <NoData title="No company yet" text="Add your company on the Dashboard first." href="/dashboard" action="Go to Dashboard" />
  if (!companyRecords.length || !v)
    return <NoData title="No financial data" text="Save at least one year in Data Input to value the business." href="/data-input" action="Go to Data Input" />

  const adjusted = Boolean(industry || discount !== null || growthRate !== null)
  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Company</p>
            <p className="mt-1 text-lg font-semibold">{company.name}</p>
            <p className="max-w-xs truncate text-xs text-muted-foreground">{company.businessActivity || "Business activity not recorded"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valuation as at year end</p>
            <div role="tablist" aria-label="Year" className="track mt-1">
              {years.map((option) => (
                <button key={option} type="button" role="tab" aria-selected={option === selected} className="track-item" onClick={() => setYear(option)}>
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CompanyPicker companies={data.companies} companyId={data.companyId} onChange={data.setCompanyId} />
          <Button onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
            Valuation brief PDF
          </Button>
        </div>
      </div>
      {error && <p className="note note-alert text-sm">{error}</p>}

      <Hero v={v} currency={company.baseCurrency ?? "AED"} />

      <div className="grid gap-5 xl:grid-cols-5">
        <section className="panel p-5 xl:col-span-3">
          <Title icon={Layers} title="Methods compared" hint="Each bar is the low to high range; the dot is the point value" />
          <FootballField v={v} />
        </section>
        <section className="panel space-y-4 p-5 xl:col-span-2">
          <Title icon={Calculator} title="Assumptions" hint="Change them to see the value move" />
          <label className="block text-sm">
            <span className="text-xs text-muted-foreground">Industry benchmark</span>
            <select className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm" value={industry || v.industry.key} onChange={(e) => setIndustry(e.target.value)}>
              {[...INDUSTRIES, GENERAL].map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label} · EBITDA {item.ebitda[0]}–{item.ebitda[2]}x
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted-foreground">{v.industryReason}</span>
          </label>
          <Slider label="Discount rate" value={v.discountRate} min={0.1} max={0.35} step={0.005} onChange={setDiscount} />
          <Slider label="Long-term growth" value={v.terminalGrowth} min={0} max={0.05} step={0.0025} onChange={setGrowthRate} />
          {adjusted && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIndustry("")
                setDiscount(null)
                setGrowthRate(null)
              }}
            >
              <RotateCcw className="size-4" /> Reset to the tool&apos;s assumptions
            </Button>
          )}
          <div className="rounded-2xl border bg-secondary/40 p-3">
            <p className="mb-2 text-xs font-semibold">Discount rate build-up</p>
            {v.discountBuild.map((d) => (
              <div key={d.label} className="flex justify-between gap-3 py-0.5 text-xs">
                <span className="text-muted-foreground">{d.label}</span>
                <span className="tabular-nums">{pct(d.value)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t pt-1 text-xs font-semibold">
              <span>{discount !== null ? "Used (set by you)" : "Used"}</span>
              <span className="tabular-nums">{pct(v.discountRate)}</span>
            </div>
          </div>
        </section>
      </div>

      <section className="panel p-5 sm:p-6">
        <Title icon={Sparkles} title="Valuation brief" hint="How the tool reached this value" />
        <div className="space-y-2 text-sm leading-relaxed">
          {v.summary.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Each method, step by step</h2>
        {v.methods.map((m) => (
          <MethodCard key={m.key} m={m} open={open === m.key} onToggle={() => setOpen(open === m.key ? null : m.key)} />
        ))}
      </section>

      {v.projection.length > 0 && (
        <section className="panel p-5">
          <Title icon={TrendingUp} title="Five-year cash flow projection" hint={`Discounted at ${pct(v.discountRate)}; terminal growth ${pct(v.terminalGrowth)}`} />
          <Projection v={v} />
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <Title icon={BadgeCheck} title="What drives the value" />
          <ul className="space-y-2">
            {v.drivers.map((t, i) => (
              <li key={i} className="note note-good text-sm">
                {t}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel p-5">
          <Title icon={ShieldAlert} title="Limitations" />
          <ul className="space-y-2">
            {v.limitations.map((t, i) => (
              <li key={i} className="note note-warning text-sm">
                {t}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Indicative value from the saved financial statements and sector benchmark ranges. It is not a formal valuation opinion; a transaction, dispute or regulatory filing needs a valuation by a qualified valuer.
      </p>
    </div>
  )
}

function Title({ icon: Icon, title, hint }: { icon: typeof Gauge; title: string; hint?: string }) {
  return (
    <header className="mb-4 flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--cobalt-wash)] text-[var(--cobalt)]">
        <Icon className="size-4" />
      </span>
      <div>
        <h3 className="font-display font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </header>
  )
}

function Hero({ v, currency }: { v: Valuation; currency: string }) {
  const lead = [...v.methods].sort((a, b) => b.weight - a.weight)[0]
  const span = Math.max(1, v.high - v.low)
  return (
    <section className="insight-panel overflow-hidden p-5 text-white sm:p-7">
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:items-center">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/55">Indicative equity value · {v.year}</p>
          <p className="mt-2 font-display text-4xl font-semibold tabular-nums sm:text-5xl">
            <span className="mr-2 text-lg font-normal text-white/60">{currency}</span>
            {aed(v.value)}
          </p>
          <div className="mt-4 max-w-md">
            <div className="relative h-2.5 rounded-full bg-gradient-to-r from-[#12b5a6] via-[#2f5bff] to-[#7c5cff]">
              <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--ink)]" style={{ left: `${((v.value - v.low) / span) * 100}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-white/60 tabular-nums">
              <span>{compact(v.low)}</span>
              <span>{compact(v.high)}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Confidence" value={v.confidence} tone={v.confidence === "High" ? "#5fe0d4" : v.confidence === "Medium" ? "#ffc861" : "#ff9a9d"} />
          <Stat label="Industry" value={v.industry.label} />
          <Stat label="Lead method" value={lead ? `${lead.name} (${pct(lead.weight, 0)})` : "n/a"} />
          <Stat label="Implied EV / EBITDA" value={v.maintainableEbitda > 0 ? `${((v.value - v.netCash) / v.maintainableEbitda).toFixed(1)}x` : "n/a"} />
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
      <p className="text-[11px] text-white/55">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-snug" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
  )
}

function FootballField({ v }: { v: Valuation }) {
  // Scale to the weighted methods so a reference-only figure far away does not squash the chart.
  const core = v.methods.filter((m) => m.weight > 0 || m.key === "nav")
  const lo = Math.max(0, Math.min(...core.map((m) => m.low), v.low) * 0.85)
  const hi = Math.max(...core.map((m) => m.high), v.high) * 1.12
  const at = (n: number) => Math.max(0, Math.min(100, ((n - lo) / Math.max(1, hi - lo)) * 100))
  const pos = (n: number) => `${at(n)}%`
  return (
    <div className="space-y-4">
      {v.methods.map((m) => {
        const beyond = m.value > hi
        return (
          <div key={m.key} className={cn(!m.weight && "opacity-60")}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {m.name}
                <span className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: APPROACH_COLOR[m.approach] }}>
                  {m.approach}
                </span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {compact(m.value)} · {m.weight ? `weight ${pct(m.weight, 0)}` : "reference only"}
              </span>
            </div>
            <div className="relative h-4 rounded-full bg-secondary">
              <div className="absolute top-0 h-full rounded-full" style={{ left: pos(m.low), width: `${Math.max(1.5, at(m.high) - at(m.low))}%`, background: `${APPROACH_COLOR[m.approach]}55` }} />
              {beyond ? (
                <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-semibold" style={{ color: APPROACH_COLOR[m.approach] }}>
                  off scale →
                </span>
              ) : (
                <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: pos(m.value), background: APPROACH_COLOR[m.approach] }} />
              )}
            </div>
          </div>
        )
      })}
      <div className="pt-1">
        <p className="mb-1 text-sm font-semibold">Weighted conclusion</p>
        <div className="relative h-8 rounded-xl bg-[var(--ink)]">
          <div className="absolute inset-y-1 rounded-lg bg-white/15" style={{ left: pos(v.low), width: `${at(v.high) - at(v.low)}%` }} />
          <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--ink)] tabular-nums" style={{ left: pos(v.value) }}>
            {compact(v.value)}
          </span>
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{compact(lo)}</span>
          <span>{compact(hi)}</span>
        </div>
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between text-xs text-muted-foreground">
        {label}
        <span className="font-semibold text-foreground tabular-nums">{pct(value)}</span>
      </span>
      <input type="range" className="mt-2 w-full accent-[var(--cobalt)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function MethodCard({ m, open, onToggle }: { m: Method; open: boolean; onToggle: () => void }) {
  return (
    <div className={cn("panel overflow-hidden", !m.weight && "opacity-80")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-4 p-4 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: APPROACH_COLOR[m.approach] }}>
          {m.approach === "Asset" ? <Building2 className="size-5" /> : m.approach === "Market" ? <Gauge className="size-5" /> : <TrendingUp className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold">{m.name}</p>
          <p className="text-xs text-muted-foreground">
            {m.approach} approach · range {compact(m.low)} – {compact(m.high)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display font-semibold tabular-nums">{aed(m.value)}</p>
          <p className="text-xs text-muted-foreground">{m.weight ? `${pct(m.weight, 0)} weight` : "Reference"}</p>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="space-y-2 border-t bg-secondary/30 p-4 text-sm">
          {m.explanation.map((t, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--cobalt-wash)] text-[11px] font-semibold text-[var(--cobalt)]">{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Projection({ v }: { v: Valuation }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(() => setWidth(Math.floor(node.getBoundingClientRect().width)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const data = v.projection.map((p) => ({ year: String(p.year), Revenue: Math.round(p.revenue), EBITDA: Math.round(p.ebitda), "Free cash flow": Math.round(p.fcf), "Present value": Math.round(p.discounted) }))
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div ref={ref} className="h-64 w-full">
        {width > 0 && (
          <ComposedChart width={width} height={256} data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3e8f2" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} width={48} />
            <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(value) => Number(value).toLocaleString("en-US")} />
            <Bar dataKey="EBITDA" fill="#2f5bff" radius={[6, 6, 0, 0]} maxBarSize={34} />
            <Bar dataKey="Free cash flow" fill="#12b5a6" radius={[6, 6, 0, 0]} maxBarSize={34} />
            <Line dataKey="Present value" stroke="#e89a00" strokeWidth={3} dot={{ r: 4, fill: "#e89a00" }} type="monotone" />
          </ComposedChart>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="pb-2 text-left font-medium">Year</th>
              <th className="pb-2 text-right font-medium">Revenue</th>
              <th className="pb-2 text-right font-medium">EBITDA</th>
              <th className="pb-2 text-right font-medium">Free cash</th>
              <th className="pb-2 text-right font-medium">Present value</th>
            </tr>
          </thead>
          <tbody>
            {v.projection.map((p) => (
              <tr key={p.year} className="border-t">
                <td className="py-2">{p.year}</td>
                <td className="py-2 text-right tabular-nums">{compact(p.revenue)}</td>
                <td className="py-2 text-right tabular-nums">{compact(p.ebitda)}</td>
                <td className="py-2 text-right tabular-nums">{compact(p.fcf)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">{compact(p.discounted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
