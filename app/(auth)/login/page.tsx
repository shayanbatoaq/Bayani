import { BrandLogo } from "@/components/brand-logo"
import { QuickLogin } from "@/components/quick-login"

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm rounded-xl border bg-white p-8 text-center shadow-sm">
      <BrandLogo imageClassName="mx-auto h-11" />
      <h1 className="mt-6 text-xl font-semibold">Welcome to FinScope</h1>
      <p className="mt-2 text-sm text-muted-foreground">Continue to your dashboard.</p>
      <QuickLogin className="mt-6 w-full" />
    </div>
  )
}
