"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts"
import { Activity, ArrowDownRight, ArrowUpRight, Banknote, Gauge, Landmark, PiggyBank, Scale, Sparkles, TrendingUp, Wallet } from "lucide-react"

import { allMetrics, cagr, growth, healthScore, type YearMetrics } from "@/lib/analytics"
import type { FinancialRecord } from "@/lib/financial-statements"
import type { ReportModel } from "@/lib/report-model"
import { brand, chartTooltipStyle } from "@/lib/brand"
import { cn } from "@/lib/utils"

const C = { primary: brand.evergreen, secondary: brand.mint, tertiary: brand.info, gold: brand.gold, good: brand.evergreen, warn: brand.warning, bad: brand.danger, neutral: brand.sage, ink: brand.textSecondary }
/** Label colour for text set on a chart fill: dark on the light fills, white on the rest. */
const onFill = (fill: string) => ([brand.mint, brand.sage, brand.gold] as string[]).includes(fill) ? brand.text : "#ffffff"

const MIX = [C.primary, C.secondary, C.tertiary, C.gold, C.neutral, C.ink]

const compact = (n: number) => {
  const a = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}M`
  if (a >= 1_000) return `${sign}${(a / 1_000).toFixed(a >= 100_000 ? 0 : 1)}K`
  return `${sign}${Math.round(a)}`
}
const pct = (n: number | null, digits = 1) => (n === null ? "n/a" : `${(n * 100).toFixed(digits)}%`)
const times = (n: number | null) => (n === null ? "n/a" : `${n.toFixed(2)}x`)
const days = (n: number | null) => (n === null ? "n/a" : `${Math.round(n)} days`)

function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(() => setWidth(Math.floor(node.getBoundingClientRect().width)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** Visual summary of the year: KPIs, trends, mix, ratios and plain-language insights. */
export function SnapView({ model, records }: { model: ReportModel; records: FinancialRecord[] }) {
  const series = useMemo(() => allMetrics(records.filter((r) => r.year <= model.year)), [records, model.year])
  const m = series.find((x) => x.year === model.year) ?? series.at(-1)
  if (!m) return <div className="panel p-6 text-sm text-muted-foreground">Save figures for {model.year} in Data Input to see the snap view.</div>
  const prior = series.find((x) => x.year === m.year - 1) ?? null
  const health = healthScore(m, prior)
  const cashFlow = {
    a: model.cashFlow.find((row) => /\(A\)/.test(row.label))?.current ?? 0,
    b: model.cashFlow.find((row) => /\(B\)/.test(row.label))?.current ?? 0,
    c: model.cashFlow.find((row) => /\(C\)/.test(row.label))?.current ?? 0,
  }
  return (
    <div className="space-y-5">
      <Hero model={model} m={m} prior={prior} health={health} series={series} />
      <Kpis m={m} prior={prior} currency={model.currency} />
      <div className="grid gap-5 xl:grid-cols-5">
        <section className="panel p-5 xl:col-span-3">
          <Title icon={TrendingUp} title="Performance trend" hint={series.length > 1 ? `${series[0].year} – ${m.year}` : "Add earlier years for a trend"} />
          <TrendChart series={series} />
        </section>
        <section className="panel p-5 xl:col-span-2">
          <Title icon={Gauge} title="Margins" hint="Share of revenue kept at each level" />
          <Margins m={m} prior={prior} />
        </section>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="panel p-5">
          <Title icon={Wallet} title="Where the money goes" hint="Administrative and general expenses" />
          <ExpenseMix m={m} currency={model.currency} />
        </section>
        <section className="panel p-5">
          <Title icon={Scale} title="Balance sheet shape" hint="What the business owns and how it is funded" />
          <BalanceShape m={m} />
        </section>
      </div>
      <div className="grid gap-5 xl:grid-cols-5">
        <section className="panel p-5 xl:col-span-2">
          <Title icon={Banknote} title="Cash flow story" hint={`Cash movement in ${m.year}`} />
          <CashStory flow={cashFlow} closing={m.cash} />
        </section>
        <section className="panel p-5 xl:col-span-3">
          <Title icon={Activity} title="Key ratios" hint={prior ? `${m.year} against ${prior.year}` : `${m.year}`} />
          <Ratios m={m} prior={prior} />
        </section>
      </div>
      <Insights m={m} prior={prior} series={series} cashFlow={cashFlow} currency={model.currency} />
    </div>
  )
}

function Title({ icon: Icon, title, hint }: { icon: typeof Activity; title: string; hint?: string }) {
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

function Delta({ now, before, invert = false }: { now: number; before: number | undefined | null; invert?: boolean }) {
  const g = growth(now, before)
  if (g === null) return <span className={cn("text-[11px]", "text-muted-foreground")}>no prior year</span>
  const good = invert ? g < 0 : g > 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        good ? "bg-[var(--evergreen-subtle)] text-[var(--evergreen)]" : "bg-[var(--danger-subtle)] text-[var(--danger-text)]"
      )}
    >
      {g >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(g * 100) >= 1000 ? ">999" : Math.abs(g * 100).toFixed(1)}%
    </span>
  )
}

function Ring({ score }: { score: number }) {
  const r = 46
  const length = 2 * Math.PI * r
  const color = score >= 70 ? C.good : score >= 45 ? C.warn : C.bad
  return (
    <svg viewBox="0 0 120 120" className="size-32 shrink-0" role="img" aria-label={`Health score ${score} out of 100`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke={brand.track} strokeWidth="8" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(score / 100) * length} ${length}`} transform="rotate(-90 60 60)" />
      <text x="60" y="58" textAnchor="middle" fill={brand.text} fontSize="30" fontWeight="600" letterSpacing="-0.02em" fontFamily="var(--font-sans)">
        {score}
      </text>
      <text x="60" y="78" textAnchor="middle" fill={brand.textTertiary} fontSize="10" fontFamily="var(--font-sans)">
        out of 100
      </text>
    </svg>
  )
}

