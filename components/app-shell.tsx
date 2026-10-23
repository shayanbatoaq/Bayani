"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { ClipboardCheck, FilePen, FileText, Gem, History, Landmark, LayoutDashboard, LogOut, MoreHorizontal, Network, Receipt, ReceiptText, SlidersHorizontal, Upload, X } from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"

const navItems = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: LayoutDashboard, dock: true, section: "Work" },
  { href: "/data-input", label: "Data input", short: "Data", icon: Upload, dock: true, section: "Work" },
  { href: "/invoices", label: "Invoices", icon: ReceiptText, dock: true, section: "Work" },
  { href: "/bills", label: "Bills", icon: FilePen, dock: true, section: "Work" },
  { href: "/adjustments", label: "Adjustments", icon: SlidersHorizontal, section: "Work" },
  { href: "/reports", label: "Reports", icon: FileText, section: "Reports" },
  { href: "/vat", label: "VAT", icon: Receipt, section: "Reports" },
  { href: "/corporate-tax", label: "Corporate tax", short: "CT", icon: Landmark, section: "Reports" },
  { href: "/valuation", label: "Valuation", short: "Value", icon: Gem, section: "Reports" },
  { href: "/e-invoicing", label: "E-invoicing", icon: Network, section: "Reports" },
  { href: "/audit", label: "Audit", icon: ClipboardCheck, section: "Review" },
  { href: "/activity", label: "Activity", icon: History, section: "Review" },
]
const sections = ["Work", "Reports", "Review"]

function useActive() {
  const pathname = usePathname()
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`)
}

function SignOutButton({ compact }: { compact?: boolean }) {
  const router = useRouter()
  return (
    <button
      type="button"
      className={compact ? "rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground" : "nav-link w-full"}
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[15.5rem] flex-col border-r bg-card lg:flex">
        <div className="flex h-16 items-center px-5">
          <BrandLogo href="/dashboard" imageClassName="h-8" priority />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((section) => (
            <div key={section} className="mt-4 first:mt-1">
              <p className="px-2.5 pb-1.5 text-xs font-medium text-subtle-foreground">{section}</p>
              <div className="grid gap-0.5">
                {navItems
                  .filter((item) => item.section === section)
                  .map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className="nav-link" aria-current={isActive(href) ? "page" : undefined}>
                      <span className="nav-icon">
                        <Icon className="size-4" />
                      </span>
                      {label}
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="space-y-2 border-t px-3 py-4">
          <p className="px-2.5 text-xs leading-5 text-subtle-foreground">
            Figures are prepared from what you enter and should be reviewed before filing.
          </p>
          <SignOutButton />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-card px-4 lg:hidden">
        <BrandLogo href="/dashboard" imageClassName="h-7" />
        <SignOutButton compact />
      </header>

      <main className="min-h-screen px-4 pb-32 pt-6 sm:px-6 lg:ml-[15.5rem] lg:px-10 lg:pb-12 lg:pt-10">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t bg-card px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 lg:hidden"
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
        <div className="fixed inset-0 z-20 bg-[rgba(17,26,22,.24)] lg:hidden" onClick={() => setMore(false)}>
          <nav aria-label="More" className="absolute inset-x-3 bottom-[4.75rem] grid grid-cols-3 gap-1 rounded-xl border bg-card p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
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
