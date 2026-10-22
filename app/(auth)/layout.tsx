import { BrandLogo } from "@/components/brand-logo"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--ink)] px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ background: "radial-gradient(40rem 26rem at 80% 0%, rgba(47,91,255,.35), transparent 70%), radial-gradient(34rem 24rem at 0% 100%, rgba(18,181,166,.2), transparent 70%)" }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandLogo tone="light" imageClassName="h-10" />
        </div>
        {children}
      </div>
    </main>
  )
}
