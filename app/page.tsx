import { BrandLogo } from "@/components/brand-logo"
import { QuickLogin } from "@/components/quick-login"

const route = [
  { label: "Company documents", text: "Trade licence, MOA and tax certificates read for you." },
  { label: "Trial balance", text: "Each year entered as balances or movements." },
  { label: "Financial statements", text: "Balance sheet to schedules, as PDF or Excel." },
  { label: "Corporate tax", text: "The full return, computed and explained." },
  { label: "VAT", text: "Your filed returns, tracked and analysed." },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <BrandLogo priority imageClassName="h-8" />
        <QuickLogin size="default" />
      </header>

      <section className="mx-auto grid max-w-6xl gap-14 px-5 pb-24 pt-12 sm:px-8 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:pt-20">
        <div>
          <h1 className="max-w-2xl font-display text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[3.25rem]">
            Accounts and UAE tax, prepared from your own figures.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Bayani reads your company documents and trial balance, then builds the statements, the corporate tax return and a running view of your VAT, with every figure explained.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <QuickLogin className="h-11 px-5 text-[15px]" label="Open your workspace" />
            <span className="text-sm text-subtle-foreground">No card details needed</span>
          </div>
        </div>

        <ol className="rounded-xl border bg-card p-2">
          {route.map((step, i) => (
            <li key={step.label} className="flex gap-4 rounded-lg px-4 py-3.5 [&+&]:border-t [&+&]:rounded-none">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-xs font-semibold tabular-nums text-[var(--evergreen)]">
                {i + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold text-foreground">{step.label}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t px-5 py-8 text-center text-[13px] text-subtle-foreground">
        Outputs are prepared from the figures you provide and should be reviewed before filing.
      </footer>
    </main>
  )
}
