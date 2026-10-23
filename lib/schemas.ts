import { z } from "zod"

export const authSchema = z.object({
  email: z.email("Enter a valid business email."),
  password: z.string().min(8, "Password must be at least 8 characters."),
})

export const registerSchema = authSchema.extend({
  name: z.string().min(2, "Enter your name."),
  company: z.string().min(2, "Enter your company name."),
})

export const forgotPasswordSchema = z.object({
  email: z.email("Enter the email linked to your Bayani account."),
})

export const profileSchema = z.object({
  companyName: z.string().min(2, "Company name is required."),
  country: z.string().min(2, "Country is required."),
  emirate: z.string().min(2, "Emirate is required."),
  industryFamily: z.string().min(2, "Industry family is required."),
  businessActivity: z.string().min(2, "Business activity is required."),
  companyAge: z.string().min(1, "Company age is required."),
  revenueBand: z.string().min(1, "Revenue band is required."),
  employeeBand: z.string().min(1, "Employee band is required."),
  licenseType: z.string().min(1, "License type is required."),
  licenseAuthority: z.string().min(1, "License authority is required."),
  vatRegistered: z.boolean(),
  corporateTaxRegistered: z.boolean(),
  auditRequired: z.boolean(),
  financialRecords: z.string().min(1, "Select records available."),
  primaryObjective: z.string().min(1, "Select a primary objective."),
})

export const leadSchema = z.object({
  name: z.string().min(2, "Name is required."),
  email: z.email("Enter a valid email."),
  phone: z.string().min(7, "Enter a reachable phone number."),
  company: z.string().min(2, "Company is required."),
  service: z.string().min(2, "Select a review service."),
  notes: z.string().max(800).optional(),
})

export const manualTrialBalanceSchema = z.object({
  ledgerName: z.string().min(2),
  amount: z.coerce.number(),
})

export type AuthFormValues = z.infer<typeof authSchema>
export type RegisterFormValues = z.infer<typeof registerSchema>
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>
export type ProfileFormValues = z.infer<typeof profileSchema>
export type LeadFormValues = z.infer<typeof leadSchema>
