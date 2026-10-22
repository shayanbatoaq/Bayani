import { redirect } from "next/navigation"

// Sign-in is passwordless (email link or social), so there is no password to reset.
export default function ForgotPasswordPage() {
  redirect("/login")
}
