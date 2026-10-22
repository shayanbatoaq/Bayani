import { EmailLogin } from "@/components/email-login"

export default function LoginPage() {
  return (
    <div className="w-full max-w-md rounded-[22px] border border-white/10 bg-white/[0.06] p-8 text-center text-white backdrop-blur">
      <h1 className="font-display text-2xl font-semibold">Welcome back</h1>
      <p className="mt-2 text-sm text-white/65">
        Continue to your dashboard with a secure email link.
      </p>
      <EmailLogin />
    </div>
  )
}