function Hero({ model, m, prior, health, series }: { model: ReportModel; m: YearMetrics; prior: YearMetrics | null; health: ReturnType<typeof healthScore>; series: YearMetrics[] }) {
  const verdict = health.score >= 70 ? "In good shape" : health.score >= 45 ? "Steady, with areas to watch" : "Needs attention"
  const revenueCagr = cagr(series.map((x) => x.revenue))
  return (
    <section className="insight-panel overflow-hidden p-5 sm:p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <Ring score={health.score} />
          <div>
            <p className="text-[13px] font-medium text-subtle-foreground">Business health · {m.year}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{verdict}</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {model.companyName} earned {model.currency} {compact(m.revenue)} in revenue and {m.netProfit >= 0 ? "kept" : "lost"} {model.currency} {compact(Math.abs(m.netProfit))}
              {prior ? `, against ${compact(prior.revenue)} and ${compact(prior.netProfit)} in ${prior.year}` : ""}.
              {revenueCagr !== null && series.length > 2 ? ` Revenue has compounded at ${pct(revenueCagr)} a year.` : ""}
            </p>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          {health.items.map((item) => (
            <div key={item.label} className="rounded-lg border bg-[var(--surface-subtle)] p-3">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <div className="mt-2 h-1 rounded-full bg-[var(--surface-hover)]">
                <div className="h-full rounded-full" style={{ width: `${item.score}%`, background: item.score >= 70 ? C.good : item.score >= 45 ? C.warn : C.bad }} />
              </div>
              <p className="mt-2 text-xs leading-snug text-muted-foreground">{item.note}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Kpis({ m, prior, currency }: { m: YearMetrics; prior: YearMetrics | null; currency: string }) {
  const tiles = [
    { label: "Revenue", value: m.revenue, before: prior?.revenue, icon: TrendingUp },
    { label: "Gross profit", value: m.grossProfit, before: prior?.grossProfit, icon: Sparkles },
    { label: "EBITDA", value: m.ebitda, before: prior?.ebitda, icon: Activity },
    { label: "Net profit", value: m.netProfit, before: prior?.netProfit, icon: PiggyBank },
    { label: "Cash", value: m.cash, before: prior?.cash, icon: Banknote },
    { label: "Equity", value: m.equity, before: prior?.equity, icon: Landmark },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="panel p-4">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-muted-foreground">{tile.label}</p>
            <tile.icon className="size-4 text-subtle-foreground" />
          </div>
          <p className="mt-2 font-display text-xl font-semibold tracking-[-0.015em] tabular-nums">
            <span className="mr-1 text-xs font-semibold tracking-normal text-subtle-foreground">{currency}</span>
            {compact(tile.value)}
          </p>
          <div className="mt-1.5">
            <Delta now={tile.value} before={tile.before} />
          </div>
        </div>
      ))}
    </div>
  )
}

const tooltipStyle = chartTooltipStyle

function TrendChart({ series }: { series: YearMetrics[] }) {
  const { ref, width } = useWidth()
  const data = series.map((x) => ({ year: String(x.year), Revenue: Math.round(x.revenue), "Gross profit": Math.round(x.grossProfit), "Net profit": Math.round(x.netProfit), "Net margin": x.ratios.netMargin === null ? null : +(x.ratios.netMargin * 100).toFixed(1) }))
  return (
    <div ref={ref} className="h-72 w-full">
      {width > 0 && (
        <ComposedChart width={width} height={288} data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={brand.hairline} vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="v" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={compact} width={48} />
          <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={40} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => (name === "Net margin" ? `${value}%` : Number(value).toLocaleString("en-US"))} />
          <Bar yAxisId="v" dataKey="Revenue" fill={C.primary} radius={[6, 6, 0, 0]} maxBarSize={38} />
          <Bar yAxisId="v" dataKey="Gross profit" fill={C.secondary} radius={[6, 6, 0, 0]} maxBarSize={38} />
          <Bar yAxisId="v" dataKey="Net profit" radius={[6, 6, 0, 0]} maxBarSize={38}>
            {data.map((d) => (
              <Cell key={d.year} fill={d["Net profit"] >= 0 ? C.tertiary : C.bad} />
            ))}
          </Bar>
          <Line yAxisId="p" dataKey="Net margin" stroke={C.warn} strokeWidth={3} dot={{ r: 4, fill: C.warn }} type="monotone" />
        </ComposedChart>
      )}
      <Legend items={[["Revenue", C.primary], ["Gross profit", C.secondary], ["Net profit", C.tertiary], ["Net margin %", C.warn]]} />
    </div>
  )
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  )
}

