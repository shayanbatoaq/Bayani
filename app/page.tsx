import { Building2, FileText, Landmark, Receipt, Upload } from "lucide-react"

import { QuickLogin } from "@/components/quick-login"
import { BrandLogo } from "@/components/brand-logo"

const steps = [
  { icon: Building2, title: "Add your company", text: "Upload the trade license, MOA and tax certificates. Details are read automatically." },
  { icon: Upload, title: "Load the trial balance", text: "Up to five years, from the template or entered head by head." },
  { icon: FileText, title: "Get financial statements", text: "Balance sheet, P&L, equity, cash flow and notes in one PDF." },
  { icon: Receipt, title: "See VAT by period", text: "Output and input VAT for each return period from your registration." },
  { icon: Landmark, title: "Corporate tax position", text: "Taxable income, small business relief and filing deadlines per year." },
]

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <BrandLogo priority imageClassName="h-11" />
        <QuickLogin size="default" />
      </header>

      <section className="mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-6 sm:px-6 lg:grid-cols-[1fr_28rem] lg:items-start lg:gap-16 lg:px-8 lg:pt-14">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            For UAE businesses
          </p>
          <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight text-primary sm:text-5xl">
            From trial balance to financial statements, VAT and corporate tax.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            Set up your company once, load your figures for each year, and FinScope prepares the
            full statements and tax positions.
          </p>
          <ol className="mt-10 grid max-w-2xl gap-5 sm:grid-cols-2">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-primary shadow-sm">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-medium">
                    {index + 1}. {title}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex justify-center lg:sticky lg:top-8">
          <div className="w-full max-w-md rounded-xl border bg-white p-8 shadow-sm">
            <h2 className="text-xl font-semibold">Get started</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Log in to your dashboard, add your company from its documents and start preparing statements.
            </p>
            <QuickLogin className="mt-6 w-full" />
          </div>
        </div>
      </section>

      <footer className="border-t border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
        FinScope outputs are prepared from the figures you provide and require professional review.
      </footer>
    </main>
  )
}
