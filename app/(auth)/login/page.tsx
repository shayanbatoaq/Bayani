import { EmailLogin } from "@/components/email-login"

export default function LoginPage() {
  return (
    <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center">
      <h1 className="font-display text-xl font-semibold tracking-[-0.015em]">Welcome back</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Continue to your dashboard with a secure email link.
      </p>
      <EmailLogin />
    </div>
  )
}