function Margins({ m, prior }: { m: YearMetrics; prior: YearMetrics | null }) {
  const rows = [
    { label: "Gross margin", now: m.ratios.grossMargin, before: prior?.ratios.grossMargin ?? null, color: C.secondary },
    { label: "EBITDA margin", now: m.ratios.ebitdaMargin, before: prior?.ratios.ebitdaMargin ?? null, color: C.tertiary },
    { label: "Net margin", now: m.ratios.netMargin, before: prior?.ratios.netMargin ?? null, color: C.primary },
    { label: "Payroll to revenue", now: m.ratios.payrollToRevenue, before: prior?.ratios.payrollToRevenue ?? null, color: C.warn },
  ]
  return (
    <div className="space-y-5">
      {rows.map((row) => {
        const width = row.now === null ? 0 : Math.max(0, Math.min(100, row.now * 100))
        const change = row.now !== null && row.before !== null ? (row.now - row.before) * 100 : null
        return (
          <div key={row.label}>
            <div className="flex items-baseline justify-between text-sm">
              <span>{row.label}</span>
              <span className="font-display font-semibold tabular-nums">
                {pct(row.now)}
                {change !== null && (
                  <span className={cn("ml-2 text-xs font-medium", (row.label === "Payroll to revenue" ? change <= 0 : change >= 0) ? "text-[var(--evergreen)]" : "text-[var(--danger)]")}>
                    {change >= 0 ? "+" : ""}
                    {change.toFixed(1)} pts
                  </span>
                )}
              </span>
            </div>
            <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: row.color }} />
              {row.before !== null && <span className="absolute top-0 h-full w-0.5 bg-[var(--ink)]/60" style={{ left: `${Math.max(0, Math.min(100, row.before * 100))}%` }} title="Prior year" />}
            </div>
          </div>
        )
      })}
      {prior && <p className="text-xs text-muted-foreground">The dark marker shows {prior.year}.</p>}
    </div>
  )
}

