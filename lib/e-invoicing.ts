import { z } from "zod"

/**
 * UAE e-invoicing (Ministerial Decisions 243 and 244 of 2025 as amended by MD 66 of 2026,
 * penalties under Cabinet Decision 106 of 2025). Checked October 2026; dates move, so the page
 * links the sources and asks the user to confirm with the FTA or their provider.
 */
export const THRESHOLD = 50_000_000

export const WAVES = [
  { key: "large", label: "Revenue of AED 50 million or more", asp: "2026-10-30", live: "2027-01-01" },
  { key: "other", label: "Revenue below AED 50 million", asp: "2027-03-31", live: "2027-07-01" },
  { key: "government", label: "Government entities", asp: "2027-03-31", live: "2027-10-01" },
] as const

export const PENALTIES = [
  { what: "Not implementing e-invoicing, or not appointing an accredited service provider (ASP) by the deadline", amount: "AED 5,000 for each month (or part) of delay" },
  { what: "Not issuing or transmitting an e-invoice in time", amount: "AED 100 per invoice, up to AED 5,000 a month" },
  { what: "Not issuing or transmitting an e-credit note in time", amount: "AED 100 per credit note, up to AED 5,000 a month" },
  { what: "Not reporting a system failure to the FTA within 2 business days", amount: "AED 1,000 per day of delay" },
  { what: "Not telling the ASP about changes to your registered data within 5 business days", amount: "AED 1,000 per day of delay" },
]

export const RULES = [
  "Applies to business-to-business (B2B) and business-to-government (B2G) supplies by persons doing business in the UAE, whether or not VAT registered. Business-to-consumer (B2C) supplies are not in scope for now.",
  "Invoices and credit notes are issued in a structured electronic format (PINT AE, based on Peppol) through an FTA-accredited service provider; a PDF sent by email no longer counts as the invoice.",
  "The ASP validates each invoice, sends it to the buyer's ASP and reports the tax data to the FTA (a five-corner model).",
  "E-invoices and e-credit notes must be issued and transmitted within 14 calendar days of the supply (or of the event for a credit note).",
  "A system failure must be reported to the FTA within 2 business days; changes to the company's data must be notified to the ASP within 5 business days.",
  "E-invoicing data must be stored in the UAE.",
  "Excluded for now: supplies by sovereign government bodies in their sovereign capacity, certain international airline passenger services, and exempt or zero-rated financial services; international air cargo is excluded for 24 months.",
  "Voluntary adoption (pilot) has been open since 1 July 2026.",
]

export const SOURCES = [
  { title: "Andersen UAE: e-invoicing ministerial decisions", url: "https://ae.andersen.com/insights/tax-updates/uae-e-invoicing-ministerial-decisions" },
  { title: "Zola Group: UAE e-invoicing guide", url: "https://zolagroup.com/resources/uae-e-invoicing-guide" },
  { title: "Entityz: UAE e-invoicing", url: "https://entityz.ae/blog/uae-e-invoicing" },
]

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

/** Which wave applies to the company and how close the dates are. */
export function assess(revenue: number | null, today: string) {
  const wave = revenue === null ? null : revenue >= THRESHOLD ? WAVES[0] : WAVES[1]
  if (!wave) return { wave: null, level: "info" as const, aspDays: null, liveDays: null }
  const aspDays = days(today, wave.asp)
  const liveDays = days(today, wave.live)
  const level = aspDays < 0 ? ("alert" as const) : aspDays <= 120 ? ("warning" as const) : ("info" as const)
  return { wave, level, aspDays, liveDays }
}

export const aspRequestSchema = z.object({
  companyId: z.string().regex(/^[a-f0-9-]{36}$/),
  invoicesPerYear: z.number().int().min(0).max(100_000_000),
  billsPerYear: z.number().int().min(0).max(100_000_000),
  integration: z.enum(["system", "manual"]),
  software: z.string().trim().max(160).default(""),
  contact: z.string().trim().min(2, "Enter a contact name.").max(160),
  email: z.string().trim().email("Enter a valid email."),
  phone: z.string().trim().max(40).default(""),
  notes: z.string().trim().max(1000).default(""),
})
export type AspRequest = z.infer<typeof aspRequestSchema> & { id: string; companyName: string; createdAt: string; status: string }
