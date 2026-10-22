"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { useForm, type Resolver } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import {
  authSchema,
  forgotPasswordSchema,
  registerSchema,
} from "@/lib/schemas"

type AuthMode = "login" | "register" | "forgot"

type AuthFormProps = {
  mode: AuthMode
}

type AuthFields = {
  email: string
  password: string
  name: string
  company: string
}

const copy = {
  login: {
    title: "Login",
    submit: "Login",
    success: "Signed in. Redirecting to your dashboard.",
    footer: "New to Bayani?",
    footerHref: "/register",
    footerLink: "Create an account",
  },
  register: {
    title: "Register",
    submit: "Create account",
    success: "Account created. Check your email if confirmation is enabled.",
    footer: "Already have an account?",
    footerHref: "/login",
    footerLink: "Login",
  },
  forgot: {
    title: "Forgot password",
    submit: "Send reset link",
    success: "Password reset email sent if the account exists.",
    footer: "Remembered your password?",
    footerHref: "/login",
    footerLink: "Back to login",
  },
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const [notice, setNotice] = useState<{
    type: "success" | "error"
    title: string
    message: string
  } | null>(null)

  const schema =
    mode === "register"
      ? registerSchema
      : mode === "forgot"
        ? forgotPasswordSchema
        : authSchema
  const resolver = zodResolver(schema as never) as unknown as Resolver<AuthFields>

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthFields>({
    resolver,
    defaultValues: {
      email: "",
      password: "",
      name: "",
      company: "",
    },
  })

  async function onSubmit(values: AuthFields) {
    const supabase = getSupabaseBrowserClient()

    if (!supabase) {
      setNotice({
        type: "error",
        title: "Supabase is not configured",
        message:
          "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable live authentication. The product UI remains available in demo mode.",
      })
      return
    }

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password ?? "",
      })

      if (error) {
        setNotice({ type: "error", title: "Login failed", message: error.message })
        return
      }

      setNotice({ type: "success", title: "Authenticated", message: copy.login.success })
      router.push("/dashboard")
      return
    }

    if (mode === "register") {
      const { error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password ?? "",
        options: {
          data: {
            name: values.name,
            company: values.company,
          },
        },
      })

      if (error) {
        setNotice({ type: "error", title: "Registration failed", message: error.message })
        return
      }

      setNotice({ type: "success", title: "Account created", message: copy.register.success })
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/login`,
    })

    if (error) {
      setNotice({ type: "error", title: "Reset failed", message: error.message })
      return
    }

    setNotice({ type: "success", title: "Reset email sent", message: copy.forgot.success })
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">{copy[mode].title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          {mode === "register" ? (
            <>
              <Field label="Full name" error={errors.name?.message}>
                <Input autoComplete="name" {...register("name")} />
              </Field>
              <Field label="Company" error={errors.company?.message}>
                <Input autoComplete="organization" {...register("company")} />
              </Field>
            </>
          ) : null}

          <Field label="Email" error={errors.email?.message}>
            <Input type="email" autoComplete="email" {...register("email")} />
          </Field>

          {mode !== "forgot" ? (
            <Field label="Password" error={errors.password?.message}>
              <Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} {...register("password")} />
            </Field>
          ) : null}

          {notice ? (
            <Alert variant={notice.type === "error" ? "destructive" : "default"}>
              {notice.type === "error" ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
              <AlertTitle>{notice.title}</AlertTitle>
              <AlertDescription>{notice.message}</AlertDescription>
            </Alert>
          ) : null}

          <Button className="w-full" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Working..." : copy[mode].submit}
          </Button>
        </form>

        <div className="mt-5 flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>{copy[mode].footer}</span>
          <Link href={copy[mode].footerHref} className="font-medium text-primary">
            {copy[mode].footerLink}
          </Link>
        </div>

        {mode === "login" ? (
          <Link href="/forgot-password" className="mt-3 inline-flex text-sm font-medium text-primary">
            Forgot password?
          </Link>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