function ExpenseMix({ m, currency }: { m: YearMetrics; currency: string }) {
  const total = m.expenseMix.reduce((t, x) => t + x.value, 0)
  if (total <= 0) return <p className="text-sm text-muted-foreground">No administrative expenses recorded for {m.year}.</p>
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative">
        <PieChart width={190} height={190}>
          <Pie data={m.expenseMix} dataKey="value" nameKey="label" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
            {m.expenseMix.map((item, i) => (
              <Cell key={item.label} fill={MIX[i % MIX.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => Number(value).toLocaleString("en-US")} />
        </PieChart>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[10px] text-muted-foreground">{currency}</p>
            <p className="font-display text-lg font-semibold">{compact(total)}</p>
          </div>
        </div>
      </div>
      <ul className="w-full flex-1 space-y-2">
        {m.expenseMix.map((item, i) => (
          <li key={item.label} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: MIX[i % MIX.length] }} />
            <span className="flex-1 truncate">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">{compact(item.value)}</span>
            <span className="w-12 text-right font-semibold tabular-nums">{((item.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StackBar({ title, parts }: { title: string; parts: { label: string; value: number; color: string }[] }) {
  const shown = parts.filter((p) => p.value > 0.5)
  const total = shown.reduce((t, p) => t + p.value, 0)
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="font-semibold">{title}</span>
        <span className="tabular-nums text-muted-foreground">{compact(total)}</span>
      </div>
      <div className="flex h-9 overflow-hidden rounded-lg bg-secondary">
        {total > 0 &&
          shown.map((p) => (
            <div key={p.label} className="grid place-items-center text-[10px] font-semibold" style={{ width: `${(p.value / total) * 100}%`, background: p.color, color: onFill(p.color) }} title={`${p.label}: ${p.value.toLocaleString("en-US")}`}>
              {p.value / total > 0.12 ? `${((p.value / total) * 100).toFixed(0)}%` : ""}
            </div>
          ))}
      </div>
      <div className="mt-2">
        <Legend items={shown.map((p) => [p.label, p.color] as [string, string])} />
      </div>
    </div>
  )
}

function BalanceShape({ m }: { m: YearMetrics }) {
  return (
    <div className="space-y-6">
      <StackBar
        title="Assets"
        parts={[
          { label: "Cash", value: m.cash, color: C.tertiary },
          { label: "Receivables", value: m.receivables, color: C.primary },
          { label: "Inventory", value: m.inventory, color: C.secondary },
          { label: "Other current", value: Math.max(0, m.otherCurrentAssets), color: C.warn },
          { label: "Non-current", value: m.nonCurrentAssets, color: C.ink },
        ]}
      />
      <StackBar
        title="Funded by"
        parts={[
          { label: "Current liabilities", value: Math.max(0, m.currentLiabilities) + Math.max(0, -m.cash), color: C.gold },
          { label: "Non-current liabilities", value: Math.max(0, m.nonCurrentLiabilities), color: C.neutral },
          { label: "Equity", value: Math.max(0, m.equity), color: C.primary },
        ]}
      />
      {m.cash < 0 && <p className="note note-warning text-sm">The bank balance is overdrawn by {compact(-m.cash)}; it is shown as a liability, not an asset.</p>}
      {m.equity < 0 && <p className="note note-alert text-sm">Equity is negative: liabilities exceed assets by {compact(-m.equity)}.</p>}
    </div>
  )
}

function CashStory({ flow, closing }: { flow: { a: number; b: number; c: number }; closing: number }) {
  const items = [
    { label: "Operating (A)", value: flow.a },
    { label: "Investing (B)", value: flow.b },
    { label: "Financing (C)", value: flow.c },
  ]
  const max = Math.max(1, ...items.map((x) => Math.abs(x.value)))
  const net = flow.a + flow.b + flow.c
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex justify-between text-sm">
            <span>{item.label}</span>
            <span className={cn("font-semibold tabular-nums", item.value < 0 ? "text-[var(--danger)]" : "text-[var(--evergreen)]")}>{compact(item.value)}</span>
          </div>
          <div className="relative mt-1.5 h-3 rounded-full bg-secondary">
            <span className="absolute left-1/2 top-[-3px] h-[18px] w-px bg-border" />
            <div
              className="absolute top-0 h-full rounded-full"
              style={{
                width: `${(Math.abs(item.value) / max) * 50}%`,
                left: item.value >= 0 ? "50%" : `${50 - (Math.abs(item.value) / max) * 50}%`,
                background: item.value >= 0 ? C.good : C.bad,
              }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between rounded-lg border bg-[var(--surface-subtle)] px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">Net change in cash</p>
          <p className="font-display font-semibold tabular-nums">{compact(net)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Closing cash</p>
          <p className="font-display font-semibold tabular-nums">{compact(closing)}</p>
        </div>
      </div>
    </div>
  )
}

type Status = "good" | "watch" | "risk" | "na"
const STATUS: Record<Status, { label: string; className: string }> = {
  good: { label: "Healthy", className: "bg-[var(--lagoon-wash)] text-[var(--evergreen)]" },
  watch: { label: "Watch", className: "bg-[var(--saffron-wash)] text-[var(--warning-text)]" },
  risk: { label: "Risk", className: "bg-[var(--danger-subtle)] text-[var(--danger)]" },
  na: { label: "n/a", className: "bg-secondary text-muted-foreground" },
}
const band = (n: number | null, good: (x: number) => boolean, watch: (x: number) => boolean): Status => (n === null ? "na" : good(n) ? "good" : watch(n) ? "watch" : "risk")

function Ratios({ m, prior }: { m: YearMetrics; prior: YearMetrics | null }) {
  const r = m.ratios
  const p = prior?.ratios
  const list = [
    { group: "Liquidity", label: "Current ratio", value: times(r.currentRatio), before: p ? times(p.currentRatio) : null, status: band(r.currentRatio, (x) => x >= 1.5, (x) => x >= 1), hint: "Current assets for each dirham due within a year" },
    { group: "Liquidity", label: "Quick ratio", value: times(r.quickRatio), before: p ? times(p.quickRatio) : null, status: band(r.quickRatio, (x) => x >= 1, (x) => x >= 0.7), hint: "Same, without inventory" },
    { group: "Liquidity", label: "Cash ratio", value: times(r.cashRatio), before: p ? times(p.cashRatio) : null, status: band(r.cashRatio, (x) => x >= 0.5, (x) => x >= 0.2), hint: "Cash alone against current liabilities" },
    { group: "Leverage", label: "Debt to equity", value: times(r.debtToEquity), before: p ? times(p.debtToEquity) : null, status: m.equity <= 0 ? ("risk" as Status) : band(r.debtToEquity, (x) => x <= 1, (x) => x <= 2), hint: "Total liabilities per dirham of equity" },
    { group: "Leverage", label: "Interest cover", value: times(r.interestCover), before: p ? times(p.interestCover) : null, status: band(r.interestCover, (x) => x >= 4, (x) => x >= 2), hint: "Operating profit over interest" },
    { group: "Returns", label: "Return on equity", value: pct(r.returnOnEquity), before: p ? pct(p.returnOnEquity) : null, status: band(r.returnOnEquity, (x) => x >= 0.15, (x) => x >= 0.05), hint: "Profit earned on the owners' funds" },
    { group: "Returns", label: "Return on assets", value: pct(r.returnOnAssets), before: p ? pct(p.returnOnAssets) : null, status: band(r.returnOnAssets, (x) => x >= 0.08, (x) => x >= 0.02), hint: "Profit for every dirham of assets" },
    { group: "Returns", label: "Asset turnover", value: times(r.assetTurnover), before: p ? times(p.assetTurnover) : null, status: band(r.assetTurnover, (x) => x >= 1, (x) => x >= 0.5), hint: "Revenue generated per dirham of assets" },
    { group: "Efficiency", label: "Receivable days", value: days(r.receivableDays), before: p ? days(p.receivableDays) : null, status: band(r.receivableDays, (x) => x <= 60, (x) => x <= 90), hint: "How long customers take to pay" },
    { group: "Efficiency", label: "Payable days", value: days(r.payableDays), before: p ? days(p.payableDays) : null, status: band(r.payableDays, (x) => x <= 75, (x) => x <= 120), hint: "How long the business takes to pay suppliers" },
    { group: "Efficiency", label: "Inventory days", value: days(r.inventoryDays), before: p ? days(p.inventoryDays) : null, status: band(r.inventoryDays, (x) => x <= 60, (x) => x <= 120), hint: "Stock on hand in days of cost of sales" },
    { group: "Efficiency", label: "Cash conversion", value: days(r.cashConversionDays), before: p ? days(p.cashConversionDays) : null, status: band(r.cashConversionDays, (x) => x <= 45, (x) => x <= 90), hint: "Days cash is tied up in the trading cycle" },
  ]
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {list.map((item) => (
        <div key={item.label} className="rounded-2xl border bg-secondary/30 p-3" title={item.hint}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{item.group}</p>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS[item.status].className)}>{STATUS[item.status].label}</span>
          </div>
          <p className="mt-1 text-sm">{item.label}</p>
          <p className="font-display text-lg font-semibold tabular-nums">
            {item.value}
            {item.before && item.before !== "n/a" && <span className="ml-2 text-xs font-normal text-muted-foreground">was {item.before}</span>}
          </p>
        </div>
      ))}
    </div>
  )
}

type Insight = { tone: "good" | "warning" | "alert" | "info"; text: string }
export function buildInsights(m: YearMetrics, prior: YearMetrics | null, series: YearMetrics[], cashFlow: { a: number; b: number; c: number }, currency: string): Insight[] {
  const out: Insight[] = []
  const r = m.ratios
  if (prior) {
    const g = growth(m.revenue, prior.revenue)
    if (g !== null) out.push({ tone: g >= 0 ? "good" : "warning", text: `Revenue ${g >= 0 ? "grew" : "fell"} ${pct(Math.abs(g))} to ${currency} ${compact(m.revenue)}.` })
    const gp = r.grossMargin !== null && prior.ratios.grossMargin !== null ? (r.grossMargin - prior.ratios.grossMargin) * 100 : null
    if (gp !== null && Math.abs(gp) >= 2) out.push({ tone: gp > 0 ? "good" : "warning", text: `Gross margin ${gp > 0 ? "improved" : "slipped"} by ${Math.abs(gp).toFixed(1)} points, so ${gp > 0 ? "pricing or direct costs moved in your favour" : "direct costs rose faster than sales"}.` })
    const costGrowth = growth(m.operatingExpenses, prior.operatingExpenses)
    const revGrowth = growth(m.revenue, prior.revenue)
    if (costGrowth !== null && revGrowth !== null && costGrowth - revGrowth > 0.1)
      out.push({ tone: "warning", text: `Overheads grew ${pct(costGrowth)} while revenue grew ${pct(revGrowth)}. Review the largest expense heads.` })
    if (r.receivableDays !== null && prior.ratios.receivableDays !== null && r.receivableDays - prior.ratios.receivableDays > 15)
      out.push({ tone: "warning", text: `Customers are paying slower: receivable days rose from ${Math.round(prior.ratios.receivableDays)} to ${Math.round(r.receivableDays)}.` })
  } else out.push({ tone: "info", text: `Only ${m.year} is saved. Add the previous year in Data Input to unlock comparatives and trend analysis.` })
  if (m.netProfit < 0) out.push({ tone: "alert", text: `The business made a loss of ${currency} ${compact(-m.netProfit)}. Losses can be carried forward against future taxable income for corporate tax.` })
  else if (r.netMargin !== null && r.netMargin >= 0.15) out.push({ tone: "good", text: `A net margin of ${pct(r.netMargin)} is strong for most SME sectors.` })
  if (r.currentRatio !== null && r.currentRatio < 1) out.push({ tone: "alert", text: `Current liabilities exceed current assets (current ratio ${times(r.currentRatio)}). Short-term obligations depend on new cash coming in.` })
  if (cashFlow.a < 0 && m.netProfit > 0) out.push({ tone: "warning", text: `Profit did not turn into cash: operations used ${currency} ${compact(-cashFlow.a)} despite a profit. Working capital absorbed it.` })
  if (cashFlow.a > 0 && m.netProfit > 0 && cashFlow.a >= m.netProfit) out.push({ tone: "good", text: `Operating cash flow of ${compact(cashFlow.a)} covers reported profit, a sign of good earnings quality.` })
  if (m.equity < 0) out.push({ tone: "alert", text: `Negative equity of ${compact(m.equity)}. Banks and licensing authorities may ask for shareholder support or capital injection.` })
  if (r.payrollToRevenue !== null && r.payrollToRevenue > 0.5) out.push({ tone: "warning", text: `Payroll takes ${pct(r.payrollToRevenue)} of revenue, a high share that limits room for other costs.` })
  const top = m.expenseMix[0]
  const mixTotal = m.expenseMix.reduce((t, x) => t + x.value, 0)
  if (top && mixTotal > 0 && top.value / mixTotal > 0.4) out.push({ tone: "info", text: `${top.label} is ${((top.value / mixTotal) * 100).toFixed(0)}% of administrative expenses, the main lever on overheads.` })
  const c = cagr(series.map((x) => x.revenue))
  if (c !== null && series.length > 2) out.push({ tone: c >= 0 ? "good" : "warning", text: `Over ${series.length} years revenue compounded at ${pct(c)} a year.` })
  if (m.revenue > 0 && m.revenue <= 3_000_000) out.push({ tone: "info", text: `Revenue is within the AED 3 million small business relief limit, if elected and the other conditions are met.` })
  return out
}

function Insights(props: { m: YearMetrics; prior: YearMetrics | null; series: YearMetrics[]; cashFlow: { a: number; b: number; c: number }; currency: string }) {
  const list = buildInsights(props.m, props.prior, props.series, props.cashFlow, props.currency)
  return (
    <section className="panel p-5">
      <Title icon={Sparkles} title="What the numbers say" hint="Generated from your figures" />
      <ul className="grid gap-2.5 md:grid-cols-2">
        {list.map((item, i) => (
          <li key={i} className={cn("note text-sm", `note-${item.tone}`)}>
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  )
}
