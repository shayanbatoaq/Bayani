import { QuickLogin } from "@/components/quick-login"

export default function LoginPage() {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.06] p-8 text-center text-white backdrop-blur">
      <h1 className="font-display text-2xl font-semibold">Welcome back</h1>
      <p className="mt-2 text-sm text-white/65">Continue to your dashboard.</p>
      <QuickLogin className="mt-6 h-11 w-full" />
    </div>
  )
}
