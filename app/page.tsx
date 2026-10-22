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
    <main className="min-h-screen bg-[var(--ink)] text-white">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(48rem 30rem at 85% -10%, rgba(47,91,255,.35), transparent 70%), radial-gradient(40rem 28rem at -10% 110%, rgba(18,181,166,.22), transparent 70%)",
        }}
      />
      <header className="relative mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
        <BrandLogo tone="light" priority imageClassName="h-10" />
        <QuickLogin size="default" />
      </header>

      <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:pt-16">
        <div>
          <h1 className="max-w-2xl font-display text-[2.6rem] font-semibold leading-[1.08] sm:text-6xl">
            Accounts and UAE tax, prepared from your own figures.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-white/70">
            FinScope reads your company documents and trial balance, then builds the statements, the corporate tax return and a running view of your VAT — with every figure explained.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <QuickLogin className="h-12 px-6 text-base" label="Open your workspace" />
            <span className="text-sm text-white/50">No card details needed</span>
          </div>
        </div>

        {/* The route a company's figures travel, drawn once as a signal trace. */}
        <ol className="relative space-y-1 rounded-[26px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur sm:p-8">
          <svg aria-hidden className="absolute left-[2.35rem] top-10 h-[calc(100%-6.5rem)] w-1 sm:left-[2.85rem]" preserveAspectRatio="none" viewBox="0 0 2 100">
            <line x1="1" y1="0" x2="1" y2="100" pathLength={100} stroke="url(#trace)" strokeWidth="2" className="trace" />
            <defs>
              <linearGradient id="trace" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
                <stop offset="0" stopColor="#2f5bff" />
                <stop offset="1" stopColor="#12b5a6" />
              </linearGradient>
            </defs>
          </svg>
          {route.map((step, i) => (
            <li key={step.label} className="relative flex gap-5 py-3">
              <span className="relative z-10 grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ink-3)] font-display text-sm font-semibold ring-2 ring-[var(--cobalt)]/60">
                {i + 1}
              </span>
              <span>
                <span className="block font-display font-semibold">{step.label}</span>
                <span className="mt-0.5 block text-sm text-white/60">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="relative border-t border-white/10 px-5 py-8 text-center text-sm text-white/45">
        Outputs are prepared from the figures you provide and should be reviewed before filing.
      </footer>
    </main>
  )
}
