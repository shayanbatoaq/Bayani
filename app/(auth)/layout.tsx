import { BrandLogo } from "@/components/brand-logo"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandLogo imageClassName="h-9" />
        </div>
        {children}
      </div>
    </main>
  )
}
