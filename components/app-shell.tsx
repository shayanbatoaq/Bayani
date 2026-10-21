"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building2,
  DollarSign,
  Download,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings,
  ShieldCheck,
  Upload,
} from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/profile", label: "Profile", icon: Building2 },
  { href: "/regulatory", label: "Regulatory", icon: ShieldCheck },
  { href: "/data-input", label: "Data Input", icon: Upload },
  { href: "/final-report", label: "Final Report", icon: Download },
  { href: "/vat", label: "VAT", icon: Receipt },
  { href: "/corporate-tax", label: "Corporate Tax", icon: Landmark },
  { href: "/audit", label: "Audit", icon: ShieldCheck },
  { href: "/valuation", label: "Valuation", icon: DollarSign },
  { href: "/admin", label: "Admin", icon: Settings },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="grid gap-1">
      {navItems.map((item) => {
        const Icon = item.icon
        const active = pathname === item.href

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
              active && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
            )}
          >
            <Icon className="size-4" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-border/80 bg-card/92 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex h-20 items-center px-6">
          <BrandLogo href="/dashboard" imageClassName="h-11" priority />
        </div>
        <Separator />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <NavLinks />
        </div>
        <div className="border-t border-border/80 p-4">
          <Button asChild variant="outline" className="w-full justify-start">
            <Link href="/login">
              <LogOut className="size-4" />
              Sign out
            </Link>
          </Button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/80 bg-background/88 px-4 backdrop-blur lg:hidden">
        <BrandLogo href="/dashboard" imageClassName="h-9" />
        <Sheet>
          <SheetTrigger asChild>
            <Button size="icon" variant="outline" aria-label="Open navigation">
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[320px]">
            <SheetHeader>
              <SheetTitle>
                <BrandLogo href="/dashboard" imageClassName="h-10" />
              </SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto px-3 pb-6">
              <NavLinks />
            </div>
          </SheetContent>
        </Sheet>
      </header>

      <main className="min-h-screen px-4 pb-28 pt-6 sm:px-6 lg:ml-72 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/80 bg-card/94 px-2 py-2 shadow-[0_-12px_30px_rgba(46,68,85,0.08)] backdrop-blur-xl lg:hidden">
        <div className="flex gap-1 overflow-x-auto">
          {navItems.slice(0, 8).map((item) => {
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-w-20 flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground"
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            )
          })}
          <Link
            href="/admin"
            className="flex min-w-20 flex-col items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-muted-foreground"
          >
            <Home className="size-4" />
            Admin
          </Link>
        </div>
      </nav>
    </div>
  )
}
