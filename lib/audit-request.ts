import { z } from "zod"

export const AUDIT_PURPOSES = ["License renewal", "Corporate Tax", "Management review", "Bank Facility", "Others"] as const

const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const phone = /^\+?[0-9][0-9\s()-]{6,18}$/

/** A request for an audit quotation. Contact must be a phone number or an email address. */
export const auditRequestInputSchema = z
  .object({
    companyId: z.string().uuid(),
    years: z.array(z.number().int().min(2000).max(2100)).min(1, "Select at least one year of audit.").max(10),
    purpose: z.enum(AUDIT_PURPOSES, { message: "Select the purpose of the audit." }),
    otherPurpose: z.string().trim().max(200).optional().default(""),
    contact: z
      .string()
      .trim()
      .min(1, "Enter a contact number or email.")
      .max(120)
      .refine((value) => email.test(value) || phone.test(value), "Enter a valid phone number or email address."),
    notes: z.string().trim().max(1000).optional().default(""),
  })
  .refine((value) => value.purpose !== "Others" || value.otherPurpose.length > 0, { message: "Describe the purpose of the audit.", path: ["otherPurpose"] })

export type AuditRequestInput = z.infer<typeof auditRequestInputSchema>
export type AuditRequest = AuditRequestInput & { id: string; companyName: string; createdAt: string; status: "Received" }

export const contactKind = (contact: string) => (email.test(contact) ? "email" : "phone")

/** Audit years offered: the company's saved years plus recent financial years. */
export function auditYearOptions(savedYears: number[], now = new Date()) {
  const current = now.getFullYear()
  const years = new Set<number>(savedYears)
  for (let y = current - 5; y <= current; y++) years.add(y)
  return [...years].sort((a, b) => b - a)
}
