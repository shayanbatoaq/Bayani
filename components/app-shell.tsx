"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { ClipboardCheck, FilePen, FileText, Gem, History, Landmark, LayoutDashboard, LogOut, MoreHorizontal, Network, Receipt, ReceiptText, SlidersHorizontal, Upload, X } from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"

const navItems = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: LayoutDashboard, dock: true },
  { href: "/data-input", label: "Data Input", short: "Data", icon: Upload, dock: true },
  { href: "/invoices", label: "Invoices", icon: ReceiptText, dock: true },
  { href: "/bills", label: "Bills", icon: FilePen, dock: true },
  { href: "/adjustments", label: "Adjustments", icon: SlidersHorizontal },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/vat", label: "VAT", icon: Receipt },
  { href: "/corporate-tax", label: "Corporate Tax", short: "CT", icon: Landmark },
  { href: "/audit", label: "Audit", icon: ClipboardCheck },
  { href: "/valuation", label: "Valuation", short: "Value", icon: Gem },
  { href: "/e-invoicing", label: "E-Invoicing", icon: Network },
  { href: "/activity", label: "Activity", icon: History },
]

function useActive() {
  const pathname = usePathname()
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`)
}

function SignOutButton({ compact }: { compact?: boolean }) {
  const router = useRouter()
  return (
    <button
      type="button"
      className={compact ? "rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" : "nav-link w-full"}
      aria-label="Sign out"
      onClick={async () => {
        await getSupabaseBrowserClient()?.auth.signOut()
        router.push("/")
        router.refresh()
      }}
    >
      {compact ? (
        <LogOut className="size-5" />
      ) : (
        <>
          <span className="nav-icon">
            <LogOut className="size-4" />
          </span>
          Sign out
        </>
      )}
    </button>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const isActive = useActive()
  const [more, setMore] = useState(false)
  const extra = navItems.filter((item) => !item.dock)
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col bg-[var(--ink)] lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(22rem 14rem at 0% 0%, rgba(47,91,255,.28), transparent 70%), radial-gradient(18rem 18rem at 100% 100%, rgba(18,181,166,.16), transparent 70%)",
          }}
        />
        <div className="relative flex h-20 items-center px-6">
          <BrandLogo href="/dashboard" tone="light" imageClassName="h-10" priority />
        </div>
        <nav aria-label="Main" className="relative grid gap-1 px-3 py-4">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="nav-link" aria-current={isActive(href) ? "page" : undefined}>
              <span className="nav-icon">
                <Icon className="size-4" />
              </span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="relative mt-auto space-y-3 px-3 pb-5">
          <p className="mx-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-white/60">
            Figures are prepared from what you enter and should be reviewed before filing.
          </p>
          <SignOutButton />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-[var(--ink)] px-4 lg:hidden">
        <BrandLogo href="/dashboard" tone="light" imageClassName="h-8" />
        <SignOutButton compact />
      </header>

      <main className="min-h-screen px-4 pb-32 pt-6 sm:px-6 lg:ml-[17rem] lg:px-10 lg:pb-12 lg:pt-10">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-3 bottom-3 z-30 flex gap-1 rounded-[20px] bg-[var(--ink)]/95 p-1.5 shadow-[0_18px_40px_-12px_rgba(13,27,46,.7)] ring-1 ring-white/10 backdrop-blur lg:hidden"
      >
        {navItems
          .filter((item) => item.dock)
          .map(({ href, label, short, icon: Icon }) => (
            <Link key={href} href={href} className="dock-link" aria-current={isActive(href) ? "page" : undefined}>
              <Icon className="size-5" />
              {short ?? label}
            </Link>
          ))}
        <button type="button" className="dock-link" aria-expanded={more} aria-current={extra.some((item) => isActive(item.href)) ? "page" : undefined} onClick={() => setMore((m) => !m)}>
          {more ? <X className="size-5" /> : <MoreHorizontal className="size-5" />}
          More
        </button>
      </nav>
      {more && (
        <div className="fixed inset-0 z-20 bg-[rgba(13,27,46,.35)] lg:hidden" onClick={() => setMore(false)}>
          <nav aria-label="More" className="absolute inset-x-3 bottom-[5.25rem] grid grid-cols-3 gap-2 rounded-[20px] bg-[var(--ink)] p-3 shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
            {extra.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="dock-link py-3" onClick={() => setMore(false)} aria-current={isActive(href) ? "page" : undefined}>
                <Icon className="size-5" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  )
}
